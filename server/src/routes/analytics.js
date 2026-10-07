import { Router } from 'express';
import {
  Expert, Project, Assignment, Activity, Industry, User,
} from '../models.js';
import { asyncHandler, ApiError, requireAuth, assertObjectId } from '../core.js';
import {
  addReferences, addExactFilters, queryString, activityPopulation, writeCsvRow,
} from '../services/business.js';

const router = Router();
router.use(requireAuth);
const currencyExpression = { $cond: [{ $eq: [{ $ifNull: ['$currency', ''] }, ''] }, 'Unspecified', '$currency'] };
const rounded = value => value == null ? null : Math.round(value * 100) / 100;

function dateWindow(query) {
  const from = queryString(query.from, 'from');
  const to = queryString(query.to, 'to');
  const start = from ? new Date(from) : null;
  const end = to ? new Date(to) : null;
  if ((start && !Number.isFinite(start.getTime())) || (end && !Number.isFinite(end.getTime()))) throw new ApiError(400, 'Invalid report date range');
  if (end && /^\d{4}-\d{2}-\d{2}$/.test(to)) end.setUTCHours(23, 59, 59, 999);
  if (start && end && start > end) throw new ApiError(400, 'Report date range is reversed');
  return start || end ? { ...(start ? { $gte: start } : {}), ...(end ? { $lte: end } : {}) } : null;
}

function groupBy(Model, match, field, fallback = 'Unclassified') {
  return Model.aggregate([
    { $match: match },
    { $group: { _id: { $cond: [{ $eq: [{ $ifNull: [`$${field}`, ''] }, ''] }, fallback, `$${field}`] }, count: { $sum: 1 } } },
    { $project: { _id: 0, name: '$_id', count: 1 } }, { $sort: { count: -1, name: 1 } },
  ]);
}

