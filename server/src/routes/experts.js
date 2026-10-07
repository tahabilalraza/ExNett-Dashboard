import { Router } from 'express';
import { z } from 'zod';
import { Expert, Industry, Sector, User, Assignment, Activity } from '../models.js';
import { asyncHandler, ApiError, requireAuth, permit, validate, audit, assertObjectId } from '../core.js';
import {
  text, optionalText, requiredName, refField, amountField, emailField, currencyField,
  expertPopulation, assignmentPopulation, activityPopulation, baseFilter, addReferences,
  addExactFilters, addSearch, queryString, queryBoolean, listSearch, paginated,
  findRecord, assertWritable, usableReference, taxonomyReferences, writeCsvRow,
} from '../services/business.js';

const router = Router();
router.use(requireAuth);

const expertFields = {
  expertId: text(150).min(1).optional(),
  fullName: requiredName,
  country: optionalText(100), currentCompany: optionalText(200), currentPosition: optionalText(200),
  email: emailField, emails: z.array(z.string().trim().email().max(254)).max(20).optional(),
  phoneNumber: optionalText(100),
  linkedinProfile: z.union([z.string().trim().url().max(1000), z.literal('')]).optional(),
  industry: refField, sector: refField, recruitedBy: refField,
  legacyRecruiter: optionalText(200), status: text(100).min(1).optional(),
  hourlyRate: amountField, currency: currencyField, remarks: optionalText(10_000),
  tags: z.array(text(100).min(1)).max(50).optional(),
};
const createSchema = z.object(expertFields);
const updateSchema = createSchema.partial();
const sorts = ['fullName', 'expertId', 'country', 'currentCompany', 'currentPosition', 'status', 'hourlyRate', 'createdAt', 'updatedAt'];

async function expertFilter(req) {
  const filter = baseFilter(req);
  addReferences(filter, req.query, ['industry', 'sector', 'recruitedBy']);
  addExactFilters(filter, req.query, ['country', 'status', 'currentCompany', 'currentPosition']);
  addSearch(filter, listSearch(req.query, sorts), ['fullName', 'expertId', 'country', 'email', 'emails', 'phoneNumber', 'linkedinProfile', 'currentCompany', 'currentPosition', 'tags']);
  const minRate = queryString(req.query.minRate, 'minRate');
  const maxRate = queryString(req.query.maxRate, 'maxRate');
  if (minRate !== undefined || maxRate !== undefined) {
    const min = minRate === undefined ? undefined : Number(minRate);
    const max = maxRate === undefined ? undefined : Number(maxRate);
    if ((min !== undefined && (!Number.isFinite(min) || min < 0)) ||
        (max !== undefined && (!Number.isFinite(max) || max < 0)) || (min !== undefined && max !== undefined && min > max)) {
      throw new ApiError(400, 'Invalid hourly rate range');
    }
    filter.hourlyRate = { ...(min !== undefined ? { $gte: min } : {}), ...(max !== undefined ? { $lte: max } : {}) };
  }
  const clauses = [];
  const contacts = [
    ['hasEmail', { $or: [{ email: { $type: 'string', $ne: '' } }, { 'emails.0': { $exists: true } }] }],
    ['hasPhone', { phoneNumber: { $type: 'string', $ne: '' } }],
    ['hasLinkedIn', { linkedinProfile: { $type: 'string', $ne: '' } }],
  ];
  for (const [key, condition] of contacts) {
    const value = queryBoolean(req.query[key], key);
    if (value !== undefined) clauses.push(value ? condition : { $nor: [condition] });
  }
  const recent = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const recentlyAdded = queryBoolean(req.query.recentlyAdded, 'recentlyAdded');
  if (recentlyAdded !== undefined) filter.createdAt = recentlyAdded ? { $gte: recent } : { $lt: recent };
  const recentlyActive = queryBoolean(req.query.recentlyActive, 'recentlyActive');
  if (recentlyActive !== undefined) {
    const ids = await Activity.distinct('expert', { archivedAt: null, activityDate: { $gte: recent }, expert: { $ne: null } });
    clauses.push({ _id: { [recentlyActive ? '$in' : '$nin']: ids } });
  }
  const project = queryString(req.query.project, 'project');
  const assignmentStatus = queryString(req.query.assignmentStatus, 'assignmentStatus');
  if (project || assignmentStatus) {
    if (project) assertObjectId(project, 'Project');
    const ids = await Assignment.distinct('expert', { ...(project ? { project } : {}),
      ...(assignmentStatus ? { assignmentStatus } : {}), removedAt: null });
    clauses.push({ _id: { $in: ids } });
  }
  if (clauses.length) filter.$and = clauses;
  return filter;
}

