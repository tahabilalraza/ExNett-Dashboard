import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import ExcelJS from 'exceljs';

// Tests always create their own database. Neither the configured application database
// nor historical workbook is used, and cleanup is limited to this generated name.
const databaseName = `exnett_test_${Date.now()}_${randomUUID().slice(0, 8)}`;
const testUri = new URL(process.env.EXNETT_TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/?replicaSet=rs0&directConnection=true');
testUri.pathname = `/${databaseName}`;
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = testUri.toString();
process.env.SESSION_SECRET = 'integration-test-session-secret-unique-database-only';
process.env.CLIENT_URL = 'http://localhost:5173';

let app, models, admin, industry, sector;
const password = 'Integration!Password2026';
let adminSession;

test('initial administrator bootstrap creates a hashed account and refuses replacement or bcrypt truncation', async () => {
  const uri = new URL(process.env.MONGODB_URI);
  const bootstrapDatabase = `${databaseName}_bootstrap`;
  uri.pathname = `/${bootstrapDatabase}`;
  const script = fileURLToPath(new URL('../src/bootstrap-admin.js', import.meta.url));
  const bootstrapPassword = `Synthetic!${randomUUID()}`;
  const childEnv = { ...process.env, MONGODB_URI: uri.toString(), ADMIN_EMAIL: 'bootstrap@example.test', ADMIN_PASSWORD: bootstrapPassword };
  const run = promisify(execFile);
  const connection = await mongoose.createConnection(uri.toString()).asPromise();
  try {
    const result = await run(process.execPath, [script], { env: childEnv });
    assert.ok(!result.stdout.includes(bootstrapPassword), 'Bootstrap must not log the password');
    const account = await connection.db.collection('users').findOne({ email: 'bootstrap@example.test' });
    assert.equal(account.role, 'admin');
    assert.equal(account.active, true);
    assert.ok(await bcrypt.compare(bootstrapPassword, account.passwordHash));
    await assert.rejects(run(process.execPath, [script], { env: childEnv }), error => /active administrator already exists/.test(error.stderr));
    await assert.rejects(run(process.execPath, [script], { env: { ...childEnv, ADMIN_PASSWORD: '界'.repeat(25) } }), error => /72 UTF-8 bytes/.test(error.stderr));
    assert.equal(await connection.db.collection('users').countDocuments(), 1);
  } finally {
    assert.ok(bootstrapDatabase.startsWith('exnett_test_'));
    await connection.dropDatabase();
    await connection.close();
  }
});

async function signIn(email = 'admin@integration.test', enteredPassword = password) {
  const agent = request.agent(app);
  const csrf = await agent.get('/api/auth/csrf').expect(200);
  const result = await agent.post('/api/auth/login').set('X-CSRF-Token', csrf.body.csrfToken)
    .send({ email, password: enteredPassword });
  return { agent, token: result.body.csrfToken, result };
}

function mutate(session, method, path, body = {}) {
  return session.agent[method](`/api${path}`).set('X-CSRF-Token', session.token).send(body);
}

async function create(path, body, session = adminSession) {
  const response = await mutate(session, 'post', path, body).expect(201);
  assert.ok(response.body.data?._id, `${path} creation should return its persisted ID`);
  return response.body.data;
}

async function expert(name, extra = {}) {
  return create('/experts', { fullName: name, ...extra });
}

async function project(name, extra = {}) {
  return create('/projects', { projectName: name, ...extra });
}

function csv(headers, rows) {
  const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return Buffer.from([headers, ...rows].map(row => row.map(quote).join(',')).join('\r\n'));
}

async function preview(buffer, name = 'synthetic.csv', mapping) {
  let req = adminSession.agent.post('/api/imports/preview').set('X-CSRF-Token', adminSession.token);
  if (mapping) req = req.field('mapping', JSON.stringify(mapping));
  const result = await req.attach('file', buffer, name).expect(201);
  assert.ok(result.body.data?._id);
  return result.body.data;
}

before(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10_000 });
  models = await import('../src/models.js');
  await Promise.all(Object.values(models).filter(value => typeof value?.init === 'function').map(model => model.init()));
  const { createApp } = await import('../src/app.js');
  app = createApp();
  admin = await models.User.create({ name: 'Integration Admin', email: 'admin@integration.test',
    passwordHash: await bcrypt.hash(password, 10), role: 'admin' });
  await models.Settings.create({ key: 'organization', organizationName: 'Synthetic integration workspace' });
  industry = await models.Industry.create({ name: 'Synthetic Energy' });
  sector = await models.Sector.create({ name: 'Synthetic Grid', industry: industry._id });
  adminSession = await signIn();
  assert.equal(adminSession.result.status, 200);
});

