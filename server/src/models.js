import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';

const { Schema } = mongoose;
const ref = (model, extra = {}) => ({ type: Schema.Types.ObjectId, ref: model, ...extra });
const text = (extra = {}) => ({ type: String, trim: true, default: '', ...extra });
const finiteOrEmpty = (value) => value == null || Number.isFinite(value);
const amount = (extra = {}) => ({ type: Number, min: 0, validate: { validator: finiteOrEmpty, message: 'Amount must be finite.' }, ...extra });
const archivedAt = { type: Date, default: null, index: true };
const options = { timestamps: true, optimisticConcurrency: true };

export const USER_ROLES = ['admin', 'manager', 'member'];
export const EXPERT_STATUSES = ['Unclassified', 'Active', 'Inactive', 'Do Not Contact'];
export const PROJECT_STATUSES = ['Draft', 'Active', 'On Hold', 'Completed', 'Cancelled'];
export const ASSIGNMENT_STATUSES = ['Added', 'Contacted', 'Interested', 'Screening', 'Screened', 'Shortlisted', 'Interviewed', 'Scheduled', 'Completed', 'Declined', 'Not Relevant', 'On Hold'];
export const ACTIVITY_TYPES = ['Email', 'Call', 'LinkedIn', 'Screening', 'Interview', 'Consultation', 'Follow-up', 'Note', 'Payment', 'Status change', 'Other'];

const userSchema = new Schema({
  name: text({ required: true, maxlength: 150 }),
  email: { type: String, trim: true, lowercase: true, required: true, maxlength: 254, unique: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: USER_ROLES, default: 'member' },
  active: { type: Boolean, default: true },
  sessionVersion: { type: Number, default: 0, min: 0 },
  archivedAt,
}, options);
userSchema.set('toJSON', {
  transform(_doc, result) { delete result.passwordHash; delete result.__v; return result; },
});

const industrySchema = new Schema({
  name: text({ required: true, maxlength: 200 }),
  active: { type: Boolean, default: true },
  archivedAt,
}, options);
industrySchema.index({ name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });

const sectorSchema = new Schema({
  name: text({ required: true, maxlength: 200 }),
  industry: ref('Industry', { required: true, index: true }),
  active: { type: Boolean, default: true },
  archivedAt,
}, options);
sectorSchema.index({ industry: 1, name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });

const expertSchema = new Schema({
  expertId: { type: String, required: true, unique: true, default: () => `EXP-${randomUUID()}` },
  fullName: text({ required: true, maxlength: 250 }),
  country: text({ maxlength: 150 }),
  currentCompany: text({ maxlength: 500 }),
  currentPosition: text({ maxlength: 500 }),
  email: { ...text({ maxlength: 254 }), lowercase: true },
  emails: { type: [{ type: String, trim: true, lowercase: true, maxlength: 254 }], default: [] },
  phoneNumber: text({ maxlength: 200 }),
  linkedinProfile: text({ maxlength: 2000 }),
  industry: ref('Industry', { default: null, index: true }),
  sector: ref('Sector', { default: null, index: true }),
  status: text({ default: 'Unclassified', maxlength: 150, index: true }),
  hourlyRate: amount(),
  currency: { type: String, trim: true, uppercase: true, maxlength: 12 },
  recruitedBy: ref('User', { default: null, index: true }),
  legacyRecruiter: text({ maxlength: 500 }),
  remarks: text({ maxlength: 50000 }),
  tags: { type: [{ type: String, trim: true, maxlength: 150 }], default: [] },
  legacyObservations: { type: [Schema.Types.Mixed], default: [] },
  archivedAt,
}, options);
expertSchema.index({ fullName: 1 });
expertSchema.index({ email: 1 });
expertSchema.index({ emails: 1 });
expertSchema.index({ phoneNumber: 1 });
expertSchema.index({ linkedinProfile: 1 });
expertSchema.index({ country: 1 });
expertSchema.index({ currentCompany: 1 });
expertSchema.index({ tags: 1 });
expertSchema.index({ archivedAt: 1, createdAt: -1 });

const clientSchema = new Schema({
  clientId: { type: String, required: true, unique: true, default: () => `CLI-${randomUUID()}` },
  clientName: text({ required: true, maxlength: 300 }),
  status: text({ default: 'Active', maxlength: 150 }),
  primaryContactName: text({ maxlength: 250 }),
  primaryContactEmail: { ...text({ maxlength: 254 }), lowercase: true },
  phone: text({ maxlength: 200 }),
  notes: text({ maxlength: 50000 }),
  archivedAt,
}, options);
clientSchema.index({ archivedAt: 1, clientName: 1 });

