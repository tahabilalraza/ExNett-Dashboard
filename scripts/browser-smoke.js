import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const baseUrl = process.env.EXNETT_BROWSER_URL || 'http://localhost:5173';
const artifactDirectory = process.env.EXNETT_BROWSER_ARTIFACTS || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.runtime/browser');
const suffix = Date.now().toString(36);
const expertName = `Browser Synthetic Expert ${suffix}`;
const projectName = `Browser Synthetic Project ${suffix}`;
const importedName = `Browser Imported Expert ${suffix}`;
const email = process.env.EXNETT_DEMO_EMAIL || 'admin@exnett.test';
const password = process.env.EXNETT_DEMO_PASSWORD || 'ExNettDemo!2026';
const runtimeErrors = [];
const serverErrors = [];
const created = { experts: [], projects: [], assignments: [], activities: [] };
let loggedIn = false;

await mkdir(artifactDirectory, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || process.env.CHROMIUM_EXECUTABLE || '/usr/bin/chromium',
  headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, baseURL: baseUrl });
const page = await context.newPage();
page.on('pageerror', error => runtimeErrors.push(error.message));
page.on('console', message => {
  if (message.type() === 'error' && !/Failed to load resource: the server responded with a status of (401|403)/.test(message.text())) {
    runtimeErrors.push(message.text());
  }
});
page.on('response', response => { if (response.url().includes('/api/') && response.status() >= 500) serverErrors.push(`${response.status()} ${new URL(response.url()).pathname}`); });
page.on('requestfailed', req => { if (!/ERR_ABORTED/.test(req.failure()?.errorText || '')) runtimeErrors.push(`${req.method()} ${new URL(req.url()).pathname}: ${req.failure()?.errorText}`); });

async function heading(name) { await expect(page.getByRole('heading', { name, exact: true })).toBeVisible({ timeout: 15_000 }); }
async function noAlert() { await expect(page.getByRole('alert')).toHaveCount(0); }
async function apiData(path) {
  const response = await context.request.get(`/api${path}`);
  assert.equal(response.status(), 200, `Read ${path}`);
  return response.json();
}
async function navigate(path, title) {
  await page.goto(path);
  await heading(title);
  await expect(page.locator('.loading-state')).toHaveCount(0, { timeout: 15_000 });
  await noAlert();
}
async function recordCreatedExpert(name) {
  const result = await apiData(`/experts?search=${encodeURIComponent(name)}`);
  const row = result.data.find(expert => expert.fullName === name);
  assert.ok(row, `UI write should persist expert ${name}`);
  created.experts.push(row._id);
  return row;
}
async function cleanupSynthetic() {
  const csrf = await context.request.get('/api/auth/csrf');
  assert.equal(csrf.status(), 200);
  const token = (await csrf.json()).csrfToken;
  for (const key of ['activities', 'assignments', 'experts', 'projects']) {
    for (const id of created[key]) {
      const response = await context.request.delete(`/api/${key}/${id}`, { headers: { 'X-CSRF-Token': token } });
      assert.equal(response.status(), 200, `Cleanup of this run's synthetic ${key} should succeed`);
    }
    created[key] = [];
  }
}

