import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import {
  Settings, Industry, Sector, User, Expert, Project, Client, Assignment,
  USER_ROLES, ACTIVITY_TYPES, EXPERT_STATUSES,
} from '../models.js';
import { newPasswordSchema, publicUser } from '../auth.js';
import { asyncHandler, ApiError, requireAuth, permit, validate, audit } from '../core.js';
import {
  text, requiredName, refField, baseFilter, addReferences, addSearch, queryString, queryBoolean,
  listSearch, paginated, findRecord, assertWritable, usableReference, settingsData, withTeamLock,
} from '../services/business.js';

const router = Router();
router.use(requireAuth);

const statusList = z.array(text(100).min(1)).min(1).max(50)
  .refine(values => new Set(values.map(value => value.toLowerCase())).size === values.length, 'Status labels must be distinct');
const settingsSchema = z.object({
  organizationName: requiredName.optional(), projectStatuses: statusList.optional(), assignmentStatuses: statusList.optional(),
}).refine(data => !data.projectStatuses || data.projectStatuses.includes('Draft'), 'Keep Draft as the default project status')
  .refine(data => !data.assignmentStatuses || data.assignmentStatuses.includes('Added'), 'Keep Added as the default assignment status');
const industrySchema = z.object({ name: requiredName, active: z.boolean().optional() });
const sectorSchema = z.object({ name: requiredName, industry: z.string().regex(/^[a-f\d]{24}$/i), active: z.boolean().optional() });
const memberSchema = z.object({
  name: text(150).min(1), email: z.string().trim().email().max(254).transform(value => value.toLowerCase()),
  role: z.enum(USER_ROLES).optional(), active: z.boolean().optional(), password: newPasswordSchema,
});
const memberUpdateSchema = memberSchema.partial().extend({ currentPassword: z.string().max(72).optional() });
const taxonomySorts = ['name', 'active', 'createdAt', 'updatedAt'];
const userSorts = ['name', 'email', 'role', 'active', 'createdAt'];

router.get('/settings', asyncHandler(async (_req, res) => {
  res.json({ data: await settingsData() });
}));

router.put('/settings', permit('admin', 'manager'), asyncHandler(async (req, res) => {
  const data = validate(settingsSchema, req.body);
  const previous = await settingsData();
  for (const [key, Model, field] of [['projectStatuses', Project, 'status'], ['assignmentStatuses', Assignment, 'assignmentStatus']]) {
    if (!data[key]) continue;
    const removed = previous[key].filter(label => !data[key].includes(label));
    if (removed.length && await Model.exists({ [field]: { $in: removed }, ...(Model === Assignment ? { removedAt: null } : { archivedAt: null }) })) {
      throw new ApiError(409, 'Statuses used by current records cannot be removed; change those records first');
    }
  }
  await Settings.findOneAndUpdate({ key: 'organization' }, { $set: data, $setOnInsert: { key: 'organization' } },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true });
  await audit(req, 'update', 'Settings', null, 'Updated organization settings');
  res.json({ data: await settingsData() });
}));

router.get('/industries', asyncHandler(async (req, res) => {
  const filter = baseFilter(req);
  const active = queryBoolean(req.query.active, 'active');
  if (active !== undefined) filter.active = active;
  addSearch(filter, listSearch(req.query, taxonomySorts, 'name'), ['name']);
  res.json(await paginated(Industry, req.query, filter, { sorts: taxonomySorts, defaultSort: 'name' }));
}));

router.get('/industries/:id', asyncHandler(async (req, res) => {
  const data = await findRecord(Industry, req.params.id, 'Industry');
  const sectors = await Sector.find({ industry: data._id, archivedAt: null }).sort({ name: 1 }).lean();
  res.json({ data, sectors });
}));

router.post('/industries', permit('admin', 'manager'), asyncHandler(async (req, res) => {
  const data = await Industry.create(validate(industrySchema, req.body));
  await audit(req, 'create', 'Industry', data._id, 'Created industry');
  res.status(201).json({ data });
}));

router.put('/industries/:id', permit('admin', 'manager'), asyncHandler(async (req, res) => {
  const industry = await findRecord(Industry, req.params.id, 'Industry');
  assertWritable(industry);
  Object.assign(industry, validate(industrySchema.partial(), req.body));
  await industry.save();
  await audit(req, 'update', 'Industry', industry._id, 'Updated industry');
  res.json({ data: industry });
}));