async function validateReferences(data, existing) {
  await taxonomyReferences(data, existing, Industry, Sector);
  if (data.recruitedBy) await usableReference(User, data.recruitedBy, 'Recruiter');
  if (data.emails || Object.hasOwn(data, 'email')) {
    const emails = data.emails ?? existing?.emails ?? [];
    data.emails = [...new Set([...emails, ...(data.email ? [data.email] : [])].map(value => value.toLowerCase()))];
  }
  if (data.tags) data.tags = [...new Set(data.tags)];
}

router.get('/', asyncHandler(async (req, res) => {
  const filter = await expertFilter(req);
  res.json(await paginated(Expert, req.query, filter, { sorts, populate: expertPopulation }));
}));

router.get('/export.csv', asyncHandler(async (req, res) => {
  const filter = await expertFilter(req);
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="exnett-experts.csv"', 'Cache-Control': 'no-store' });
  await writeCsvRow(res, ['Expert ID', 'Full Name', 'Country', 'Current Company', 'Current Position', 'Email', 'Other Emails', 'Phone Number',
    'LinkedIn Profile', 'Industry', 'Sector', 'Status', 'Hourly Rate', 'Currency', 'Recruited By', 'Tags', 'Remarks', 'Created At']);
  let count = 0;
  const cursor = Expert.find(filter).sort({ fullName: 1, _id: 1 }).populate(expertPopulation).lean().cursor();
  try {
    for await (const row of cursor) {
      if (res.destroyed) break;
      await writeCsvRow(res, [row.expertId, row.fullName, row.country, row.currentCompany, row.currentPosition, row.email,
        (row.emails || []).join('; '), row.phoneNumber, row.linkedinProfile, row.industry?.name, row.sector?.name, row.status,
        row.hourlyRate, row.currency, row.recruitedBy?.name || row.legacyRecruiter, (row.tags || []).join('; '), row.remarks,
        row.createdAt?.toISOString()]);
      count++;
    }
  } finally {
    await cursor.close();
  }
  await audit(req, 'export', 'Expert', null, `Exported ${count} expert records`);
  res.end();
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const expert = await findRecord(Expert, req.params.id, 'Expert');
  const [data, assignments, activities] = await Promise.all([
    expert.populate(expertPopulation),
    Assignment.find({ expert: expert._id, removedAt: null }).populate(assignmentPopulation).sort({ createdAt: -1 }).lean(),
    Activity.find({ expert: expert._id, archivedAt: null }).populate(activityPopulation).sort({ activityDate: -1 }).lean(),
  ]);
  res.json({ data, assignments, activities });
}));

router.post('/', asyncHandler(async (req, res) => {
  const data = validate(createSchema, req.body);
  await validateReferences(data);
  const expert = await Expert.create(data);
  await audit(req, 'create', 'Expert', expert._id, 'Created expert');
  res.status(201).json({ data: await expert.populate(expertPopulation) });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const expert = await findRecord(Expert, req.params.id, 'Expert');
  assertWritable(expert);
  const data = validate(updateSchema, req.body);
  await validateReferences(data, expert);
  Object.assign(expert, data);
  await expert.save();
  await audit(req, 'update', 'Expert', expert._id, 'Updated expert');
  res.json({ data: await expert.populate(expertPopulation) });
}));

router.delete('/:id', permit('admin', 'manager'), asyncHandler(async (req, res) => {
  const expert = await findRecord(Expert, req.params.id, 'Expert');
  if (!expert.archivedAt) {
    expert.archivedAt = new Date();
    await expert.save();
    await audit(req, 'archive', 'Expert', expert._id, 'Archived expert; assignment and activity history retained');
  }
  res.json({ data: expert });
}));

export default router;