after(async () => {
  if (app?.locals.sessionStore) await app.locals.sessionStore.close();
  if (mongoose.connection.readyState) {
    assert.equal(mongoose.connection.name, databaseName, 'Cleanup must target only this generated test database');
    assert.match(databaseName, /^exnett_test_/);
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

test('authentication rejects unauthorized access and bad passwords, requires CSRF, and logs out', async () => {
  await request(app).get('/api/experts').expect(401);
  await request(app).post('/api/auth/login').send({ email: 'admin@integration.test', password }).expect(403);
  const invalid = await signIn('admin@integration.test', 'Wrong!Password2026');
  assert.equal(invalid.result.status, 401);
  assert.equal(invalid.result.body.user, undefined);
  const session = await signIn();
  assert.equal(session.result.status, 200);
  assert.equal(session.result.body.user.email, 'admin@integration.test');
  assert.equal(session.result.body.user.passwordHash, undefined);
  const cookies = session.result.headers['set-cookie']?.join(';') || '';
  assert.match(cookies, /HttpOnly/i);
  assert.match(cookies, /SameSite=Lax/i);
  await session.agent.get('/api/auth/me').expect(200);
  await session.agent.post('/api/experts').send({ fullName: 'Rejected without CSRF' }).expect(403);
  await mutate(session, 'post', '/auth/logout').expect(200);
  await session.agent.get('/api/auth/me').expect(401);
  await session.agent.get('/api/experts').expect(401);
});

test('expert CRUD validates incomplete records, normalized email, rates, references, and unique IDs', async () => {
  await mutate(adminSession, 'post', '/experts', { fullName: '' }).expect(400);
  await mutate(adminSession, 'post', '/experts', { fullName: 'Invalid Email', email: 'bad-address' }).expect(400);
  await mutate(adminSession, 'post', '/experts', { fullName: 'Invalid Rate', hourlyRate: -2 }).expect(400);
  await mutate(adminSession, 'post', '/experts', { fullName: 'Invalid Reference', industry: 'bad-id' }).expect(400);
  const missingReference = await mutate(adminSession, 'post', '/experts', {
    fullName: 'Missing Reference', industry: new mongoose.Types.ObjectId().toString(),
  });
  assert.ok([400, 404].includes(missingReference.status));
  const minimal = await expert('Minimal Synthetic Expert');
  assert.match(minimal.expertId, /^EXP-/);
  assert.equal(minimal.phoneNumber, '');
  const complete = await expert('Complete Synthetic Expert', { expertId: 'QA-UNIQUE-ID', email: 'UPPER@EXAMPLE.TEST',
    country: 'Australia', industry: industry._id.toString(), sector: sector._id.toString(), hourlyRate: 250, currency: 'aud',
    phoneNumber: '+61 400 000 000', linkedinProfile: 'https://www.linkedin.com/in/synthetic-complete' });
  assert.equal(complete.email, 'upper@example.test');
  assert.equal(complete.currency, 'AUD');
  await mutate(adminSession, 'post', '/experts', { fullName: 'Duplicate ID', expertId: 'QA-UNIQUE-ID' }).expect(409);
  const sameEmail = await expert('Email is a review clue', { email: 'upper@example.test' });
  assert.notEqual(sameEmail._id, complete._id, 'Email must not be a unique identity constraint');
  const updated = await mutate(adminSession, 'put', `/experts/${complete._id}`, {
    fullName: 'Complete Synthetic Expert Edited', remarks: 'Persisted integration update', hourlyRate: 275,
  }).expect(200);
  assert.equal(updated.body.data.hourlyRate, 275);
  const detail = await adminSession.agent.get(`/api/experts/${complete._id}`).expect(200);
  assert.equal(detail.body.data.remarks, 'Persisted integration update');
  assert.equal(detail.body.data.industry.name, industry.name);
  assert.ok(Array.isArray(detail.body.assignments));
  assert.ok(Array.isArray(detail.body.activities));
  assert.equal(await models.Expert.countDocuments({ fullName: 'Rejected without CSRF' }), 0);
});

test('expert searches, combined filters, sorting, pagination, and injection-shaped queries work on the server', async () => {
  const rowA = await expert('QueryFixture Alpha', { country: 'Australia', status: 'Active', currentCompany: 'QueryCo',
    currentPosition: 'Research Director', email: 'query-alpha@example.test', phoneNumber: '+61 400 111 111',
    linkedinProfile: 'https://www.linkedin.com/in/query-fixture-alpha', hourlyRate: 120,
    industry: industry._id.toString(), sector: sector._id.toString(), recruitedBy: admin._id.toString() });
  await expert('QueryFixture Beta', { country: 'Canada', status: 'Active', currentCompany: 'QueryCo', hourlyRate: 300 });
  await expert('QueryFixture Gamma', { country: 'Australia', status: 'Inactive', hourlyRate: 80 });
  for (const search of ['query-alpha@example.test', 'query-fixture-alpha', rowA.expertId, 'Research Director']) {
    const found = await adminSession.agent.get('/api/experts').query({ search }).expect(200);
    assert.ok(found.body.data.some(row => row._id === rowA._id), `Search should match ${search}`);
  }
  const filtered = await adminSession.agent.get('/api/experts').query({ search: 'QueryFixture', country: 'Australia',
    status: 'Active', industry: industry._id.toString(), sector: sector._id.toString(), recruitedBy: admin._id.toString(),
    minRate: 100, maxRate: 200, hasEmail: 'true', hasPhone: 'true', hasLinkedIn: 'true' }).expect(200);
  assert.deepEqual(filtered.body.data.map(row => row._id), [rowA._id]);
  const pages = await adminSession.agent.get('/api/experts').query({ search: 'QueryFixture', sort: 'fullName', order: 'asc', page: 2, limit: 1 }).expect(200);
  assert.equal(pages.body.pagination.total, 3);
  assert.equal(pages.body.pagination.pages, 3);
  assert.equal(pages.body.data[0].fullName, 'QueryFixture Beta');
  const noEmail = await adminSession.agent.get('/api/experts').query({ search: 'QueryFixture', hasEmail: 'false' }).expect(200);
  assert.equal(noEmail.body.pagination.total, 2);
  await adminSession.agent.get('/api/experts').query({ 'country[$ne]': '' }).expect(400);
  await adminSession.agent.get('/api/experts').query({ hasPhone: 'sometimes' }).expect(400);
  const literal = await adminSession.agent.get('/api/experts').query({ search: '.*' }).expect(200);
  assert.equal(literal.body.pagination.total, 0, 'Search input must be escaped rather than interpreted as regex');
});

test('clients and projects persist edits and references, enforce timelines and custom statuses', async () => {
  const client = await create('/clients', { clientName: 'Integration Research Client', primaryContactEmail: 'CONTACT@EXAMPLE.TEST' });
  assert.equal(client.primaryContactEmail, 'contact@example.test');
  await mutate(adminSession, 'put', `/clients/${client._id}`, { notes: 'Synthetic client note' }).expect(200);
  const work = await project('Integration Timeline Study', { client: client._id, industry: industry._id.toString(),
    sector: sector._id.toString(), owner: admin._id.toString(), status: 'Active', startDate: '2026-01-01', deadline: '2026-02-01' });
  assert.equal(work.client._id, client._id);
  await mutate(adminSession, 'put', `/projects/${work._id}`, { status: 'Completed', completedDate: '2026-01-20' }).expect(200);
  const detail = await adminSession.agent.get(`/api/clients/${client._id}`).expect(200);
  assert.equal(detail.body.data.notes, 'Synthetic client note');
  assert.ok(detail.body.projects.some(row => row._id === work._id));
  await mutate(adminSession, 'post', '/projects', { projectName: 'Bad dates', startDate: '2026-02-10', deadline: '2026-01-01' }).expect(400);
  await mutate(adminSession, 'post', '/projects', { projectName: 'Invalid date', startDate: 'impossible date' }).expect(400);
  await mutate(adminSession, 'post', '/projects', { projectName: 'Invalid status', status: 'Arbitrary Status' }).expect(400);
  const otherIndustry = await models.Industry.create({ name: 'Unrelated Industry' });
  await mutate(adminSession, 'post', '/projects', { projectName: 'Bad taxonomy',
    industry: otherIndustry._id.toString(), sector: sector._id.toString() }).expect(400);
});

test('one expert has multiple assignments; duplicate pairs reject, removed assignments revive without losing history', async () => {
  const person = await expert('Multi Project Synthetic Expert');
  const workA = await project('Multi Project Study A', { status: 'Active' });
  const workB = await project('Multi Project Study B', { status: 'Active' });
  const assignmentA = await create('/assignments', { expert: person._id, project: workA._id, expertRate: 150, currency: 'USD' });
  const assignmentB = await create('/assignments', { expert: person._id, project: workB._id });
  await mutate(adminSession, 'post', '/assignments', { expert: person._id, project: workA._id }).expect(409);
  await mutate(adminSession, 'put', `/assignments/${assignmentA._id}`, { assignmentStatus: 'Contacted', notes: 'History survives removal' }).expect(200);
  const detail = await adminSession.agent.get(`/api/experts/${person._id}`).expect(200);
  assert.equal(detail.body.assignments.length, 2);
  assert.equal(await models.Expert.countDocuments({ _id: person._id }), 1);
  const filter = await adminSession.agent.get('/api/experts').query({ project: workA._id }).expect(200);
  assert.ok(filter.body.data.some(row => row._id === person._id));
  await mutate(adminSession, 'delete', `/assignments/${assignmentA._id}`).expect(200);
  assert.ok((await models.Assignment.findById(assignmentA._id)).removedAt);
  const active = await adminSession.agent.get('/api/assignments').query({ expert: person._id }).expect(200);
  assert.deepEqual(active.body.data.map(row => row._id), [assignmentB._id]);
  const revived = await mutate(adminSession, 'post', '/assignments', { expert: person._id, project: workA._id }).expect(200);
  assert.equal(revived.body.data._id, assignmentA._id);
  assert.equal(revived.body.data.removedAt, null);
  assert.equal(revived.body.data.notes, 'History survives removal');
  assert.equal(await models.Assignment.countDocuments({ expert: person._id }), 2);
});

test('activities validate relationships, filters, and calculate commercial data only with sufficient inputs', async () => {
  const person = await expert('Commercial Synthetic Expert');
  const different = await expert('Different Synthetic Expert');
  const work = await project('Commercial Synthetic Project');
  const assignment = await create('/assignments', { expert: person._id, project: work._id });
  await mutate(adminSession, 'post', '/activities', { expert: different._id, assignment: assignment._id,
    activityType: 'Consultation', activityDate: '2026-03-12' }).expect(400);
  await mutate(adminSession, 'post', '/activities', { expert: person._id, activityType: 'Consultation', billingAmount: 10 }).expect(400);
  const consultation = await create('/activities', { expert: person._id, project: work._id, assignment: assignment._id,
    activityType: 'Consultation', activityDate: '2026-03-12T09:00:00Z', durationMinutes: 90,
    clientRate: 400, expertRate: 200, currency: 'AUD', outcome: 'Completed', notes: 'Synthetic paid consultation' });
  assert.equal(consultation.revenue, 600);
  assert.equal(consultation.expertCost, 300);
  assert.equal(consultation.margin, 300);
  const unknown = await create('/activities', { expert: person._id, activityType: 'Note', notes: 'Commercial values unknown' });
  assert.equal(unknown.revenue ?? null, null);
  assert.equal(unknown.expertCost ?? null, null);
  assert.equal(unknown.margin ?? null, null);
  const activities = await adminSession.agent.get('/api/activities').query({ expert: person._id, project: work._id,
    activityType: 'Consultation', performedBy: admin._id.toString(), outcome: 'Completed', from: '2026-03-01', to: '2026-03-31' }).expect(200);
  assert.equal(activities.body.pagination.total, 1);
  assert.equal(activities.body.data[0]._id, consultation._id);
  const detail = await adminSession.agent.get(`/api/projects/${work._id}`).expect(200);
  assert.ok(detail.body.activities.some(row => row._id === consultation._id));
  const expertDetail = await adminSession.agent.get(`/api/experts/${person._id}`).expect(200);
  assert.equal(expertDetail.body.activities.length, 2);
  const manual = await create('/activities', { expert: person._id, activityType: 'Consultation',
    durationMinutes: 60, clientRate: 400, expertRate: 100, expertCost: 175, currency: 'CAD' });
  assert.equal(manual.expertCost, 175);
  const edited = await mutate(adminSession, 'put', `/activities/${manual._id}`, { notes: 'Noncommercial edit preserves direct recorded cost' }).expect(200);
  assert.equal(edited.body.data.expertCost, 175);
  assert.equal(edited.body.data.margin, 225);
});

test('reports and dashboard counts reconcile with live records and separate currencies', async () => {
  const person = await expert('Report Currency Expert', { hourlyRate: 100, currency: 'NZD' });
  await create('/activities', { expert: person._id, activityType: 'Consultation', billingAmount: 250,
    expertCost: 90, currency: 'NZD', activityDate: new Date().toISOString() });
  const costOnly = await create('/activities', { expert: person._id, activityType: 'Note',
    expertCost: 55, currency: 'ZAR', activityDate: new Date().toISOString() });
  assert.equal(costOnly.revenue ?? null, null);
  assert.equal(costOnly.margin ?? null, null);
  const dashboard = await adminSession.agent.get('/api/dashboard').expect(200);
  assert.equal(dashboard.body.data.kpis.totalExperts, await models.Expert.countDocuments({ archivedAt: null }));
  assert.equal(dashboard.body.data.kpis.activeProjects,
    await models.Project.countDocuments({ archivedAt: null, status: 'Active' }));
  const reports = await adminSession.agent.get('/api/reports').expect(200);
  for (const data of [dashboard.body.data, reports.body.data]) {
    const nzd = data.revenueByCurrency.find(row => row.currency === 'NZD');
    const aud = data.revenueByCurrency.find(row => row.currency === 'AUD');
    assert.equal(nzd.revenue, 250);
    assert.equal(nzd.expertCost, 90);
    assert.equal(nzd.margin, 160);
    assert.equal(aud.revenue, 600);
    const zar = data.revenueByCurrency.find(row => row.currency === 'ZAR');
    assert.equal(zar.expertCost, 55);
    assert.equal(zar.revenue, null, 'A currency containing only known costs must not imply zero revenue');
    assert.equal(zar.margin, null, 'Unknown margin must remain unknown in commercial reports');
    assert.equal(data.expertsByCountry.reduce((sum, row) => sum + row.count, 0), data.kpis.totalExperts);
  }
});

test('backend enforces member/manager/admin permissions and invalidates deactivated users', async () => {
  const member = await create('/team', { name: 'Synthetic Member', email: 'member@integration.test', role: 'member', password });
  const manager = await create('/team', { name: 'Synthetic Manager', email: 'manager@integration.test', role: 'manager', password });
  const memberSession = await signIn(member.email);
  const managerSession = await signIn(manager.email);
  assert.equal(memberSession.result.status, 200);
  assert.equal(managerSession.result.status, 200);
  await memberSession.agent.get('/api/team').expect(403);
  await managerSession.agent.get('/api/team').expect(403);
  await mutate(memberSession, 'put', '/settings', { organizationName: 'Forbidden' }).expect(403);
  await mutate(memberSession, 'post', '/imports/preview').expect(403);
  const person = await expert('Permission Synthetic Expert');
  await mutate(memberSession, 'delete', `/experts/${person._id}`).expect(403);
  await create('/experts', { fullName: 'Member-created Synthetic Expert' }, memberSession);
  await mutate(managerSession, 'delete', `/experts/${person._id}`).expect(200);
  const team = await adminSession.agent.get('/api/team').expect(200);
  assert.ok(team.body.data.every(user => user.passwordHash === undefined));
  await mutate(adminSession, 'put', `/team/${admin._id}`, { active: false }).expect(409);
  await mutate(adminSession, 'put', `/team/${member._id}`, { active: false }).expect(200);
  await memberSession.agent.get('/api/experts').expect(401);
  assert.equal((await signIn(member.email)).result.status, 401);
  await mutate(adminSession, 'put', `/team/${manager._id}`, { password: 'Reset!Password2026' }).expect(200);
  await managerSession.agent.get('/api/experts').expect(401);
  assert.equal((await signIn(manager.email, 'Reset!Password2026')).result.status, 200);
});

test('soft archiving preserves historical records and excludes archived experts from normal results', async () => {
  const person = await expert('Archive Synthetic Expert');
  const work = await project('Archive Synthetic Project');
  const assignment = await create('/assignments', { expert: person._id, project: work._id });
  const activity = await create('/activities', { expert: person._id, project: work._id, assignment: assignment._id, activityType: 'Note' });
  await mutate(adminSession, 'delete', `/experts/${person._id}`).expect(200);
  const normal = await adminSession.agent.get('/api/experts').query({ search: 'Archive Synthetic Expert' }).expect(200);
  assert.equal(normal.body.pagination.total, 0);
  const archived = await adminSession.agent.get('/api/experts').query({ search: 'Archive Synthetic Expert', includeArchived: 'true' }).expect(200);
  assert.equal(archived.body.pagination.total, 1);
  assert.ok(await models.Assignment.findById(assignment._id));
  assert.ok(await models.Activity.findById(activity._id));
  await mutate(adminSession, 'put', `/experts/${person._id}`, { fullName: 'Forbidden archive mutation' }).expect(409);
  const dashboard = await adminSession.agent.get('/api/dashboard').expect(200);
  assert.equal(dashboard.body.data.kpis.totalExperts, await models.Expert.countDocuments({ archivedAt: null }));
});

test('expert CSV export uses current database records and neutralizes spreadsheet formulas', async () => {
  await expert('=Synthetic Formula Name', { phoneNumber: '+61 400 999 999', remarks: '@SUM(1,2)' });
  const exported = await adminSession.agent.get('/api/experts/export.csv').query({ search: '=Synthetic Formula Name' }).expect(200);
  assert.match(exported.headers['content-type'], /text\/csv/);
  assert.match(exported.text, /Full Name/i);
  assert.match(exported.text, /'=Synthetic Formula Name/);
  assert.match(exported.text, /'\+61 400 999 999/);
  assert.match(exported.text, /'@SUM\(1,2\)/);
});

test('CSV import previews missing optional fields, duplicates, invalid rates and requires explicit conflict decisions', async () => {
  await expert('Existing Import Candidate', { expertId: 'IMPORT-EXISTING', email: 'candidate@example.test', remarks: 'Important existing note' });
  const headers = ['Expert Id', 'Full Name', 'Country', 'Email', 'Project', 'Hourly Rate', 'Remarks', 'Tags'];
  const batch = await preview(csv(headers, [
    ['', 'New Minimal Imported Expert', 'Australia', '', 'Synthetic Legacy Study', '', '', 'Grid; Energy'],
    ['IMPORT-EXISTING', 'Conflicting Existing Name', '', 'candidate@example.test', '', '175', '', ''],
    ['', 'Email Collision Candidate', 'Canada', 'candidate@example.test', '', '', '', ''],
    ['IMPORT-RATE', 'Invalid Import Rate', '', '', '', 'not a rate', '', ''],
    ['IMPORT-DUP', 'Same ID First', '', '', '', '', '', ''],
    ['IMPORT-DUP', 'Same ID Second', '', '', '', '', '', ''],
    ['IMPORT-INVALID', '', '', '', '', '', '', ''],
  ]));
  assert.deepEqual(batch.headers, headers);
  assert.equal(batch.rows.length, 7);
  assert.ok(batch.rows.find(row => row.rowNumber === 3).candidates.length > 0);
  assert.ok(batch.rows.find(row => row.rowNumber === 4).candidates.length > 0);
  assert.equal(batch.rows.find(row => row.rowNumber === 5).normalized.rate, null);
  assert.ok(batch.rows.find(row => row.rowNumber === 5).warnings.some(warning => /rate.*unresolved/i.test(warning)),
    'Invalid legacy rates must remain unresolved rather than becoming zero or an invented currency');
  assert.ok(batch.rows.find(row => row.rowNumber === 8).errors.length > 0);
  assert.ok(batch.rows.find(row => row.rowNumber === 6).duplicateRows.includes(7));
  assert.notEqual(batch.rows.find(row => row.rowNumber === 3).action, 'create');
  assert.equal(await models.Expert.countDocuments({ fullName: 'New Minimal Imported Expert' }), 0, 'Preview must never import data');
  const invalid = await mutate(adminSession, 'post', `/imports/${batch._id}/commit`, {
    confirmed: true, previewToken: batch.previewToken,
    decisions: batch.rows.map(row => ({ rowNumber: row.rowNumber, action: row.rowNumber === 8 ? 'create' : 'skip' })),
  });
  assert.ok([400, 409, 422].includes(invalid.status), 'Rows without the required name must block create decisions');
});

test('XLSX import reads rows beyond table bounds and handles numeric phones, hyperlinks, currency and Tags', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Synthetic Legacy Experts');
  const headers = ['Full Name', 'Country', 'Email', 'Phone Number', 'LinkedIn Profile', 'Project', 'Hourly Rate', 'Tags'];
  sheet.addTable({ name: 'PartialLegacyTable', ref: 'A1', headerRow: true,
    columns: headers.map(name => ({ name })), rows: [['XLSX In Table Expert', 'Australia', '', 61400123456,
      { text: 'Profile', hyperlink: 'https://www.linkedin.com/in/synthetic-xlsx' }, '', 'AUD 125', 'Energy,Grid']] });
  sheet.addRow(['XLSX Beyond Table Expert', 'Canada', 'beyond@example.test', '+1 555 010 0200', '', '', '', '']);
  const batch = await preview(Buffer.from(await workbook.xlsx.writeBuffer()), 'synthetic.xlsx');
  assert.equal(batch.rows.length, 2, 'All populated worksheet rows must be read, regardless of table range');
  assert.ok(batch.rows[0].warnings.length > 0, 'Numeric phones need a loss-of-format warning');
  assert.equal(batch.rows[0].normalized.linkedinProfile, 'https://www.linkedin.com/in/synthetic-xlsx');
  assert.equal(batch.rows[0].normalized.rate.amount, 125);
  assert.equal(batch.rows[0].normalized.rate.currency, 'AUD');
});

test('explicit import decisions preserve blank fields, map projects, link duplicate rows and reimport idempotently', async () => {
  const existing = await expert('Preserved Existing Import Expert', { expertId: 'IMPORT-PRESERVE',
    email: 'preserve@example.test', phoneNumber: '+1 555 010 0300', remarks: 'Important existing remarks' });
  const workA = await project('Mapped Import Project A');
  const workB = await project('Mapped Import Project B');
  const headers = ['Expert Id', 'Full Name', 'Email', 'Phone Number', 'Project', 'Status', 'Hourly Rate', 'Remarks'];
  const batch = await preview(csv(headers, [
    ['IMPORT-PRESERVE', 'Explicitly Updated Import Expert', 'preserve@example.test', '', 'Legacy Project A', 'Contacted', 'USD 175', ''],
    ['', 'New Linked Import Expert', 'new-linked@example.test', '', 'Legacy Project A', '', '', ''],
    ['', 'New Linked Import Expert', 'new-linked@example.test', '', 'Legacy Project B', '', '', ''],
  ]));
  const body = { confirmed: true, previewToken: batch.previewToken, decisions: [
    { rowNumber: 2, action: 'update', expertId: existing._id, fields: ['fullName', 'phoneNumber', 'remarks'], assignmentFields: ['status', 'rate'] },
    { rowNumber: 3, action: 'create' },
    { rowNumber: 4, action: 'link', linkRowNumber: 3 },
  ], projectMapping: { 'Legacy Project A': workA._id, 'Legacy Project B': workB._id },
  statusMapping: { Contacted: 'Contacted' } };
  const committed = await mutate(adminSession, 'post', `/imports/${batch._id}/commit`, body);
  assert.ok([200, 201].includes(committed.status), JSON.stringify(committed.body));
  assert.equal(committed.body.data.status, 'committed');
  const kept = await models.Expert.findById(existing._id);
  assert.equal(kept.fullName, 'Explicitly Updated Import Expert');
  assert.equal(kept.phoneNumber, '+1 555 010 0300');
  assert.equal(kept.remarks, 'Important existing remarks');
  const imported = await models.Expert.find({ email: 'new-linked@example.test' });
  assert.equal(imported.length, 1, 'Rows describing one expert across projects must explicitly link to one master');
  assert.match(imported[0].expertId, /^EXP-/);
  assert.equal(imported[0].legacyObservations.length, 2);
  assert.equal(await models.Assignment.countDocuments({ expert: imported[0]._id, removedAt: null }), 2);
  const mapped = await models.Assignment.findOne({ expert: existing._id, project: workA._id });
  assert.equal(mapped.assignmentStatus, 'Contacted');
  assert.equal(mapped.expertRate, 175);
  assert.equal(mapped.currency, 'USD');
  assert.equal(kept.hourlyRate, undefined, 'Legacy project quotes do not become master expert rates');
  const countsBeforeRepeat = [await models.Expert.countDocuments(), await models.Assignment.countDocuments(), await models.Activity.countDocuments()];
  const repeated = await mutate(adminSession, 'post', `/imports/${batch._id}/commit`, body).expect(200);
  assert.equal(repeated.body.data.status, 'committed');
  assert.deepEqual([await models.Expert.countDocuments(), await models.Assignment.countDocuments(), await models.Activity.countDocuments()], countsBeforeRepeat);
  assert.equal((await models.Expert.findById(imported[0]._id)).legacyObservations.length, 2);
  await mutate(adminSession, 'delete', `/imports/${batch._id}`).expect(200);
  const reuploaded = await preview(csv(headers, [
    ['IMPORT-PRESERVE', 'Explicitly Updated Import Expert', 'preserve@example.test', '', 'Legacy Project A', 'Contacted', 'USD 175', ''],
    ['', 'New Linked Import Expert', 'new-linked@example.test', '', 'Legacy Project A', '', '', ''],
    ['', 'New Linked Import Expert', 'new-linked@example.test', '', 'Legacy Project B', '', '', ''],
  ]));
  assert.equal(reuploaded.rows[1].previousExpertId, imported[0]._id.toString());
  assert.notEqual(reuploaded.rows[1].action, 'create', 'Committed sources stay recognized after private staging is deleted');
  const relinked = await mutate(adminSession, 'post', `/imports/${reuploaded._id}/commit`, {
    confirmed: true, previewToken: reuploaded.previewToken,
    decisions: reuploaded.rows.map(row => ({ rowNumber: row.rowNumber, action: 'link', expertId: row.previousExpertId })),
    projectMapping: body.projectMapping,
  }).expect(200);
  assert.equal(relinked.body.data.status, 'committed');
  assert.deepEqual([await models.Expert.countDocuments(), await models.Assignment.countDocuments(), await models.Activity.countDocuments()], countsBeforeRepeat);
  assert.equal((await models.Expert.findById(imported[0]._id)).legacyObservations.length, 2);
});

test('supplied legacy Expert IDs remain unique and match revised files without contact details', async () => {
  const headers = ['Expert ID', 'Full Name'];
  const identifier = 'QA-LEGACY-IDENTITY';
  const original = await preview(csv(headers, [[identifier, 'Synthetic Legacy Identity']]));
  await mutate(adminSession, 'post', `/imports/${original._id}/commit`, {
    confirmed: true, previewToken: original.previewToken,
    decisions: [{ rowNumber: 2, action: 'create' }],
  }).expect(200);
  const person = await models.Expert.findOne({ expertId: identifier });
  assert.ok(person, 'An explicitly supplied Expert ID must be preserved');
  const revision = await preview(csv(headers, [[identifier, 'Revised Synthetic Name']]));
  assert.equal(revision.rows[0].action, 'review');
  assert.ok(revision.rows[0].candidates.some(candidate => candidate._id === person._id.toString()));
  await mutate(adminSession, 'post', `/imports/${revision._id}/commit`, {
    confirmed: true, previewToken: revision.previewToken,
    decisions: [{ rowNumber: 2, action: 'create' }],
  }).expect(409);
  await mutate(adminSession, 'post', `/imports/${revision._id}/commit`, {
    confirmed: true, previewToken: revision.previewToken,
    decisions: [{ rowNumber: 2, action: 'link', expertId: person._id.toString() }],
  }).expect(200);
  assert.equal(await models.Expert.countDocuments({ expertId: identifier }), 1);
  assert.equal((await models.Expert.findById(person._id)).fullName, 'Synthetic Legacy Identity', 'Linking must not overwrite the profile');
});

test('custom column mapping works, malformed headers are rejected, and stale previews cannot overwrite concurrent edits', async () => {
  const mapped = await preview(csv(['Person', 'Contact', 'Private extra'], [['Mapped Synthetic Person', 'mapping@example.test', 'Ignored synthetic note']]),
    'custom.csv', { Person: 'fullName', Contact: 'email', 'Private extra': 'ignore' });
  assert.equal(mapped.rows[0].normalized.fullName, 'Mapped Synthetic Person');
  assert.equal(mapped.rows[0].normalized.email, 'mapping@example.test');
  const malformed = await adminSession.agent.post('/api/imports/preview').set('X-CSRF-Token', adminSession.token)
    .attach('file', csv(['Full Name', 'Full Name'], [['Ambiguous', 'Headers']]), 'malformed.csv');
  assert.ok([400, 422].includes(malformed.status));
  const existing = await expert('Concurrent Import Candidate', { email: 'concurrent@example.test', remarks: 'Original remarks' });
  const batch = await preview(csv(['Full Name', 'Email', 'Remarks'], [['Changed by import', existing.email, 'Import replacement']]));
  await mutate(adminSession, 'put', `/experts/${existing._id}`, { remarks: 'Concurrent editor note' }).expect(200);
  await mutate(adminSession, 'post', `/imports/${batch._id}/commit`, { confirmed: true, previewToken: batch.previewToken,
    decisions: [{ rowNumber: 2, action: 'update', expertId: existing._id, fields: ['remarks'] }] }).expect(409);
  assert.equal((await models.Expert.findById(existing._id)).remarks, 'Concurrent editor note');
});
