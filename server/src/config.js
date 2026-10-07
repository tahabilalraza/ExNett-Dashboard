import dotenv from 'dotenv';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });
dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });

const production = process.env.NODE_ENV === 'production';
const sessionSecret = process.env.SESSION_SECRET || (!production ? randomBytes(48).toString('hex') : '');
if (production && sessionSecret.length < 32) {
  throw new Error('Production requires SESSION_SECRET with at least 32 characters.');
}
if (production && !process.env.MONGODB_URI) throw new Error('Production requires MONGODB_URI.');
const port = Number(process.env.PORT || 4000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid port number.');

export const config = Object.freeze({
  production,
  port,
  host: process.env.HOST || '0.0.0.0',
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/exnett',
  sessionSecret,
  sessionCookieName: 'exnett.sid',
  sessionMaxAge: 12 * 60 * 60 * 1000,
  clientUrl: process.env.CLIENT_ORIGIN || process.env.CLIENT_URL || 'http://localhost:5173',
  trustProxy: process.env.TRUST_PROXY === '1' ? 1 : false,
  clientDist: fileURLToPath(new URL('../../client/dist', import.meta.url)),
});
export default config;
