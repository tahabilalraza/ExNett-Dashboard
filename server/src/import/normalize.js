import { ImportError } from './parser.js';

export const MAPPABLE_FIELDS = [
  ['expertId', 'Expert ID (optional)'], ['fullName', 'Full Name'], ['country', 'Country'],
  ['currentCompany', 'Current Company'], ['currentPosition', 'Current Position'],
  ['email', 'Email'], ['phoneNumber', 'Phone Number'], ['linkedinProfile', 'LinkedIn Profile'],
  ['projectLabel', 'Project'], ['industryLabel', 'Industry'], ['legacyStatus', 'Status'],
  ['legacyRate', 'Hourly Rate'], ['legacyRecruiter', 'Recruited By'], ['tags', 'Tags'], ['remarks', 'Remarks'],
].map(([key, label]) => ({ key, label }));
export const PROFILE_FIELDS = ['fullName', 'country', 'currentCompany', 'currentPosition', 'email', 'phoneNumber', 'linkedinProfile', 'tags', 'remarks', 'industry', 'recruitedBy', 'legacyRecruiter'];

export const matchKey = value => String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
const placeholder = value => /^(?:n\/?a|none|null|nil|not available|not provided|tbd|unknown|[-–—.]+)$/i.test(value.trim());
const aliases = Object.fromEntries(MAPPABLE_FIELDS.flatMap(({ key, label }) => [[matchKey(label.replace(' (optional)', '')), key], [matchKey(key), key]]));
Object.assign(aliases, { 'expert id': 'expertId', 'expert identifier': 'expertId', 'name': 'fullName', 'phone': 'phoneNumber', 'linkedin': 'linkedinProfile', 'rate': 'legacyRate', 'recruiter': 'legacyRecruiter' });

export function resolveMapping(headers, provided = {}) {
  if (!provided || typeof provided !== 'object' || Array.isArray(provided)) throw new ImportError('Mapping must be an object from header names to fields.');
  const allowed = new Set([...MAPPABLE_FIELDS.map(field => field.key), 'ignore']);
  const mapping = Object.create(null);
  for (const header of headers) {
    const mapped = Object.hasOwn(provided, header) ? provided[header] : (Object.hasOwn(aliases, matchKey(header)) ? aliases[matchKey(header)] : undefined);
    if (!mapped) throw new ImportError('Some headers need an explicit field mapping or an Ignore choice.', { headers: headers.filter(name => !Object.hasOwn(provided, name) && !aliases[matchKey(name)]), mappableFields: MAPPABLE_FIELDS });
    if (!allowed.has(mapped)) throw new ImportError('A header has an unsupported field mapping.');
    mapping[header] = mapped;
  }
  const fields = Object.values(mapping).filter(field => field !== 'ignore');
  if (new Set(fields).size !== fields.length) throw new ImportError('Each destination field may be mapped only once.');
  if (!fields.includes('fullName')) throw new ImportError('Map one column to Full Name. Expert ID and contact columns are optional.');
  return mapping;
}

