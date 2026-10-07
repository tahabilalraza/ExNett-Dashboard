import { Router } from 'express';
import { z } from 'zod';
import { Client, Project, Expert, Assignment, Activity, Industry, Sector, User, ACTIVITY_TYPES } from '../models.js';
import { asyncHandler, ApiError, requireAuth, permit, validate, audit } from '../core.js';
import {
  text, optionalText, requiredName, refField, amountField, dateField, emailField, currencyField,
  projectPopulation, assignmentPopulation, activityPopulation, baseFilter, addReferences,
  addExactFilters, addSearch, queryString, listSearch, paginated, findRecord, assertWritable,
  usableReference, taxonomyReferences, validateStatus,
} from '../services/business.js';

const router = Router();
router.use(requireAuth);
const requiredRef = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid reference ID');

const clientSchema = z.object({
  clientName: requiredName, status: text(100).min(1).optional(), primaryContactName: optionalText(200),
  primaryContactEmail: emailField, phone: optionalText(100), notes: optionalText(10_000),
});
const projectSchema = z.object({
  projectName: requiredName, client: refField, industry: refField, sector: refField, owner: refField,
  status: text(100).min(1).optional(), priority: z.enum(['Low', 'Normal', 'High', 'Urgent']).optional(),
  startDate: dateField, deadline: dateField, completedDate: dateField,
  description: optionalText(10_000), notes: optionalText(10_000),
});
const assignmentSchema = z.object({
  expert: requiredRef, project: requiredRef, assignmentStatus: text(100).min(1).optional(),
  assignedAt: dateField, contactedAt: dateField, screenedAt: dateField, interviewDate: dateField,
  completedAt: dateField, expertRate: amountField, currency: currencyField, notes: optionalText(10_000),
});
const activitySchema = z.object({
  expert: refField, project: refField, assignment: refField,
  activityType: z.enum(ACTIVITY_TYPES), activityDate: dateField, performedBy: refField,
  outcome: optionalText(500), notes: optionalText(10_000),
  durationMinutes: amountField, clientRate: amountField, expertRate: amountField,
  currency: currencyField, billingAmount: amountField, expertCost: amountField,
});

const clientSorts = ['clientName', 'clientId', 'status', 'createdAt', 'updatedAt'];
const projectSorts = ['projectName', 'projectId', 'status', 'priority', 'startDate', 'deadline', 'createdAt', 'updatedAt'];
const assignmentSorts = ['assignmentStatus', 'assignedAt', 'interviewDate', 'completedAt', 'createdAt', 'updatedAt'];
const activitySorts = ['activityDate', 'activityType', 'durationMinutes', 'revenue', 'margin', 'createdAt'];

function mergedDate(data, existing, key) { return Object.hasOwn(data, key) ? data[key] : existing?.[key]; }
function chronological(start, end, message) {
  if (start && end && new Date(end) < new Date(start)) throw new ApiError(400, message);
}

async function projectReferences(data, existing) {
  await taxonomyReferences(data, existing, Industry, Sector);
  if (data.client) await usableReference(Client, data.client, 'Client');
  if (data.owner) await usableReference(User, data.owner, 'Project owner');
  await validateStatus(data.status, 'project');
  chronological(mergedDate(data, existing, 'startDate'), mergedDate(data, existing, 'deadline'), 'Project deadline cannot precede its start date');
  chronological(mergedDate(data, existing, 'startDate'), mergedDate(data, existing, 'completedDate'), 'Project completion cannot precede its start date');
}

async function assignmentFields(data, existing) {
  await validateStatus(data.assignmentStatus, 'assignment');
  chronological(mergedDate(data, existing, 'assignedAt'), mergedDate(data, existing, 'completedAt'), 'Assignment completion cannot precede its assignment date');
  const rate = Object.hasOwn(data, 'expertRate') ? data.expertRate : existing?.expertRate;
  const currency = Object.hasOwn(data, 'currency') ? data.currency : existing?.currency;
  if ((!existing || Object.hasOwn(data, 'expertRate') || Object.hasOwn(data, 'currency')) && rate != null && !currency) {
    throw new ApiError(400, 'Currency is required when an expert rate is provided');
  }
}

