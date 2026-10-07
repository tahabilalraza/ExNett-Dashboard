import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = process.env.EXNETT_PRODUCTION_TEST_PORT || '4001';
const server = spawn(process.execPath, ['server/src/index.js'], {
  cwd: root,
  env: { ...process.env, NODE_ENV: 'production', PORT: port },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let processError;
server.on('error', error => { processError = error; });
// Consume output without exposing environment/driver details in a failed check.
server.stdout.resume();
server.stderr.resume();
const exit = once(server, 'exit');
const base = `http://127.0.0.1:${port}`;
try {
  let healthy = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (processError || server.exitCode !== null) break;
    try {
      const response = await fetch(`${base}/api/health`);
      healthy = response.ok && (await response.json()).database === 'connected';
      if (healthy) break;
    } catch { /* Startup is asynchronous; readiness retries are bounded. */ }
    await delay(150);
  }
  assert.ok(healthy && server.exitCode === null && !processError, 'Production API must start and connect to MongoDB');
  for (const route of ['/', '/experts/example', '/projects/example']) {
    const response = await fetch(`${base}${route}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.ok(response.headers.get('content-security-policy'));
    const html = await response.text();
    assert.match(html, /id="root"/);
    const scriptPath = html.match(/src="([^" ]+\.js)"/)?.[1];
    assert.ok(scriptPath, 'Built frontend script must be referenced');
    const asset = await fetch(`${base}${scriptPath}`);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('content-type'), /javascript/);
  }
  assert.equal((await fetch(`${base}/favicon.svg`)).status, 200);
  assert.equal((await fetch(`${base}/api/auth/me`)).status, 401);
  console.log('Production smoke passed: startup, MongoDB, built assets, SPA deep routes, CSP, and unauthenticated API protection.');
} finally {
  if (server.exitCode === null) server.kill('SIGTERM');
  await Promise.race([exit, delay(12_000, undefined, { ref: false }).then(() => server.kill('SIGKILL'))]);
}
