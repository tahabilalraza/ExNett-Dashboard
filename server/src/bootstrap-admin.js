import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import config from './config.js';
import { User } from './models.js';

const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD || '';
const name = String(process.env.ADMIN_NAME || 'Administrator').trim();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) {
  throw new Error('Set ADMIN_EMAIL and a unique ADMIN_PASSWORD of at least 12 characters and at most 72 UTF-8 bytes through secure environment configuration.');
}
await mongoose.connect(config.mongoUri);
try {
  if (await User.exists({ role: 'admin', active: true, archivedAt: null })) {
    throw new Error('An active administrator already exists. Manage users through the Team screen.');
  }
  if (await User.exists({ email })) throw new Error('The requested administrator email already belongs to a user.');
  await User.create({ name, email, passwordHash: await bcrypt.hash(password, 12), role: 'admin', active: true });
  console.log('Initial administrator created. Password was not logged. Remove bootstrap variables from runtime configuration.');
} finally { await mongoose.disconnect(); }