async function activityReferences(data, existing, req) {
  const assignmentId = Object.hasOwn(data, 'assignment') ? data.assignment : existing?.assignment;
  if (assignmentId) {
    const assignment = await findRecord(Assignment, String(assignmentId), 'Assignment');
    if ((!existing || Object.hasOwn(data, 'assignment')) && assignment.removedAt) throw new ApiError(400, 'Assignment has been removed');
    for (const key of ['expert', 'project']) {
      if (Object.hasOwn(data, key) && data[key] && String(data[key]) !== String(assignment[key])) {
        throw new ApiError(400, 'Activity expert and project must match its assignment');
      }
      data[key] = assignment[key];
    }
  }
  for (const [key, Model, label] of [['expert', Expert, 'Expert'], ['project', Project, 'Project']]) {
    const changed = data[key] && (!existing || String(data[key]) !== String(existing[key]));
    if (changed) await usableReference(Model, String(data[key]), label);
  }
  const expert = Object.hasOwn(data, 'expert') ? data.expert : existing?.expert;
  const project = Object.hasOwn(data, 'project') ? data.project : existing?.project;
  if (!expert && !project) throw new ApiError(400, 'An activity must reference an expert or project');
  if (data.performedBy) {
    if (req.user.role === 'member' && String(data.performedBy) !== String(req.user._id)) {
      throw new ApiError(403, 'Members can only record themselves as the person performing an activity');
    }
    if (!existing || String(data.performedBy) !== String(existing.performedBy)) await usableReference(User, data.performedBy, 'Activity performer');
  } else if (!existing) data.performedBy = req.user._id;
  if (Object.hasOwn(data, 'performedBy') && !data.performedBy) data.performedBy = req.user._id;
}

function financialFields(data, existing) {
  const current = existing?.toObject() || {};
  const merged = { ...current, ...data };
  const amounts = ['clientRate', 'expertRate', 'billingAmount', 'expertCost'];
  if (amounts.some(key => merged[key] != null) && !merged.currency) throw new ApiError(400, 'Currency is required for activity amounts');
  const hours = merged.durationMinutes == null ? null : merged.durationMinutes / 60;
  const rounded = value => value == null ? null : Math.round((value + Number.EPSILON) * 100) / 100;
  const revenue = merged.billingAmount != null ? merged.billingAmount
    : hours != null && merged.clientRate != null ? hours * merged.clientRate : null;
  const expertCostIsManual = Object.hasOwn(data, 'expertCost') ? data.expertCost != null : Boolean(current.expertCostIsManual);
  const cost = expertCostIsManual ? merged.expertCost
    : hours != null && merged.expertRate != null ? hours * merged.expertRate : null;
  return { revenue: rounded(revenue), expertCost: rounded(cost), expertCostIsManual,
    margin: revenue != null && cost != null ? rounded(revenue - cost) : null };
}

router.get('/clients', asyncHandler(async (req, res) => {
  const filter = baseFilter(req);
  addExactFilters(filter, req.query, ['status']);
  addSearch(filter, listSearch(req.query, clientSorts), ['clientName', 'clientId', 'primaryContactName', 'primaryContactEmail']);
  res.json(await paginated(Client, req.query, filter, { sorts: clientSorts }));
}));

router.get('/clients/:id', asyncHandler(async (req, res) => {
  const data = await findRecord(Client, req.params.id, 'Client');
  const projects = await Project.find({ client: data._id, archivedAt: null }).populate(projectPopulation).sort({ createdAt: -1 }).lean();
  res.json({ data, projects });
}));

router.post('/clients', asyncHandler(async (req, res) => {
  const client = await Client.create(validate(clientSchema, req.body));
  await audit(req, 'create', 'Client', client._id, 'Created client');
  res.status(201).json({ data: client });
}));

router.put('/clients/:id', asyncHandler(async (req, res) => {
  const client = await findRecord(Client, req.params.id, 'Client');
  assertWritable(client);
  Object.assign(client, validate(clientSchema.partial(), req.body));
  await client.save();
  await audit(req, 'update', 'Client', client._id, 'Updated client');
  res.json({ data: client });
}));

