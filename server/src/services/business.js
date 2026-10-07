import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { z } from 'zod';
import { ApiError, assertObjectId, parseListQuery } from '../core.js';
import { Settings, User, PROJECT_STATUSES, ASSIGNMENT_STATUSES } from '../models.js';

export const text = (max = 500) => z.string().trim().max(max);
export const optionalText = (max = 500) => text(max).optional();
export const requiredName = text(200).min(1, 'A name is required');
export const refField = z.preprocess(value => value === '' ? null : value,
  z.string().regex(/^[a-f\d]{24}$/i, 'Invalid reference ID').nullable().optional());
export const amountField = z.preprocess(value => (typeof value === 'string' && value.trim() === '') || value === null ? null
  : typeof value === 'string' ? Number(value) : value,
  z.number().finite().nonnegative().max(1e12).nullable().optional());
export const dateField = z.preprocess(value => value === '' || value === null ? null
  : typeof value === 'string' ? new Date(value) : value,
  z.date().nullable().optional());
export const emailField = z.union([z.string().trim().email().max(254), z.literal('')]).optional();
export const currencyField = z.union([z.string().trim().regex(/^[a-zA-Z]{3}$/, 'Use a three-letter currency code')
  .transform(value => value.toUpperCase()), z.literal('')]).nullable().optional();

export const expertPopulation = [
  { path: 'industry', select: 'name active archivedAt' },
  { path: 'sector', select: 'name industry active archivedAt' },
  { path: 'recruitedBy', select: 'name active archivedAt' },
];
export const projectPopulation = [
  { path: 'client', select: 'clientName clientId archivedAt' },
  { path: 'industry', select: 'name active archivedAt' },
  { path: 'sector', select: 'name industry active archivedAt' },
  { path: 'owner', select: 'name active archivedAt' },
];
export const assignmentPopulation = [
  { path: 'expert', select: 'fullName expertId country email phoneNumber currentCompany currentPosition status archivedAt' },
  { path: 'project', select: 'projectName projectId status client archivedAt' },
  { path: 'createdBy', select: 'name' },
];
export const activityPopulation = [
  { path: 'expert', select: 'fullName expertId archivedAt' },
  { path: 'project', select: 'projectName projectId archivedAt' },
  { path: 'assignment', select: 'expert project assignmentStatus removedAt' },
  { path: 'performedBy', select: 'name' },
];

export function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

export function queryString(value, label, maximum = 200) {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || value.length > maximum) throw new ApiError(400, `Invalid ${label}`);
  return value.trim();
}

export function queryBoolean(value, label) {
  if (value === undefined || value === '') return undefined;
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  throw new ApiError(400, `${label} must be true or false`);
}

export function baseFilter(req, archiveKey = 'archivedAt') {
  const includeArchived = queryBoolean(req.query.includeArchived, 'includeArchived');
  if (includeArchived && !['admin', 'manager'].includes(req.user.role)) {
    throw new ApiError(403, 'Only administrators and managers may include archived records');
  }
  return includeArchived ? {} : { [archiveKey]: null };
}

export function addReferences(filter, query, keys) {
  for (const key of keys) {
    const value = queryString(query[key], key);
    if (value) filter[key] = assertObjectId(value, key);
  }
}

export function addExactFilters(filter, query, keys) {
  for (const key of keys) {
    const value = queryString(query[key], key);
    if (value) filter[key] = value;
  }
}

export function addSearch(filter, search, keys) {
  if (search) filter.$or = keys.map(key => ({ [key]: { $regex: escapeRegex(search), $options: 'i' } }));
}

export async function paginated(Model, query, filter, { sorts, populate = [], defaultSort = 'createdAt', select } = {}) {
  const parsed = parseListQuery(query, { sortFields: sorts, defaultSort });
  let find = Model.find(filter).sort({ ...parsed.sort, _id: 1 }).skip(parsed.skip).limit(parsed.limit);
  if (populate.length) find = find.populate(populate);
  if (select) find = find.select(select);
  const [data, total] = await Promise.all([find.lean(), Model.countDocuments(filter)]);
  return { data, pagination: { page: parsed.page, limit: parsed.limit, total, pages: Math.ceil(total / parsed.limit) } };
}