router.delete('/industries/:id', permit('admin', 'manager'), asyncHandler(async (req, res) => {
  const industry = await findRecord(Industry, req.params.id, 'Industry');
  if (!industry.archivedAt) {
    if (await Sector.exists({ industry: industry._id, active: true, archivedAt: null })) {
      throw new ApiError(409, 'Archive or deactivate this industry’s active sectors first');
    }
    industry.archivedAt = new Date();
    industry.active = false;
    await industry.save();
    await audit(req, 'archive', 'Industry', industry._id, 'Archived industry; historical references retained');
  }
  res.json({ data: industry });
}));

router.get('/sectors', asyncHandler(async (req, res) => {
  const filter = baseFilter(req);
  addReferences(filter, req.query, ['industry']);
  const active = queryBoolean(req.query.active, 'active');
  if (active !== undefined) filter.active = active;
  addSearch(filter, listSearch(req.query, taxonomySorts, 'name'), ['name']);
  res.json(await paginated(Sector, req.query, filter, { sorts: taxonomySorts,
    populate: [{ path: 'industry', select: 'name active archivedAt' }], defaultSort: 'name' }));
}));

router.get('/sectors/:id', asyncHandler(async (req, res) => {
  const sector = await findRecord(Sector, req.params.id, 'Sector');
  res.json({ data: await sector.populate({ path: 'industry', select: 'name active archivedAt' }) });
}));

router.post('/sectors', permit('admin', 'manager'), asyncHandler(async (req, res) => {
  const data = validate(sectorSchema, req.body);
  await usableReference(Industry, data.industry, 'Industry');
  const sector = await Sector.create(data);
  await audit(req, 'create', 'Sector', sector._id, 'Created sector');
  res.status(201).json({ data: await sector.populate({ path: 'industry', select: 'name active' }) });
}));

router.put('/sectors/:id', permit('admin', 'manager'), asyncHandler(async (req, res) => {
  const sector = await findRecord(Sector, req.params.id, 'Sector');
  assertWritable(sector);
  const data = validate(sectorSchema.partial(), req.body);
  if (data.industry && String(data.industry) !== String(sector.industry)) {
    await usableReference(Industry, data.industry, 'Industry');
    const used = await Promise.all([Expert.exists({ sector: sector._id, archivedAt: null }), Project.exists({ sector: sector._id, archivedAt: null })]);
    if (used.some(Boolean)) throw new ApiError(409, 'A sector used by experts or projects cannot move to another industry');
  }
  Object.assign(sector, data);
  await sector.save();
  await audit(req, 'update', 'Sector', sector._id, 'Updated sector');
  res.json({ data: await sector.populate({ path: 'industry', select: 'name active' }) });
}));

router.delete('/sectors/:id', permit('admin', 'manager'), asyncHandler(async (req, res) => {
  const sector = await findRecord(Sector, req.params.id, 'Sector');
  if (!sector.archivedAt) {
    sector.archivedAt = new Date();
    sector.active = false;
    await sector.save();
    await audit(req, 'archive', 'Sector', sector._id, 'Archived sector; historical references retained');
  }
  res.json({ data: sector });
}));

router.get('/team', permit('admin'), asyncHandler(async (req, res) => {
  const filter = baseFilter(req);
  const role = queryString(req.query.role, 'role');
  if (role) {
    if (!USER_ROLES.includes(role)) throw new ApiError(400, 'Unknown user role');
    filter.role = role;
  }
  const active = queryBoolean(req.query.active, 'active');
  if (active !== undefined) filter.active = active;
  addSearch(filter, listSearch(req.query, userSorts, 'name'), ['name', 'email']);
  res.json(await paginated(User, req.query, filter, { sorts: userSorts, defaultSort: 'name', select: 'name email role active createdAt updatedAt archivedAt' }));
}));

router.get('/team/:id', permit('admin'), asyncHandler(async (req, res) => {
  const user = await findRecord(User, req.params.id, 'User');
  res.json({ data: publicUser(user) });
}));

router.post('/team', permit('admin'), asyncHandler(async (req, res) => {
  const data = validate(memberSchema, req.body);
  const passwordHash = await bcrypt.hash(data.password, 12);
  const user = await User.create({ name: data.name, email: data.email, role: data.role, active: data.active, passwordHash });
  await audit(req, 'create', 'User', user._id, 'Created team user');
  res.status(201).json({ data: publicUser(user) });
}));