router.delete('/clients/:id', permit('admin', 'manager'), asyncHandler(async (req, res) => {
  const client = await findRecord(Client, req.params.id, 'Client');
  if (!client.archivedAt) {
    client.archivedAt = new Date();
    await client.save();
    await audit(req, 'archive', 'Client', client._id, 'Archived client; project history retained');
  }
  res.json({ data: client });
}));

router.get('/projects', asyncHandler(async (req, res) => {
  const filter = baseFilter(req);
  addReferences(filter, req.query, ['client', 'industry', 'sector', 'owner']);
  addExactFilters(filter, req.query, ['status', 'priority']);
  addSearch(filter, listSearch(req.query, projectSorts), ['projectName', 'projectId', 'description']);
  res.json(await paginated(Project, req.query, filter, { sorts: projectSorts, populate: projectPopulation }));
}));

router.get('/projects/:id', asyncHandler(async (req, res) => {
  const project = await findRecord(Project, req.params.id, 'Project');
  const [data, assignments, activities] = await Promise.all([
    project.populate(projectPopulation),
    Assignment.find({ project: project._id, removedAt: null }).populate(assignmentPopulation).sort({ createdAt: -1 }).lean(),
    Activity.find({ project: project._id, archivedAt: null }).populate(activityPopulation).sort({ activityDate: -1 }).lean(),
  ]);
  res.json({ data, assignments, activities });
}));

router.post('/projects', asyncHandler(async (req, res) => {
  const data = validate(projectSchema, req.body);
  if (!Object.hasOwn(data, 'owner')) data.owner = req.user._id;
  await projectReferences(data);
  const project = await Project.create(data);
  await audit(req, 'create', 'Project', project._id, 'Created project');
  res.status(201).json({ data: await project.populate(projectPopulation) });
}));

router.put('/projects/:id', asyncHandler(async (req, res) => {
  const project = await findRecord(Project, req.params.id, 'Project');
  assertWritable(project);
  const data = validate(projectSchema.partial(), req.body);
  await projectReferences(data, project);
  Object.assign(project, data);
  await project.save();
  await audit(req, 'update', 'Project', project._id, 'Updated project');
  res.json({ data: await project.populate(projectPopulation) });
}));

router.delete('/projects/:id', permit('admin', 'manager'), asyncHandler(async (req, res) => {
  const project = await findRecord(Project, req.params.id, 'Project');
  if (!project.archivedAt) {
    project.archivedAt = new Date();
    await project.save();
    await audit(req, 'archive', 'Project', project._id, 'Archived project; expert assignments and activity history retained');
  }
  res.json({ data: project });
}));

router.get('/assignments', asyncHandler(async (req, res) => {
  const filter = baseFilter(req, 'removedAt');
  addReferences(filter, req.query, ['expert', 'project', 'createdBy']);
  addExactFilters(filter, req.query, ['assignmentStatus']);
  addSearch(filter, listSearch(req.query, assignmentSorts), ['notes', 'assignmentStatus']);
  res.json(await paginated(Assignment, req.query, filter, { sorts: assignmentSorts, populate: assignmentPopulation }));
}));

router.get('/assignments/:id', asyncHandler(async (req, res) => {
  const assignment = await findRecord(Assignment, req.params.id, 'Assignment', { archiveKey: 'removedAt' });
  res.json({ data: await assignment.populate(assignmentPopulation) });
}));

router.post('/assignments', asyncHandler(async (req, res) => {
  const data = validate(assignmentSchema, req.body);
  await Promise.all([usableReference(Expert, data.expert, 'Expert'), usableReference(Project, data.project, 'Project')]);
  await assignmentFields(data);
  let assignment = await Assignment.findOne({ expert: data.expert, project: data.project });
  let restored = false;
  if (assignment) {
    if (!assignment.removedAt) throw new ApiError(409, 'This expert is already assigned to the project');
    Object.assign(assignment, data, { removedAt: null, assignmentStatus: data.assignmentStatus || 'Added' });
    await assignment.save();
    restored = true;
  } else assignment = await Assignment.create({ ...data, createdBy: req.user._id });
  await audit(req, restored ? 'restore' : 'create', 'Assignment', assignment._id, restored ? 'Restored expert assignment' : 'Assigned expert to project');
  res.status(restored ? 200 : 201).json({ data: await assignment.populate(assignmentPopulation) });
}));