export function listSearch(query, sorts, defaultSort = 'createdAt') {
  return parseListQuery(query, { sortFields: sorts, defaultSort }).search;
}

export async function findRecord(Model, id, label = 'Record', { includeArchived = true, archiveKey = 'archivedAt' } = {}) {
  assertObjectId(id, `${label} ID`);
  const doc = await Model.findOne({ _id: id, ...(includeArchived ? {} : { [archiveKey]: null }) });
  if (!doc) throw new ApiError(404, `${label} not found`);
  return doc;
}

export function assertWritable(doc, archiveKey = 'archivedAt') {
  if (doc[archiveKey]) throw new ApiError(409, 'Archived records cannot be changed');
}

export async function usableReference(Model, id, label, { allowInactive = false } = {}) {
  if (!id) return null;
  const doc = await findRecord(Model, String(id), label, { includeArchived: false });
  if (!allowInactive && doc.active === false) throw new ApiError(400, `${label} is inactive`);
  return doc;
}

export async function taxonomyReferences(data, existing, Industry, Sector) {
  if (data.industry) await usableReference(Industry, data.industry, 'Industry');
  if (data.sector) await usableReference(Sector, data.sector, 'Sector');
  const industry = Object.hasOwn(data, 'industry') ? data.industry : existing?.industry;
  const sector = Object.hasOwn(data, 'sector') ? data.sector : existing?.sector;
  if (sector) {
    const sectorDoc = await findRecord(Sector, String(sector), 'Sector');
    if (Object.hasOwn(data, 'industry') && !data.industry) {
      throw new ApiError(400, 'Clear the sector before clearing its industry');
    }
    if (industry && String(sectorDoc.industry) !== String(industry)) {
      throw new ApiError(400, 'Sector must belong to the selected industry');
    }
    if (!industry) {
      if (data.sector) await usableReference(Industry, String(sectorDoc.industry), 'Sector industry');
      data.industry = sectorDoc.industry;
    }
  }
}

export async function settingsData() {
  const saved = await Settings.findOne({ key: 'organization' }).lean();
  return {
    organizationName: saved?.organizationName || 'ExNett',
    projectStatuses: saved?.projectStatuses?.length ? saved.projectStatuses : PROJECT_STATUSES,
    assignmentStatuses: saved?.assignmentStatuses?.length ? saved.assignmentStatuses : ASSIGNMENT_STATUSES,
    demoMode: Boolean(saved?.demoMode),
  };
}

export async function validateStatus(value, kind) {
  if (!value) return;
  const settings = await settingsData();
  const choices = kind === 'project' ? settings.projectStatuses : settings.assignmentStatuses;
  if (!choices.includes(value)) throw new ApiError(400, `Unknown ${kind} status; choose a status from organization settings`);
}

export function csvCell(value) {
  let result = value === null || value === undefined ? '' : String(value);
  // Spreadsheet formula evaluation also applies after whitespace and to phone numbers beginning with +.
  if (/^[\s]*[=+\-@]/.test(result) || /^[\t\r\n]/.test(result)) result = `'${result}`;
  return `"${result.replaceAll('"', '""')}"`;
}

export async function writeCsvRow(res, values) {
  if (!res.write(`${values.map(csvCell).join(',')}\r\n`)) await once(res, 'drain');
}

// Standalone MongoDB is supported. A short lease serializes admin mutations across server instances.
// No privilege check and update can interleave while another administrator is being changed.
export async function withTeamLock(fn) {
  const locks = User.db.collection('operationLocks');
  const owner = randomUUID();
  const expiresAt = new Date(Date.now() + 30_000);
  let acquired = false;
  try {
    try {
      await locks.insertOne({ _id: 'team-admin-mutation', owner, expiresAt });
      acquired = true;
    } catch (error) {
      if (error.code !== 11000) throw error;
      const result = await locks.findOneAndUpdate(
        { _id: 'team-admin-mutation', expiresAt: { $lt: new Date() } },
        { $set: { owner, expiresAt } }, { returnDocument: 'after' });
      const lock = result?.value ?? result;
      acquired = lock?.owner === owner;
    }
    if (!acquired) throw new ApiError(409, 'Another team update is in progress; retry shortly');
    return await fn();
  } finally {
    if (acquired) await locks.deleteOne({ _id: 'team-admin-mutation', owner });
  }
}
