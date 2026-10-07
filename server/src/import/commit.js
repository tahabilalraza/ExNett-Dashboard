import mongoose from 'mongoose';
import { Expert, Project, Assignment, Industry, User, AuditLog, ImportBatch, Settings, ASSIGNMENT_STATUSES } from '../models.js';
import { ApiError, isObjectId } from '../core.js';
import { PROFILE_FIELDS } from './normalize.js';
import { fingerprint } from './staging.js';

const object = value => value && typeof value === 'object' && !Array.isArray(value);
const filled = value => Array.isArray(value) ? value.length > 0 : value !== '' && value !== null && value !== undefined;

export function validateCommit(body, batch) {
  if (!object(body) || body.confirmed !== true || body.previewToken !== batch.previewToken) throw new ApiError(400, 'Explicit confirmation and this preview token are required.');
  if (!Array.isArray(body.decisions) || body.decisions.length !== batch.rows.length) throw new ApiError(400, 'Provide one explicit decision for every source row.');
  const rowNumbers = new Set(batch.rows.map(row => row.rowNumber));
  const seen = new Set();
  for (const decision of body.decisions) {
    if (!object(decision) || !Number.isInteger(decision.rowNumber) || !rowNumbers.has(decision.rowNumber) || seen.has(decision.rowNumber)) throw new ApiError(400, 'Row decisions contain an unknown or repeated row.');
    seen.add(decision.rowNumber);
    if (!['create', 'link', 'update', 'skip'].includes(decision.action)) throw new ApiError(400, 'Every row needs a create, link, update, or skip decision.');
    if (decision.expertId !== undefined && !isObjectId(decision.expertId)) throw new ApiError(400, 'A selected expert ID is invalid.');
    if (decision.projectId !== undefined && !isObjectId(decision.projectId)) throw new ApiError(400, 'A selected project ID is invalid.');
    if (decision.linkRowNumber !== undefined && (!Number.isInteger(decision.linkRowNumber) || decision.linkRowNumber >= decision.rowNumber || !rowNumbers.has(decision.linkRowNumber))) throw new ApiError(400, 'A linked source row must be an earlier reviewed row.');
    if (decision.expertId && decision.linkRowNumber !== undefined) throw new ApiError(400, 'Choose an expert target or an earlier source row, not both.');
    if (['link', 'update'].includes(decision.action) && !decision.expertId && decision.linkRowNumber === undefined) throw new ApiError(400, 'Link and update decisions require a visible expert target.');
    if (decision.action === 'update' && !Array.isArray(decision.fields)) throw new ApiError(400, 'Update decisions require an explicit profile field list.');
    if (decision.fields !== undefined && (!Array.isArray(decision.fields) || decision.fields.some(field => !PROFILE_FIELDS.includes(field)) || new Set(decision.fields).size !== decision.fields.length)) throw new ApiError(400, 'The selected update fields contain unsupported or repeated fields.');
    if (decision.assignmentFields !== undefined && (!Array.isArray(decision.assignmentFields) || decision.assignmentFields.some(field => !['status', 'rate'].includes(field)))) throw new ApiError(400, 'Assignment fields may contain status and rate only.');
    if (decision.projectName !== undefined && (typeof decision.projectName !== 'string' || !decision.projectName.trim() || decision.projectName.length > 300)) throw new ApiError(400, 'An explicitly created project needs a valid name.');
    if (decision.status !== undefined && (typeof decision.status !== 'string' || decision.status.length > 150)) throw new ApiError(400, 'Assignment status is invalid.');
  }
  for (const name of ['projectMapping', 'industryMapping', 'statusMapping', 'recruiterMapping']) {
    if (body[name] !== undefined && (!object(body[name]) || Object.keys(body[name]).length > 2000)) throw new ApiError(400, `${name} must be a label mapping object.`);
    for (const [label, choice] of Object.entries(body[name] || {})) {
      if (label.length > 300) throw new ApiError(400, 'A mapped source label exceeds the allowed size.');
      if (name === 'statusMapping') {
        if (typeof choice !== 'string' || !choice.trim() || choice.length > 150) throw new ApiError(400, 'Mapped assignment statuses must be nonempty strings.');
        continue;
      }
      if (typeof choice === 'string') {
        if (!isObjectId(choice)) throw new ApiError(400, `A ${name} target ID is invalid.`);
        continue;
      }
      if (!object(choice)) throw new ApiError(400, `A ${name} choice must select a target, explicitly create it, or skip.`);
      if (choice.skip === true) continue;
      if (name === 'recruiterMapping') {
        if (!isObjectId(choice.userId)) throw new ApiError(400, 'A recruiter mapping requires a valid existing user.');
        continue;
      }
      const idField = name === 'projectMapping' ? 'projectId' : 'industryId';
      if (choice[idField] !== undefined) {
        if (!isObjectId(choice[idField])) throw new ApiError(400, 'A mapped reference ID is invalid.');
        if (choice.create) throw new ApiError(400, 'Choose an existing reference or explicit creation, not both.');
      } else if (choice.create !== true) throw new ApiError(400, 'A mapping requires a target, explicit creation, or skip.');
      if (choice.name !== undefined && (typeof choice.name !== 'string' || !choice.name.trim() || choice.name.length > (name === 'industryMapping' ? 200 : 300))) throw new ApiError(400, 'A mapped creation name is invalid.');
    }
  }
  return {
    decisions: [...body.decisions].sort((a, b) => a.rowNumber - b.rowNumber),
    projectMapping: body.projectMapping || {}, industryMapping: body.industryMapping || {},
    statusMapping: body.statusMapping || {}, recruiterMapping: body.recruiterMapping || {},
  };
}

