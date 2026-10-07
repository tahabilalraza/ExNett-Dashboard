import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = path.join(root, 'server/.env');
mkdirSync(path.join(root, '.runtime'), { recursive: true });
if (!existsSync(env)) {
  writeFileSync(env, `NODE_ENV=development\nPORT=4000\nMONGODB_URI=mongodb://127.0.0.1:27017/exnett_demo?replicaSet=rs0\nSESSION_SECRET=${randomBytes(48).toString('hex')}\nCLIENT_ORIGIN=http://localhost:5173\nTRUST_PROXY=0\nSEED_DEMO=true\n`, { mode: 0o600 });
  console.log('Created ignored local server/.env with a generated session secret.');
} else console.log('Existing server/.env preserved.');