try {
  // Protected routes redirect through login. Keep browser credentials in memory only.
  await page.goto('/experts');
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Wrong!DemoPassword2026');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await heading('Expert network');
  loggedIn = true;
  const settings = await apiData('/settings');
  assert.equal(settings.data.demoMode, true, 'Browser mutation smoke tests require the clearly marked synthetic demo workspace');

  for (const [path, title] of [['/', 'Workspace overview'], ['/experts', 'Expert network'], ['/projects', 'Projects'],
    ['/clients', 'Clients'], ['/activities', 'Activity log'], ['/reports', 'Reports'], ['/team', 'Team'], ['/settings', 'Settings']]) {
    await navigate(path, title);
  }
  await navigate('/', 'Workspace overview');
  await page.screenshot({ path: `${artifactDirectory}/dashboard-desktop.png`, fullPage: true });

  await navigate('/experts', 'Expert network');
  await page.getByRole('button', { name: /^(Add|Create) expert$/i }).first().click();
  const expertDialog = page.getByRole('dialog');
  await expertDialog.getByLabel(/^Full name/).fill(expertName);
  await expertDialog.getByLabel('Country', { exact: true }).fill('Australia');
  await expertDialog.getByLabel('Primary email', { exact: true }).fill(`browser-${suffix}@example.test`);
  await expertDialog.getByRole('button', { name: 'Create expert', exact: true }).click();
  await expect(expertDialog).toHaveCount(0);
  await noAlert();
  const person = await recordCreatedExpert(expertName);
  await navigate('/experts', 'Expert network');
  await page.getByRole('textbox', { name: /Search experts/i }).fill(expertName);
  await expect(page.getByRole('link', { name: new RegExp(expertName) }).first()).toBeVisible();
  await page.getByRole('link', { name: new RegExp(expertName) }).first().click();
  await heading(expertName);
  await noAlert();

  await navigate('/projects', 'Projects');
  await page.getByRole('button', { name: 'Create project', exact: true }).first().click();
  const projectDialog = page.getByRole('dialog');
  await projectDialog.getByLabel('Project name', { exact: true }).fill(projectName);
  await projectDialog.getByLabel('Status', { exact: true }).selectOption({ label: 'Active' });
  await projectDialog.getByRole('button', { name: 'Save project', exact: true }).click();
  await expect(projectDialog).toHaveCount(0);
  await noAlert();
  const projects = await apiData(`/projects?search=${encodeURIComponent(projectName)}`);
  const work = projects.data.find(row => row.projectName === projectName);
  assert.ok(work);
  created.projects.push(work._id);
  await page.goto(`/projects/${work._id}`);
  await heading(projectName);
  await page.getByRole('button', { name: 'Add expert', exact: true }).first().click();
  const assignmentDialog = page.getByRole('dialog');
  await assignmentDialog.getByLabel('Expert', { exact: true }).selectOption(person._id);
  await assignmentDialog.getByRole('button', { name: 'Save assignment', exact: true }).click();
  await expect(assignmentDialog).toHaveCount(0);
  await noAlert();
  await expect(page.getByRole('link', { name: new RegExp(expertName) })).toBeVisible();
  const assignments = await apiData(`/assignments?expert=${person._id}&project=${work._id}`);
  assert.equal(assignments.data.length, 1);
  created.assignments.push(assignments.data[0]._id);

  await page.getByRole('button', { name: 'Log activity', exact: true }).first().click();
  const activityDialog = page.getByRole('dialog');
  await activityDialog.getByLabel('Activity type', { exact: true }).selectOption({ label: 'Note' });
  await activityDialog.getByLabel('Notes', { exact: true }).fill(`Synthetic browser activity ${suffix}`);
  await activityDialog.getByRole('button', { name: 'Save activity', exact: true }).click();
  await expect(activityDialog).toHaveCount(0);
  await noAlert();
  const activities = await apiData(`/activities?expert=${person._id}&project=${work._id}`);
  assert.equal(activities.data.length, 1);
  created.activities.push(activities.data[0]._id);

  await navigate('/import', 'Import experts');
  const syntheticCsv = Buffer.from(`Full Name,Country,Email,Tags\r\n${importedName},Canada,browser-import-${suffix}@example.test,QA\r\n`);
  await page.locator('input[type="file"]').setInputFiles({ name: 'synthetic-browser.csv', mimeType: 'text/csv', buffer: syntheticCsv });
  await page.getByRole('button', { name: 'Generate preview', exact: true }).click();
  await expect(page.getByText(importedName, { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await noAlert();
  // Import confirmation intentionally happens through the same reviewed UI used by operators.
  await page.getByRole('button', { name: 'Review and commit import', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm and commit', exact: true }).click();
  await expect.poll(async () => (await apiData(`/experts?search=${encodeURIComponent(importedName)}`)).pagination.total,
    { timeout: 15_000 }).toBe(1);
  await recordCreatedExpert(importedName);
  await noAlert();

  await navigate('/experts', 'Expert network');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${artifactDirectory}/experts-mobile.png`, fullPage: true });
  const width = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: innerWidth }));
  assert.ok(width.content <= width.viewport + 2, `Mobile document overflows by ${width.content - width.viewport}px; tables should scroll inside their container`);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await cleanupSynthetic();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  loggedIn = false;
  assert.equal((await context.request.get('/api/auth/me')).status(), 401);
  await page.goto('/experts');
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();

  assert.deepEqual(serverErrors, [], 'Browser workflow should not trigger server errors');
  assert.deepEqual(runtimeErrors, [], 'Browser workflow should not report console, script or network errors');
  console.log('Browser smoke passed: protected routing, invalid/valid login/logout, every module, expert create/search/detail, project create/assignment, activity, CSV import, and mobile layout.');
  console.log(`Synthetic screenshots: ${artifactDirectory}`);
} catch (error) {
  await page.screenshot({ path: `${artifactDirectory}/failure.png`, fullPage: true }).catch(() => {});
  console.error('Browser smoke failed:', error.message);
  if (runtimeErrors.length) console.error('Browser errors:', runtimeErrors);
  if (serverErrors.length) console.error('Server errors:', serverErrors);
  process.exitCode = 1;
} finally {
  // Only archive/remove entities created by this run; never wipe seed or user data.
  if (loggedIn) {
    try { await cleanupSynthetic(); }
    catch (error) { console.error('Synthetic cleanup failed; unique browser records remain identifiable:', error.message); process.exitCode = 1; }
  }
  await browser.close();
}