async function metrics(req, extended = false) {
  const recent = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const window = dateWindow(req.query);
  const expertFilter = { archivedAt: null };
  const projectFilter = { archivedAt: null };
  addReferences(expertFilter, req.query, ['industry', 'sector', 'recruitedBy']);
  addExactFilters(expertFilter, req.query, ['country']);
  addReferences(projectFilter, req.query, ['client']);
  const projectId = queryString(req.query.project, 'project');
  if (projectId) {
    assertObjectId(projectId, 'Project');
    // Aggregate does not cast strings; distinct/find does, so use its returned native ObjectIds.
    const matching = await Assignment.distinct('expert', { project: projectId, removedAt: null });
    expertFilter._id = { $in: matching };
    projectFilter._id = projectId;
  }
  const [expertIds, projectIds] = await Promise.all([Expert.distinct('_id', expertFilter), Project.distinct('_id', projectFilter)]);
  // All aggregation matches use IDs obtained through Mongoose's cast-aware queries.
  const expertMatch = { _id: { $in: expertIds } };
  const projectMatch = { _id: { $in: projectIds } };
  const assignmentMatch = { removedAt: null, expert: { $in: expertIds }, project: { $in: projectIds } };
  const hasExpertScope = ['industry', 'sector', 'recruitedBy', 'country'].some(key => Boolean(req.query[key]));
  const hasProjectScope = Boolean(projectId || req.query.client);
  const activityMatch = { archivedAt: null,
    ...(hasExpertScope ? { expert: { $in: expertIds } } : {}),
    ...(hasProjectScope ? { project: { $in: projectIds } } : {}),
    ...(window ? { activityDate: window } : {}),
  };
  const requestedCurrency = queryString(req.query.currency, 'currency', 12);
  if (requestedCurrency) activityMatch.currency = requestedCurrency.toUpperCase();
  const timelineMatch = { ...activityMatch, activityDate: window || { $gte: recent } };
  const parallel = [
    Expert.countDocuments(expertFilter),
    Expert.countDocuments({ ...expertFilter, status: 'Active' }),
    Expert.countDocuments({ ...expertFilter, createdAt: { $gte: recent } }),
    Project.countDocuments({ ...projectFilter, status: 'Active' }),
    Assignment.countDocuments({ ...assignmentMatch, assignmentStatus: { $nin: ['Completed', 'Declined', 'Not Relevant'] } }),
    Activity.countDocuments({ ...activityMatch, activityType: 'Consultation' }),
    groupBy(Expert, expertMatch, 'country', 'Unspecified'),
    Expert.aggregate([
      { $match: expertMatch }, { $group: { _id: '$industry', count: { $sum: 1 } } },
      { $lookup: { from: Industry.collection.name, localField: '_id', foreignField: '_id', as: 'industry' } },
      { $project: { _id: 0, name: { $ifNull: [{ $arrayElemAt: ['$industry.name', 0] }, 'Unclassified'] }, count: 1 } },
      { $sort: { count: -1, name: 1 } },
    ]),
    groupBy(Expert, expertMatch, 'status'), groupBy(Project, projectMatch, 'status', 'Draft'),
    Activity.aggregate([
      { $match: timelineMatch }, { $group: { _id: { $dateToString: { date: '$activityDate', format: '%Y-%m-%d', timezone: 'UTC' } }, count: { $sum: 1 } } },
      { $project: { _id: 0, date: '$_id', count: 1 } }, { $sort: { date: 1 } },
    ]),
    Activity.aggregate([
      { $match: { ...activityMatch, $or: [{ revenue: { $type: 'number' } }, { expertCost: { $type: 'number' } }] } },
      { $group: { _id: currencyExpression, revenue: { $sum: '$revenue' }, expertCost: { $sum: '$expertCost' }, margin: { $sum: '$margin' },
        revenueCount: { $sum: { $cond: [{ $isNumber: '$revenue' }, 1, 0] } },
        costCount: { $sum: { $cond: [{ $isNumber: '$expertCost' }, 1, 0] } },
        marginCount: { $sum: { $cond: [{ $isNumber: '$margin' }, 1, 0] } }, } },
      { $project: { _id: 0, currency: '$_id', revenue: 1, expertCost: 1, margin: 1, revenueCount: 1, costCount: 1, marginCount: 1 } },
      { $sort: { currency: 1 } },
    ]),
    Expert.aggregate([
      { $match: { ...expertMatch, hourlyRate: { $type: 'number' }, ...(requestedCurrency ? { currency: requestedCurrency.toUpperCase() } : {}) } },
      { $group: { _id: currencyExpression, averageRate: { $avg: '$hourlyRate' }, count: { $sum: 1 } } },
      { $project: { _id: 0, currency: '$_id', averageRate: 1, count: 1 } }, { $sort: { currency: 1 } },
    ]),
    Activity.find(activityMatch).populate(activityPopulation).sort({ activityDate: -1, _id: -1 }).limit(10).lean(),
  ];
  const [totalExperts, activeExperts, recentExperts, activeProjects, pipelineAssignments, consultations,
    expertsByCountry, expertsByIndustry, expertsByStatus, projectsByStatus, activityOverTime,
    revenueByCurrency, averageRateByCurrency, recentActivity] = await Promise.all(parallel);
  const data = {
    kpis: { totalExperts, activeExperts, recentExperts, activeProjects, pipelineAssignments, consultations },
    expertsByCountry, expertsByIndustry, expertsByStatus, projectsByStatus, activityOverTime,
    revenueByCurrency: revenueByCurrency.map(row => ({ ...row,
      revenue: row.revenueCount ? rounded(row.revenue) : null,
      expertCost: row.costCount ? rounded(row.expertCost) : null,
      margin: row.marginCount ? rounded(row.margin) : null,
    })),
    averageRateByCurrency: averageRateByCurrency.map(row => ({ ...row, averageRate: rounded(row.averageRate) })), recentActivity,
    definitions: { recentDays: 30, activeProjects: 'Unarchived projects with Active status',
      pipelineAssignments: 'Current assignments to unarchived experts/projects outside Completed, Declined and Not Relevant',
      commercialTotals: 'Known recorded amounts only, grouped by currency; margin sums only records with both revenue and cost; no currency conversion',
      timeWindow: 'Date filters apply to recorded activity; expert distributions reflect the current database' },
  };
  if (!extended) return data;
  const assignmentWindow = window ? { ...assignmentMatch, assignedAt: window } : assignmentMatch;
  const [expertByRecruiter, expertsByProject, turnaroundRows, projectTurnaroundRows, assignedIds, activityByType] = await Promise.all([
    Expert.aggregate([
      { $match: expertMatch }, { $lookup: { from: User.collection.name, localField: 'recruitedBy', foreignField: '_id', as: 'recruiter' } },
      { $project: { name: { $ifNull: [{ $arrayElemAt: ['$recruiter.name', 0] },
        { $cond: [{ $eq: [{ $ifNull: ['$legacyRecruiter', ''] }, ''] }, 'Unassigned', '$legacyRecruiter'] }] } } },
      { $group: { _id: '$name', count: { $sum: 1 } } }, { $project: { _id: 0, name: '$_id', count: 1 } }, { $sort: { count: -1, name: 1 } },
    ]),
    Assignment.aggregate([
      { $match: assignmentMatch }, { $group: { _id: '$project', count: { $sum: 1 } } },
      { $lookup: { from: Project.collection.name, localField: '_id', foreignField: '_id', as: 'project' } },
      { $project: { _id: 0, projectId: '$_id', name: { $arrayElemAt: ['$project.projectName', 0] }, count: 1 } }, { $sort: { count: -1, name: 1 } },
    ]),
    Assignment.aggregate([
      { $match: { ...assignmentWindow, assignedAt: { ...(window || {}), $type: 'date' }, completedAt: { $type: 'date' }, $expr: { $gte: ['$completedAt', '$assignedAt'] } } },
      { $group: { _id: null, averageDays: { $avg: { $divide: [{ $subtract: ['$completedAt', '$assignedAt'] }, 86_400_000] } }, count: { $sum: 1 } } },
    ]),
    Project.aggregate([
      { $match: { ...projectMatch, startDate: { $type: 'date' }, completedDate: { $type: 'date' }, $expr: { $gte: ['$completedDate', '$startDate'] } } },
      { $group: { _id: null, averageDays: { $avg: { $divide: [{ $subtract: ['$completedDate', '$startDate'] }, 86_400_000] } }, count: { $sum: 1 } } },
    ]),
    Assignment.distinct('expert', assignmentMatch), groupBy(Activity, activityMatch, 'activityType', 'Other'),
  ]);
  data.expertByRecruiter = expertByRecruiter;
  data.expertsByProject = expertsByProject;
  data.turnaround = { averageDays: rounded(turnaroundRows[0]?.averageDays), count: turnaroundRows[0]?.count || 0,
    projectAverageDays: rounded(projectTurnaroundRows[0]?.averageDays), projectCount: projectTurnaroundRows[0]?.count || 0 };
  data.utilization = { assignedExperts: assignedIds.length, totalExperts, percent: totalExperts ? rounded(assignedIds.length / totalExperts * 100) : 0 };
  data.activityByType = activityByType;
  return data;
}

router.get('/dashboard', asyncHandler(async (req, res) => { res.json({ data: await metrics(req) }); }));
router.get('/reports', asyncHandler(async (req, res) => { res.json({ data: await metrics(req, true) }); }));
router.get('/reports/export.csv', asyncHandler(async (req, res) => {
  const data = await metrics(req, true);
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="exnett-report.csv"', 'Cache-Control': 'no-store' });
  await writeCsvRow(res, ['Metric', 'Group', 'Currency', 'Value']);
  for (const [name, value] of Object.entries(data.kpis)) await writeCsvRow(res, [name, '', '', value]);
  for (const category of ['expertsByCountry', 'expertsByIndustry', 'expertsByStatus', 'projectsByStatus', 'expertByRecruiter', 'expertsByProject']) {
    for (const row of data[category]) await writeCsvRow(res, [category, row.name, '', row.count]);
  }
  for (const row of data.revenueByCurrency) {
    for (const field of ['revenue', 'expertCost', 'margin']) await writeCsvRow(res, [field, '', row.currency, row[field]]);
  }
  res.end();
}));

export default router;