router.put('/team/:id', permit('admin'), asyncHandler(async (req, res) => {
  const data = validate(memberUpdateSchema, req.body);
  const isSelf = String(req.user._id) === req.params.id;
  if (isSelf && (data.active === false || (data.role && data.role !== 'admin'))) {
    throw new ApiError(409, 'You cannot deactivate or demote your own administrator account');
  }
  // Hash before the lock so password work cannot exhaust the short admin lease.
  const passwordHash = data.password ? await bcrypt.hash(data.password, 12) : undefined;
  const user = await withTeamLock(async () => {
    const current = await findRecord(User, req.params.id, 'User');
    assertWritable(current);
    const ownEmailChange = isSelf && data.email !== undefined && data.email !== current.email;
    if (isSelf && (passwordHash || ownEmailChange)) {
      const credentials = await User.findById(current._id).select('+passwordHash');
      if (!data.currentPassword || !await bcrypt.compare(data.currentPassword, credentials.passwordHash)) {
        throw new ApiError(400, 'Your current password is required and must be correct');
      }
    }
    if (current.role === 'admin' && current.active && (data.active === false || (data.role && data.role !== 'admin'))) {
      const otherAdmin = await User.exists({ _id: { $ne: current._id }, role: 'admin', active: true, archivedAt: null });
      if (!otherAdmin) throw new ApiError(409, 'The last active administrator cannot be deactivated or demoted');
    }
    const invalidate = Boolean(passwordHash) || (data.role !== undefined && data.role !== current.role) || (data.active !== undefined && data.active !== current.active);
    for (const key of ['name', 'email', 'role', 'active']) if (Object.hasOwn(data, key)) current[key] = data[key];
    if (passwordHash) current.passwordHash = passwordHash;
    if (invalidate) current.sessionVersion += 1;
    await current.save();
    return current;
  });
  // A successful own password reset keeps the current session and invalidates every other session.
  if (isSelf) req.session.sessionVersion = user.sessionVersion;
  await audit(req, 'update', 'User', user._id, data.password ? 'Updated team user and reset password' : 'Updated team user');
  res.json({ data: publicUser(user) });
}));

router.delete('/team/:id', permit('admin'), asyncHandler(async (req, res) => {
  if (String(req.user._id) === req.params.id) throw new ApiError(409, 'You cannot archive your own administrator account');
  const user = await withTeamLock(async () => {
    const current = await findRecord(User, req.params.id, 'User');
    if (!current.archivedAt) {
      if (current.role === 'admin' && current.active && !await User.exists({ _id: { $ne: current._id }, role: 'admin', active: true, archivedAt: null })) {
        throw new ApiError(409, 'The last active administrator cannot be archived');
      }
      current.archivedAt = new Date();
      current.active = false;
      current.sessionVersion += 1;
      await current.save();
    }
    return current;
  });
  await audit(req, 'archive', 'User', user._id, 'Archived team user');
  res.json({ data: publicUser(user) });
}));

router.get('/lookups', asyncHandler(async (req, res) => {
  const search = queryString(req.query.search, 'search') || '';
  const cap = 2000;
  const expertFilter = { archivedAt: null };
  const projectFilter = { archivedAt: null };
  const clientFilter = { archivedAt: null };
  addSearch(expertFilter, search, ['fullName', 'expertId']);
  addSearch(projectFilter, search, ['projectName', 'projectId']);
  addSearch(clientFilter, search, ['clientName', 'clientId']);
  const [experts, projects, clients, industries, sectors, users, configuration, observedExpertStatuses, totals] = await Promise.all([
    Expert.find(expertFilter).select('fullName expertId').sort({ fullName: 1 }).limit(cap).lean(),
    Project.find(projectFilter).select('projectName projectId').sort({ projectName: 1 }).limit(cap).lean(),
    Client.find(clientFilter).select('clientName clientId').sort({ clientName: 1 }).limit(cap).lean(),
    Industry.find({ archivedAt: null, active: true }).select('name').sort({ name: 1 }).limit(cap).lean(),
    Sector.find({ archivedAt: null, active: true }).select('name industry').sort({ name: 1 }).limit(cap).lean(),
    User.find({ archivedAt: null, active: true }).select('name').sort({ name: 1 }).limit(cap).lean(),
    settingsData(), Expert.distinct('status', { archivedAt: null }),
    Promise.all([Expert.countDocuments(expertFilter), Project.countDocuments(projectFilter), Client.countDocuments(clientFilter)]),
  ]);
  const activeIndustryIds = new Set(industries.map(industry => String(industry._id)));
  res.json({ experts, projects, clients, industries, sectors: sectors.filter(sector => activeIndustryIds.has(String(sector.industry))), users,
    ...configuration, activityTypes: ACTIVITY_TYPES,
    expertStatuses: [...new Set([...EXPERT_STATUSES, ...observedExpertStatuses.filter(Boolean)])],
    lookupLimit: cap, truncated: { experts: totals[0] > cap, projects: totals[1] > cap, clients: totals[2] > cap },
  });
}));

export default router;
