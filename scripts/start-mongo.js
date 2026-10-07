import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const exec = promisify(execFile);
const docker = args => exec('docker', args, { maxBuffer: 4 * 1024 * 1024 });
const container = 'exnett-mongo';

async function waitFor(expression, message) {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      await docker(['exec', container, 'mongosh', '--quiet', '--eval', expression]);
      return;
    } catch { await delay(1000); }
  }
  throw new Error(message);
}

try {
  try { await docker(['info', '--format', '{{.ServerVersion}}']); }
  catch { throw new Error('Open Docker Desktop and wait until Docker is running, then retry npm run db:start. Alternatively configure an existing MongoDB replica set.'); }
  let existing = false;
  try { await docker(['container', 'inspect', container]); existing = true; }
  catch { /* The first run creates the application's development container. */ }
  if (existing) await docker(['start', container]);
  else {
    console.log('Preparing the local MongoDB image. The first run can take a few minutes.');
    await docker(['run', '-d', '--name', container, '--restart', 'unless-stopped',
      '-p', '127.0.0.1:27017:27017', '-v', 'exnett-mongo-data:/data/db',
      'mongo:8.0.32', '--replSet', 'rs0', '--bind_ip_all']);
  }
  await waitFor('db.adminCommand({ping:1})', 'MongoDB did not become available. Check Docker Desktop and retry.');
  await docker(['exec', container, 'mongosh', '--quiet', '--eval',
    'try { rs.status() } catch(e) { if(e.codeName === "NotYetInitialized") { rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27017"}]}) } else { throw e } }']);
  await waitFor('if (!db.hello().isWritablePrimary) { quit(1) }', 'MongoDB did not elect a writable primary.');
  console.log('Local MongoDB replica set ready on port 27017. Data remains in exnett-mongo-data.');
} catch (error) {
  console.error(error.message?.startsWith('Command failed:')
    ? 'Docker could not prepare MongoDB. Check Docker Desktop, internet access, and whether port 27017 is already in use.'
    : error.message);
  process.exitCode = 1;
}
