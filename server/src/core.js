import mongoose from 'mongoose';
import { User, AuditLog } from './models.js';

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function validate(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ApiError(400, 'Please check the supplied fields.', result.error.issues.map(({ path, message }) => ({
      field: path.join('.'), message,
    })));
  }
  return result.data;
}

export const requireAuth = asyncHandler(async (req, _res, next) => {
  if (req.user) return next();
  if (!req.session?.userId || !mongoose.isValidObjectId(req.session.userId)) {
    throw new ApiError(401, 'Please sign in to continue.');
  }
  const user = await User.findById(req.session.userId);
  if (!user || !user.active || user.archivedAt || user.sessionVersion !== req.session.sessionVersion) {
    req.session.destroy(() => {});
    throw new ApiError(401, 'Your session has expired. Please sign in again.');
  }
  req.user = user;
  next();
});

export const permit = (...roles) => (req, _res, next) => {
  if (!req.user) return next(new ApiError(401, 'Please sign in to continue.'));
  if (!roles.includes(req.user.role)) return next(new ApiError(403, 'You do not have permission to perform this action.'));
  next();
};

export async function audit(req, action, entityType, entityId, summary) {
  return AuditLog.create({ user: req.user?._id || null, action, entityType, entityId: entityId || null, summary });
}

export const isObjectId = (value) => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);
export function assertObjectId(value, label = 'ID') {
  if (!isObjectId(value)) throw new ApiError(400, `${label} is invalid.`);
  return value;
}

export async function getReference(Model, id, label = Model.modelName, { allowArchived = false } = {}) {
  if (id === null || id === undefined || id === '') return null;
  assertObjectId(id, `${label} ID`);
  const document = await Model.findOne({ _id: id, ...(allowArchived ? {} : { archivedAt: null }) });
  if (!document) throw new ApiError(400, `${label} is unavailable.`);
  return document;
}

export function parseListQuery(query, { sortFields = ['createdAt', 'updatedAt'], defaultSort = 'createdAt' } = {}) {
  const integer = (value, fallback) => {
    if (value === undefined || value === '') return fallback;
    if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new ApiError(400, 'Pagination must use positive integers.');
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1) throw new ApiError(400, 'Pagination must use positive integers.');
    return parsed;
  };
  const page = integer(query.page, 1);
  const limit = Math.min(integer(query.limit, 25), 100);
  if (query.search !== undefined && typeof query.search !== 'string') throw new ApiError(400, 'Search must be text.');
  const search = (query.search || '').trim().slice(0, 500);
  const sortField = typeof query.sort === 'string' && sortFields.includes(query.sort) ? query.sort : defaultSort;
  const order = query.order === 'asc' ? 1 : -1;
  return { page, limit, skip: (page - 1) * limit, search, sort: { [sortField]: order, _id: order } };
}

export function errorHandler(error, _req, res, _next) {
  if (res.headersSent) {
    // The default Express handler can log full driver errors after a streamed response.
    // End the stream without exposing request data or database error contents.
    console.error(`Response interrupted (${error?.name || 'Error'}).`);
    res.destroy();
    return;
  }
  let status = error instanceof ApiError ? error.status : 500;
  let message = error instanceof ApiError ? error.message : 'Something went wrong. Please try again.';
  let details = error instanceof ApiError ? error.details : undefined;
  if (error?.name === 'ValidationError') {
    status = 400;
    message = 'Please check the supplied fields.';
    details = Object.keys(error.errors || {}).map((field) => ({ field, message: 'This field contains an invalid value.' }));
  } else if (error?.name === 'CastError') {
    status = 400;
    message = 'A supplied identifier or value is invalid.';
  } else if (error?.code === 11000) {
    status = 409;
    message = 'A record with this unique value already exists.';
  } else if (error?.name === 'VersionError') {
    status = 409;
    message = 'This record changed while you were editing. Reload it and try again.';
  } else if (error?.type === 'entity.too.large' || error?.code === 'LIMIT_FILE_SIZE') {
    status = 413;
    message = 'The submitted file or request is too large.';
  } else if (error?.type === 'entity.parse.failed') {
    status = 400;
    message = 'The request body must contain valid JSON.';
  } else if (error?.name === 'MulterError') {
    status = 400;
    message = 'Please upload one supported file using the file field.';
  }
  if (status >= 500) console.error(`Request failed (${error?.name || 'Error'}).`);
  res.status(status).json({ error: { message, ...(details === undefined ? {} : { details }) } });
}