router.put('/assignments/:id', asyncHandler(async (req, res) => {
  const assignment = await findRecord(Assignment, req.params.id, 'Assignment');
  assertWritable(assignment, 'removedAt');
  const data = validate(assignmentSchema.partial(), req.body);
  for (const key of ['expert', 'project']) {
    if (Object.hasOwn(data, key) && String(data[key]) !== String(assignment[key])) throw new ApiError(400, 'Assignment expert and project cannot be changed; remove it and create another assignment');
  }
  await assignmentFields(data, assignment);
  Object.assign(assignment, data);
  await assignment.save();
  await audit(req, 'update', 'Assignment', assignment._id, 'Updated expert assignment');
  res.json({ data: await assignment.populate(assignmentPopulation) });
}));

router.delete('/assignments/:id', permit('admin', 'manager'), asyncHandler(async (req, res) => {
  const assignment = await findRecord(Assignment, req.params.id, 'Assignment');
  if (!assignment.removedAt) {
    assignment.removedAt = new Date();
    await assignment.save();
    await audit(req, 'remove', 'Assignment', assignment._id, 'Removed expert assignment; activity history retained');
  }
  res.json({ data: assignment });
}));

router.get('/activities', asyncHandler(async (req, res) => {
  const filter = baseFilter(req);
  addReferences(filter, req.query, ['expert', 'project', 'assignment', 'performedBy']);
  addExactFilters(filter, req.query, ['activityType', 'currency']);
  addSearch(filter, listSearch(req.query, activitySorts, 'activityDate'), ['activityType', 'outcome', 'notes']);
  const from = queryString(req.query.from, 'from');
  const to = queryString(req.query.to, 'to');
  if (from || to) {
    const start = from ? new Date(from) : null;
    const end = to ? new Date(to) : null;
    if ((start && !Number.isFinite(start.getTime())) || (end && !Number.isFinite(end.getTime()))) throw new ApiError(400, 'Invalid activity date range');
    if (end && /^\d{4}-\d{2}-\d{2}$/.test(to)) end.setUTCHours(23, 59, 59, 999);
    chronological(start, end, 'Activity date range is reversed');
    filter.activityDate = { ...(start ? { $gte: start } : {}), ...(end ? { $lte: end } : {}) };
  }
  res.json(await paginated(Activity, req.query, filter, { sorts: activitySorts, populate: activityPopulation, defaultSort: 'activityDate' }));
}));

router.get('/activities/:id', asyncHandler(async (req, res) => {
  const activity = await findRecord(Activity, req.params.id, 'Activity');
  res.json({ data: await activity.populate(activityPopulation) });
}));

router.post('/activities', asyncHandler(async (req, res) => {
  const data = validate(activitySchema, req.body);
  if (!data.activityDate) data.activityDate = new Date();
  await activityReferences(data, null, req);
  const activity = await Activity.create({ ...data, ...financialFields(data) });
  await audit(req, 'create', 'Activity', activity._id, 'Logged activity');
  res.status(201).json({ data: await activity.populate(activityPopulation) });
}));

router.put('/activities/:id', asyncHandler(async (req, res) => {
  const activity = await findRecord(Activity, req.params.id, 'Activity');
  assertWritable(activity);
  const data = validate(activitySchema.partial(), req.body);
  if (Object.hasOwn(data, 'activityDate') && !data.activityDate) throw new ApiError(400, 'Activity date is required');
  await activityReferences(data, activity, req);
  Object.assign(activity, data, financialFields(data, activity));
  await activity.save();
  await audit(req, 'update', 'Activity', activity._id, 'Updated activity');
  res.json({ data: await activity.populate(activityPopulation) });
}));

router.delete('/activities/:id', permit('admin', 'manager'), asyncHandler(async (req, res) => {
  const activity = await findRecord(Activity, req.params.id, 'Activity');
  if (!activity.archivedAt) {
    activity.archivedAt = new Date();
    await activity.save();
    await audit(req, 'archive', 'Activity', activity._id, 'Archived activity');
  }
  res.json({ data: activity });
}));

export default router;