const projectSchema = new Schema({
  projectId: { type: String, required: true, unique: true, default: () => `PRJ-${randomUUID()}` },
  projectName: text({ required: true, maxlength: 500 }),
  client: ref('Client', { default: null, index: true }),
  industry: ref('Industry', { default: null, index: true }),
  sector: ref('Sector', { default: null, index: true }),
  owner: ref('User', { default: null, index: true }),
  status: text({ default: 'Draft', maxlength: 150, index: true }),
  priority: { type: String, enum: ['Low', 'Normal', 'High', 'Urgent'], default: 'Normal' },
  startDate: Date,
  deadline: Date,
  completedDate: Date,
  description: text({ maxlength: 50000 }),
  notes: text({ maxlength: 50000 }),
  archivedAt,
}, options);
projectSchema.index({ archivedAt: 1, createdAt: -1 });
projectSchema.index({ projectName: 1 });

const assignmentSchema = new Schema({
  expert: ref('Expert', { required: true, index: true }),
  project: ref('Project', { required: true, index: true }),
  assignmentStatus: text({ default: 'Added', maxlength: 150, index: true }),
  assignedAt: { type: Date, default: Date.now },
  contactedAt: Date,
  screenedAt: Date,
  interviewDate: Date,
  completedAt: Date,
  expertRate: amount(),
  currency: { type: String, trim: true, uppercase: true, maxlength: 12 },
  notes: text({ maxlength: 50000 }),
  createdBy: ref('User', { default: null }),
  removedAt: { type: Date, default: null, index: true },
  archivedAt,
}, options);
assignmentSchema.index({ expert: 1, project: 1 }, { unique: true });
assignmentSchema.index({ project: 1, removedAt: 1, assignmentStatus: 1 });

const activitySchema = new Schema({
  expert: ref('Expert', { default: null, index: true }),
  project: ref('Project', { default: null, index: true }),
  assignment: ref('Assignment', { default: null, index: true }),
  activityType: text({ required: true, maxlength: 150, index: true }),
  activityDate: { type: Date, required: true, default: Date.now, index: true },
  performedBy: ref('User', { required: true, index: true }),
  outcome: text({ maxlength: 500 }),
  notes: text({ maxlength: 50000 }),
  durationMinutes: amount(),
  clientRate: amount(),
  expertRate: amount(),
  currency: { type: String, trim: true, uppercase: true, maxlength: 12 },
  billingAmount: amount(),
  expertCost: amount(),
  expertCostIsManual: { type: Boolean, default: false },
  revenue: amount(),
  margin: { type: Number, validate: { validator: finiteOrEmpty, message: 'Margin must be finite.' } },
  archivedAt,
}, options);
activitySchema.index({ archivedAt: 1, activityDate: -1 });

const auditSchema = new Schema({
  user: ref('User', { default: null, index: true }),
  action: text({ required: true, maxlength: 100 }),
  entityType: text({ required: true, maxlength: 100 }),
  entityId: { type: Schema.Types.ObjectId, default: null },
  summary: text({ maxlength: 2000 }),
  archivedAt,
}, options);
auditSchema.index({ createdAt: -1 });
auditSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });

const importBatchSchema = new Schema({
  owner: ref('User', { default: null, index: true }),
  createdBy: ref('User', { default: null, index: true }),
  status: text({ default: 'preview', index: true }),
  expiresAt: { type: Date, default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
  archivedAt,
}, { ...options, strict: false });
importBatchSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const settingsSchema = new Schema({
  key: { type: String, default: 'organization', unique: true, required: true },
  organizationName: text({ default: 'ExNett', maxlength: 200 }),
  projectStatuses: { type: [String], default: () => [...PROJECT_STATUSES] },
  assignmentStatuses: { type: [String], default: () => [...ASSIGNMENT_STATUSES] },
  demoMode: { type: Boolean, default: false },
  archivedAt,
}, options);

const model = (name, schema) => mongoose.models[name] || mongoose.model(name, schema);
export const User = model('User', userSchema);
export const Expert = model('Expert', expertSchema);
export const Industry = model('Industry', industrySchema);
export const Sector = model('Sector', sectorSchema);
export const Client = model('Client', clientSchema);
export const Project = model('Project', projectSchema);
export const Assignment = model('Assignment', assignmentSchema);
export const Activity = model('Activity', activitySchema);
export const AuditLog = model('AuditLog', auditSchema);
export const ImportBatch = model('ImportBatch', importBatchSchema);
export const Settings = model('Settings', settingsSchema);
