import { createHash, randomBytes } from 'node:crypto';
import { Expert, ImportBatch } from '../models.js';
import { ApiError } from '../core.js';
import { parseFile, LIMITS } from './parser.js';
import { resolveMapping, normalizeRow, markDuplicates, identityKeys, MAPPABLE_FIELDS, matchKey, canonicalLinkedIn } from './normalize.js';

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const fingerprint = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : stableJson(value)).digest('hex');

export function publicBatch(batch) {
  const object = typeof batch.toObject === 'function' ? batch.toObject() : batch;
  return {
    _id: object._id, status: object.status, previewToken: object.previewToken,
    headers: object.headers, mapping: object.mapping, mappableFields: MAPPABLE_FIELDS,
    sheetName: object.sheetName, headerRow: object.headerRow,
    rows: (object.rows || []).map(({ raw, ...row }) => row), summary: object.summary,
    projectLabels: object.projectLabels, statusLabels: object.statusLabels,
    industryLabels: object.industryLabels, recruiterLabels: object.recruiterLabels,
    previousBatchId: object.previousBatchId || null, createdAt: object.createdAt, expiresAt: object.expiresAt,
    ...(object.results ? { results: object.results } : {}),
  };
}

export function candidateSnapshot(expert, matchedOn) {
  return {
    _id: String(expert._id), expertId: expert.expertId, fullName: expert.fullName,
    currentCompany: expert.currentCompany || '', email: expert.email || '', linkedinProfile: expert.linkedinProfile || '',
    updatedAt: expert.updatedAt?.toISOString?.() || expert.updatedAt, version: expert.__v || 0, matchedOn,
    fields: Object.fromEntries(['fullName', 'country', 'currentCompany', 'currentPosition', 'email', 'emails', 'phoneNumber', 'linkedinProfile', 'tags', 'remarks', 'industry', 'recruitedBy', 'legacyRecruiter'].map(field => [field, expert[field] ?? ''])),
  };
}

function expertKeys(expert) {
  return [expert.expertId && `id:${expert.expertId}`, ...[expert.email, ...(expert.emails || [])].filter(Boolean).map(email => `email:${matchKey(email)}`), canonicalLinkedIn(expert.linkedinProfile || '') && `linkedin:${canonicalLinkedIn(expert.linkedinProfile)}`, expert.fullName && `name:${matchKey(expert.fullName)}`].filter(Boolean);
}