export function canonicalLinkedIn(value) {
  let url;
  try { url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`); }
  catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null;
  if (!/^(?:[a-z]{2,3}\.|www\.)?linkedin\.com$/i.test(url.hostname)) return null;
  const path = url.pathname.match(/^\/in\/([^/\s]+)\/?$/i);
  if (!path) return null;
  return `https://www.linkedin.com/in/${path[1].toLowerCase()}`;
}

export function parseRate(value) {
  const text = String(value || '').trim();
  if (!text || placeholder(text)) return null;
  const matched = text.match(/^(?:([A-Za-z]{3})\s+)?([0-9]+(?:\.[0-9]{1,2})?)\s*([A-Za-z]{3})?$/);
  if (!matched || Boolean(matched[1]) === Boolean(matched[3])) return null;
  const currency = (matched[1] || matched[3]).toUpperCase();
  // ISO currency validation never supplies an implicit default.
  try { new Intl.NumberFormat('en', { style: 'currency', currency }); }
  catch { return null; }
  const supported = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('currency') : ['USD', 'EUR', 'GBP', 'PKR', 'INR', 'AED', 'CAD', 'AUD', 'CHF', 'JPY', 'CNY', 'SGD', 'HKD', 'SAR'];
  if (!supported.includes(currency)) return null;
  const amount = Number(matched[2]);
  if (!Number.isFinite(amount) || amount > 10000000) return null;
  return { amount, currency };
}

export function normalizeRow(source, mapping) {
  const raw = {}, cells = {}, warnings = [], errors = [];
  for (const [header, field] of Object.entries(mapping)) {
    if (field === 'ignore') continue;
    const cell = source.values[header];
    cells[field] = cell;
    raw[field] = cell;
    if (cell.kind === 'formula') warnings.push(`${header}: formula retained as unresolved source metadata; no formula or cached result was evaluated.`);
    if (cell.kind === 'error') warnings.push(`${header}: Excel error cell retained as unresolved metadata.`);
  }
  const value = field => {
    const text = (cells[field]?.text || '').trim().replace(/\r\n/g, '\n');
    return placeholder(text) ? '' : text;
  };
  const normalized = Object.fromEntries(['expertId', 'fullName', 'country', 'currentCompany', 'currentPosition', 'projectLabel', 'industryLabel', 'legacyStatus', 'legacyRate', 'legacyRecruiter', 'remarks'].map(field => [field, value(field)]));
  normalized.fullName = normalized.fullName.replace(/\s+/g, ' ');
  if (!normalized.fullName) errors.push('Full Name is required.');
  if (normalized.fullName.length > 200) errors.push('Full Name exceeds 200 characters.');
  if (normalized.expertId.length > 100) errors.push('Expert ID exceeds 100 characters.');
  for (const field of ['country', 'currentCompany', 'currentPosition', 'projectLabel', 'industryLabel', 'legacyStatus', 'legacyRecruiter']) {
    if (normalized[field].length > 300) errors.push(`${field} exceeds 300 characters.`);
  }
  if (normalized.country.length > 150) errors.push('Country exceeds 150 characters.');
  const emailText = value('email');
  normalized.emails = [...new Set((emailText.match(/[A-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+/gi) || []).map(email => email.toLowerCase()))];
  normalized.email = normalized.emails[0] || '';
  if (normalized.emails.some(email => email.length > 254) || normalized.emails.length > 20) errors.push('Recognized email contacts exceed the allowed size.');
  if (emailText && !normalized.emails.length) warnings.push('Email has no recognized address; original text remains in the legacy observation.');
  if (normalized.emails.length > 1) warnings.push('Multiple email addresses found. The first address is the proposed primary contact; all recognized addresses are retained.');
  if (normalized.emails.length === 1 && matchKey(emailText) !== normalized.email) warnings.push('Email extracted from surrounding text; review the proposed contact.');
  normalized.phoneNumber = value('phoneNumber');
  if (normalized.phoneNumber.length > 200) errors.push('Phone Number exceeds 200 characters.');
  if (cells.phoneNumber?.kind === 'number' && normalized.phoneNumber) {
    const number = Number(normalized.phoneNumber);
    if (Number.isInteger(number) && Number.isFinite(number)) normalized.phoneNumber = BigInt(number).toString();
    warnings.push('Phone was stored as an Excel number; lost prefixes or leading zeros cannot be restored. No country code was guessed.');
    if (!Number.isSafeInteger(number)) warnings.push('Numeric phone precision may already have been lost in Excel.');
  }
  const display = value('linkedinProfile'), target = cells.linkedinProfile?.hyperlink || '';
  const displayCanonical = display ? canonicalLinkedIn(display) : null, targetCanonical = target ? canonicalLinkedIn(target) : null;
  normalized.linkedinProfile = displayCanonical || targetCanonical || '';
  if (displayCanonical && targetCanonical && displayCanonical !== targetCanonical) {
    normalized.linkedinProfile = '';
    warnings.push('LinkedIn display and hyperlink identify different profiles; neither is applied without correction.');
  }
  if ((display || target) && !normalized.linkedinProfile) warnings.push('LinkedIn value needs review; the original display and target are retained without following the link.');
  if (normalized.linkedinProfile.length > 2000) errors.push('LinkedIn Profile exceeds 2000 characters.');
  if (target && !/^https:\/\//i.test(target)) warnings.push('LinkedIn hyperlink uses a non-HTTPS scheme; only a recognized public profile URL may be applied.');
  normalized.tags = value('tags') ? [...new Set(value('tags').split(/[,;\n]/).map(tag => tag.trim()).filter(Boolean))] : [];
  if (normalized.tags.length > 30 || normalized.tags.some(tag => tag.length > 100)) errors.push('Tags exceed the allowed size.');
  normalized.rate = parseRate(normalized.legacyRate);
  if (normalized.legacyRate && !normalized.rate) warnings.push('Hourly Rate is unresolved; provide an explicit amount and ISO currency in the application later. No currency or zero rate was assumed.');
  if (normalized.legacyStatus && !normalized.projectLabel) warnings.push('Status has no project scope and will remain a legacy observation.');
  if (normalized.industryLabel) warnings.push('Industry requires an explicit mapping or taxonomy creation; otherwise the historical label is retained.');
  if (normalized.projectLabel) warnings.push('Project is treated as one whole label, including commas and pipes. Map it explicitly to create a membership.');
  return { rowNumber: source.rowNumber, raw, normalized, warnings, errors };
}

export function identityKeys(row) {
  const fields = row.normalized || row;
  return [fields.expertId && `id:${fields.expertId}`, ...(fields.emails || []).map(email => `email:${matchKey(email)}`), fields.linkedinProfile && `linkedin:${canonicalLinkedIn(fields.linkedinProfile)}`, fields.fullName && `name:${matchKey(fields.fullName)}`].filter(Boolean);
}

export function markDuplicates(rows) {
  const byKey = new Map();
  for (const row of rows) for (const key of identityKeys(row)) {
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(row.rowNumber);
  }
  for (const row of rows) {
    row.duplicateRows = [...new Set(identityKeys(row).flatMap(key => byKey.get(key) || []))].filter(number => number !== row.rowNumber).sort((a, b) => a - b);
    if (row.duplicateRows.length) row.warnings.push('Other source rows share an identity signal. Choose whether to create a separate expert or link to a reviewed row; no merge is automatic.');
  }
  return rows;
}