function accessible(batch, user) {
  if (!batch || batch.archivedAt || (String(batch.owner) !== String(user._id) && user.role !== 'admin')) throw new ApiError(404, 'Import preview not found.');
  if (batch.expiresAt && new Date(batch.expiresAt) <= new Date()) throw new ApiError(410, 'This import preview has expired. Upload the file again.');
}

export async function getOwnedBatch(id, user) {
  if (!isObjectId(id)) throw new ApiError(400, 'Import ID is invalid.');
  const batch = await ImportBatch.findById(id);
  accessible(batch, user);
  return batch;
}

export async function commitImport(id, body, user) {
  const initial = await getOwnedBatch(id, user);
  const choices = validateCommit(body, initial);
  const decisionsHash = fingerprint(choices);
  if (initial.status === 'committed') {
    if (initial.decisionsHash !== decisionsHash) throw new ApiError(409, 'This preview was already committed with different decisions.');
    return initial.results;
  }
  if (initial.status !== 'preview') throw new ApiError(409, 'This preview is no longer available for confirmation.');
  const session = await mongoose.startSession();
  let results;
  try {
    await session.withTransaction(async () => {
      const currentUser = await User.findOne({ _id: user._id, active: true, archivedAt: null, role: { $in: ['admin', 'manager'] } }).session(session);
      if (!currentUser) throw new ApiError(403, 'Import permission is no longer available.');
      const batch = await ImportBatch.findById(id).session(session);
      accessible(batch, currentUser);
      if (body.previewToken !== batch.previewToken) throw new ApiError(409, 'The preview changed after review. Review it again before committing.');
      if (batch.status === 'committed') {
        if (batch.decisionsHash !== decisionsHash) throw new ApiError(409, 'This preview was already committed with different decisions.');
        results = batch.results; return;
      }
      if (batch.status !== 'preview') throw new ApiError(409, 'This preview is no longer available.');
      // Claim the batch in this same transaction: concurrent confirmations conflict and retry safely.
      batch.set('status', 'committing'); await batch.save({ session });
      const settings = await Settings.findOne({ key: 'organization' }).session(session).lean();
      const allowedStatuses = new Set(settings?.assignmentStatuses?.length ? settings.assignmentStatuses : ASSIGNMENT_STATUSES);
      const sourceRows = new Map(batch.rows.map(row => [row.rowNumber, row]));
      const resolvedRows = new Map(), documents = new Map(), checked = new Set(), projectCache = new Map(), industryCache = new Map();
      const summary = { created: 0, linked: 0, updated: 0, skipped: 0, assignments: 0, unresolved: 0 };
      const resultRows = [];
      const reference = async (Model, value, label, extra = {}) => {
        if (!isObjectId(value)) throw new ApiError(400, `The selected ${label} ID is invalid.`);
        const found = await Model.findOne({ _id: value, archivedAt: null, ...extra }).session(session);
        if (!found) throw new ApiError(400, `The selected ${label} is unavailable.`);
        return found;
      };
      const industryFor = async (row) => {
        const label = row.normalized.industryLabel;
        if (!label || !Object.hasOwn(choices.industryMapping, label)) return null;
        if (industryCache.has(label)) return industryCache.get(label);
        const choice = choices.industryMapping[label];
        if (object(choice) && choice.skip) return null;
        let industry;
        const selected = typeof choice === 'string' ? choice : choice?.industryId;
        if (selected) industry = await reference(Industry, selected, 'industry', { active: true });
        else if (object(choice) && choice.create === true) {
          const name = (choice.name || label).trim();
          if (!name || name.length > 200) throw new ApiError(400, 'Industry name exceeds the allowed size.');
          industry = await Industry.findOne({ name, archivedAt: null, active: true }).collation({ locale: 'en', strength: 2 }).session(session);
          if (!industry) [industry] = await Industry.create([{ name }], { session });
        } else throw new ApiError(400, 'Industry mapping needs an existing industry, explicit creation, or skip.');
        industryCache.set(label, industry); return industry;
      };
      const projectFor = async (row, decision) => {
        if (decision.projectId) return reference(Project, decision.projectId, 'project');
        const label = row.normalized.projectLabel;
        const choice = decision.projectName ? { create: true, name: decision.projectName } : (label && Object.hasOwn(choices.projectMapping, label) ? choices.projectMapping[label] : null);
        if (!choice || (object(choice) && choice.skip)) return null;
        const key = decision.projectName ? `explicit:${decision.projectName.trim()}` : label;
        if (projectCache.has(key)) return projectCache.get(key);
        let project;
        const selected = typeof choice === 'string' ? choice : choice?.projectId;
        if (selected) project = await reference(Project, selected, 'project');
        else if (object(choice) && choice.create === true) {
          const name = (choice.name || label || '').trim();
          if (!name || name.length > 300) throw new ApiError(400, 'A project mapping needs a valid project name.');
          [project] = await Project.create([{ projectName: name, status: 'Draft' }], { session });
        } else throw new ApiError(400, 'Project mapping needs an existing project, explicit creation, or skip.');
        projectCache.set(key, project); return project;
      };
      for (const decision of choices.decisions) {
        const row = sourceRows.get(decision.rowNumber);
        if (decision.action === 'skip') { summary.skipped++; resultRows.push({ rowNumber: row.rowNumber, action: 'skip' }); continue; }
        if (row.errors.length) throw new ApiError(422, 'A row with blocking validation errors must be skipped.', { rowNumber: row.rowNumber });
        const profile = row.normalized;
        let expert;
        if (decision.action === 'create') {
          if (row.previousExpertId) throw new ApiError(409, 'This source row was imported before. Link to its reviewed expert or skip it.', { rowNumber: row.rowNumber });
          if (profile.expertId && await Expert.exists({ expertId: profile.expertId }).session(session)) throw new ApiError(409, 'The supplied Expert ID already exists. Choose its reviewed target.', { rowNumber: row.rowNumber });
          const input = Object.fromEntries(PROFILE_FIELDS.filter(field => !['industry', 'recruitedBy'].includes(field) && filled(profile[field])).map(field => [field, profile[field]]));
          input.emails = profile.emails;
          // Preserve an explicitly supplied identifier so edited files can match it.
          // The inspected historical workbook has no ID; its new experts use the UUID default.
          if (profile.expertId) input.expertId = profile.expertId;
          [expert] = await Expert.create([{ ...input, status: 'Unclassified' }], { session });
          documents.set(String(expert._id), expert); checked.add(String(expert._id)); summary.created++;
        } else {
          const targetId = decision.expertId || resolvedRows.get(decision.linkRowNumber);
          if (!targetId) throw new ApiError(400, 'The linked source row was skipped or has no expert target.', { rowNumber: row.rowNumber });
          if (!documents.has(String(targetId))) documents.set(String(targetId), await reference(Expert, String(targetId), 'expert'));
          expert = documents.get(String(targetId));
          if (!checked.has(String(targetId))) {
            const snapshot = row.candidates.find(candidate => String(candidate._id) === String(targetId));
            if (!snapshot) throw new ApiError(409, 'Resolve this expert into the preview before confirming its target.', { rowNumber: row.rowNumber });
            if ((expert.__v || 0) !== snapshot.version || new Date(expert.updatedAt).getTime() !== new Date(snapshot.updatedAt).getTime()) throw new ApiError(409, 'A selected expert changed since this preview. Upload or resolve it again.', { rowNumber: row.rowNumber });
            checked.add(String(targetId));
          }
          if (decision.action === 'update') {
            for (const field of decision.fields) {
              if (['industry', 'recruitedBy'].includes(field)) continue;
              if (filled(profile[field])) expert.set(field, profile[field]);
              if (field === 'email' && profile.emails.length) expert.set('emails', [...new Set([...(expert.emails || []), ...profile.emails])]);
            }
            summary.updated++;
          } else summary.linked++;
        }
        const industry = await industryFor(row);
        if (industry && (decision.action === 'create' || (decision.action === 'update' && decision.fields.includes('industry')))) expert.set('industry', industry._id);
        const recruiterChoice = profile.legacyRecruiter && Object.hasOwn(choices.recruiterMapping, profile.legacyRecruiter) ? choices.recruiterMapping[profile.legacyRecruiter] : null;
        if (recruiterChoice && !(object(recruiterChoice) && recruiterChoice.skip) && (decision.action === 'create' || (decision.action === 'update' && decision.fields.includes('recruitedBy')))) {
          const recruiter = await reference(User, typeof recruiterChoice === 'string' ? recruiterChoice : recruiterChoice?.userId, 'recruiter', { active: true });
          expert.set('recruitedBy', recruiter._id);
        }
        const project = await projectFor(row, decision);
        let assignment = null;
        if (project) {
          assignment = await Assignment.findOne({ expert: expert._id, project: project._id }).session(session);
          const desiredStatus = decision.status || (Object.hasOwn(choices.statusMapping, profile.legacyStatus) ? choices.statusMapping[profile.legacyStatus] : null);
          const applyStatus = Boolean(decision.status || (decision.assignmentFields || []).includes('status'));
          const applyRate = (decision.assignmentFields || []).includes('rate');
          if (applyStatus && (!desiredStatus || typeof desiredStatus !== 'string' || !allowedStatuses.has(desiredStatus))) throw new ApiError(400, 'A reviewed assignment status must match a configured status.', { rowNumber: row.rowNumber });
          if (applyRate && !profile.rate) throw new ApiError(400, 'This quote needs an explicit valid amount and ISO currency before it can become an assignment rate.', { rowNumber: row.rowNumber });
          if (!assignment) {
            const input = { expert: expert._id, project: project._id, createdBy: user._id };
            if (applyStatus) input.assignmentStatus = desiredStatus;
            if (applyRate) { input.expertRate = profile.rate.amount; input.currency = profile.rate.currency; }
            [assignment] = await Assignment.create([input], { session }); summary.assignments++;
          } else {
            // Current assignment fields were not part of this preview. Preserve them, including conflicts.
            if ((applyStatus && assignment.assignmentStatus !== desiredStatus) || (applyRate && (assignment.expertRate !== profile.rate.amount || assignment.currency !== profile.rate.currency))) throw new ApiError(409, 'An existing assignment has different current status or quote values. Import the legacy observation, then review that assignment separately.', { rowNumber: row.rowNumber });
            if (assignment.removedAt || assignment.archivedAt) throw new ApiError(409, 'This membership was removed after its previous import. Restore it separately or keep the project label as an unresolved observation.', { rowNumber: row.rowNumber });
          }
        }
        const unresolved = Boolean((profile.projectLabel && !project) || (profile.industryLabel && !industry) || (profile.legacyRate && !profile.rate) || (profile.legacyStatus && !(project && (decision.status || (decision.assignmentFields || []).includes('status')))));
        if (unresolved) summary.unresolved++;
        const sourceFingerprint = fingerprint({ fileFingerprint: batch.fileFingerprint, mappingFingerprint: batch.mappingFingerprint, rowNumber: row.rowNumber });
        const observation = {
          sourceFingerprint,
          importBatch: batch._id, rowNumber: row.rowNumber, importedAt: new Date(), importedBy: user._id,
          project: project?._id || null, legacyProject: profile.projectLabel,
          legacyStatus: profile.legacyStatus, legacyRate: profile.legacyRate, rate: profile.rate,
          legacyRecruiter: profile.legacyRecruiter, legacyIndustry: profile.industryLabel,
          legacyExpertId: profile.expertId,
          scope: project ? 'project' : 'unresolved', profile: Object.fromEntries(PROFILE_FIELDS.filter(field => !['industry', 'recruitedBy'].includes(field)).map(field => [field, profile[field]])),
          source: row.raw, decision: decision.action, appliedFields: decision.action === 'update' ? decision.fields : [],
        };
        if (!expert.legacyObservations.some(existing => existing.sourceFingerprint === sourceFingerprint)) expert.legacyObservations.push(observation);
        await expert.save({ session });
        resolvedRows.set(row.rowNumber, String(expert._id));
        resultRows.push({ rowNumber: row.rowNumber, action: decision.action, expertId: String(expert._id), projectId: project ? String(project._id) : null, assignmentId: assignment ? String(assignment._id) : null, unresolved });
      }
      results = { status: 'committed', summary, rows: resultRows };
      batch.set('status', 'committed'); batch.set('decisionsHash', decisionsHash); batch.set('decisions', choices);
      batch.set('results', results); batch.set('committedAt', new Date());
      batch.set('expiresAt', new Date(Date.now() + 30 * 24 * 3600 * 1000));
      await batch.save({ session });
      await AuditLog.create([{ user: user._id, action: 'import.commit', entityType: 'ImportBatch', entityId: batch._id, summary: `Import committed: ${summary.created} created, ${summary.linked} linked, ${summary.updated} updated, ${summary.skipped} skipped; ${summary.assignments} memberships.` }], { session });
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    return results;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (/Transaction numbers are only allowed|replica set|mongos/i.test(error.message || '')) throw new ApiError(503, 'Imports require MongoDB configured as a replica set for atomic writes.');
    throw error;
  } finally { await session.endSession(); }
}