export async function stageImport(file, mapping, user) {
  const parsed = await parseFile(file.buffer, file.originalname);
  const resolved = resolveMapping(parsed.headers, mapping);
  const rows = markDuplicates(parsed.records.map(record => normalizeRow(record, resolved)));
  const fileFingerprint = fingerprint(file.buffer), mappingFingerprint = fingerprint(resolved);
  const previous = await ImportBatch.findOne({ owner: user._id, fileFingerprint, mappingFingerprint, status: 'committed' }).sort({ updatedAt: -1 }).lean();
  // Bounded candidate scan normalizes stored legacy contacts without requiring schema changes.
  const experts = await Expert.find({ archivedAt: null }).select('expertId fullName country currentCompany currentPosition email emails phoneNumber linkedinProfile tags remarks industry recruitedBy legacyRecruiter updatedAt __v legacyObservations.sourceFingerprint legacyObservations.rowNumber').limit(20001).lean();
  if (experts.length > 20000) throw new ApiError(422, 'The expert database exceeds the current import matching limit. Narrow the import after adding indexed matching.');
  const index = new Map(), byId = new Map();
  for (const expert of experts) {
    byId.set(String(expert._id), expert);
    for (const key of expertKeys(expert)) {
      if (!index.has(key)) index.set(key, new Set());
      index.get(key).add(String(expert._id));
    }
  }
  const priorTargets = new Map((previous?.results?.rows || []).filter(row => row.expertId).map(row => [row.rowNumber, row.expertId]));
  // Source links survive the short-lived staging record without preserving the upload file.
  const sourceRows = new Map(rows.map(row => [fingerprint({ fileFingerprint, mappingFingerprint, rowNumber: row.rowNumber }), row.rowNumber]));
  for (const expert of experts) for (const observation of expert.legacyObservations || []) {
    if (observation.sourceFingerprint && sourceRows.has(observation.sourceFingerprint)) priorTargets.set(sourceRows.get(observation.sourceFingerprint), String(expert._id));
  }
  const archivedExperts = await Expert.find({ archivedAt: { $ne: null }, $or: [
    { 'legacyObservations.sourceFingerprint': { $in: [...sourceRows.keys()] } },
    { expertId: { $in: rows.map(row => row.normalized.expertId).filter(Boolean) } },
  ] }).select('expertId legacyObservations.sourceFingerprint').lean();
  const archivedSourceKeys = new Set(archivedExperts.flatMap(expert => (expert.legacyObservations || []).map(observation => observation.sourceFingerprint).filter(Boolean)));
  const archivedIds = new Set(archivedExperts.map(expert => expert.expertId));
  for (const row of rows) {
    const sourceKey = fingerprint({ fileFingerprint, mappingFingerprint, rowNumber: row.rowNumber });
    if (archivedSourceKeys.has(sourceKey) || (row.normalized.expertId && archivedIds.has(row.normalized.expertId))) row.errors.push('This source belongs to an archived expert. Restore and review that expert separately, or skip this row; imports do not undo an archive.');
    const matches = new Map();
    for (const key of identityKeys(row)) for (const id of index.get(key) || []) {
      if (!matches.has(id)) matches.set(id, []);
      matches.get(id).push(key.slice(0, key.indexOf(':')));
    }
    const priorId = priorTargets.get(row.rowNumber);
    if (priorId && byId.has(String(priorId))) {
      row.previousExpertId = String(priorId);
      matches.set(String(priorId), [...new Set([...(matches.get(String(priorId)) || []), 'previousImport'])]);
      row.warnings.push('This unchanged source row was imported before. Its reviewed expert link is available; create is disabled to prevent repeat imports.');
    }
    row.candidates = [...matches].slice(0, 20).map(([id, signals]) => candidateSnapshot(byId.get(id), [...new Set(signals)]));
    if (matches.size > 20) row.errors.push('Too many matching experts. Resolve identity outside this import before committing this row.');
    if (row.candidates.length > 1) row.warnings.push('Identity evidence matches more than one existing expert. Explicit target selection is required.');
    if (row.candidates.some(candidate => matchKey(candidate.fullName) !== matchKey(row.normalized.fullName))) row.warnings.push('A matching contact is associated with a different name. Review identity before choosing a target.');
    row.action = row.errors.length ? 'skip' : (row.candidates.length || row.duplicateRows.length ? 'review' : 'create');
  }
  const summary = { total: rows.length, ready: rows.filter(row => row.action === 'create').length, review: rows.filter(row => row.action === 'review').length, invalid: rows.filter(row => row.errors.length).length, duplicate: rows.filter(row => row.duplicateRows.length).length };
  const labels = field => [...new Set(rows.map(row => row.normalized[field]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const fields = {
    owner: user._id, createdBy: user._id, status: 'preview', fileFingerprint, mappingFingerprint,
    parserVersion: 1, mappingVersion: 1, previewToken: randomBytes(24).toString('hex'),
    headers: parsed.headers, mapping: resolved, rows, summary, sheetName: parsed.sheetName,
    sheetIndex: parsed.sheetIndex, headerRow: parsed.headerRow, format: parsed.format,
    projectLabels: labels('projectLabel'), statusLabels: labels('legacyStatus'),
    industryLabels: labels('industryLabel'), recruiterLabels: labels('legacyRecruiter'),
    previousBatchId: previous?._id || null, expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
  };
  if (Buffer.byteLength(JSON.stringify(fields)) > LIMITS.stagingBytes) throw new ApiError(413, 'The normalized preview exceeds the safe staging limit. Split the upload into smaller files.');
  const batch = await ImportBatch.create(fields);
  return publicBatch(batch);
}
