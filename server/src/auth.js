import { Router } from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { User } from './models.js';
import { ApiError, asyncHandler, audit, requireAuth, validate } from './core.js';
import config from './config.js';

const router = Router();
const passwordWithinBcryptLimit = (value) => Buffer.byteLength(value, 'utf8') <= 72;
const loginPassword = z.string().min(1).max(72).refine(passwordWithinBcryptLimit, 'Password must be at most 72 UTF-8 bytes.');
export const newPasswordSchema = z.string().min(10, 'Use at least 10 characters.').max(72)
  .refine(passwordWithinBcryptLimit, 'Password must be at most 72 UTF-8 bytes.');
const emailSchema = z.string().trim().email().max(254).transform((value) => value.toLowerCase());
const loginSchema = z.object({ email: emailSchema, password: loginPassword }).strict();
const profileSchema = z.object({
  name: z.string().trim().min(1).max(150).optional(),
  email: emailSchema.optional(),
  currentPassword: loginPassword.optional(),
  password: newPasswordSchema.optional(),
}).strict().refine((value) => value.name !== undefined || value.email !== undefined || value.password !== undefined, {
  message: 'Provide a name, email, or new password.',
});
const dummyPasswordHash = bcrypt.hashSync(randomBytes(24).toString('hex'), 12);
const saveSession = (req) => new Promise((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
const regenerateSession = (req) => new Promise((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));

export function publicUser(user) {
  return { _id: user._id, name: user.name, email: user.email, role: user.role, active: user.active };
}

export function csrfProtection(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const expected = req.session?.csrfToken;
  const actual = req.get('X-CSRF-Token');
  if (typeof expected !== 'string' || typeof actual !== 'string'
      || !/^[a-f\d]{64}$/i.test(actual)
      || expected.length !== actual.length
      || !timingSafeEqual(Buffer.from(expected), Buffer.from(actual))) {
    return next(new ApiError(403, 'Your security token is missing or expired. Refresh the page and try again.'));
  }
  next();
}

router.get('/csrf', asyncHandler(async (req, res) => {
  if (!req.session.csrfToken) req.session.csrfToken = randomBytes(32).toString('hex');
  await saveSession(req);
  res.set('Cache-Control', 'no-store').json({ csrfToken: req.session.csrfToken });
}));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: { message: 'Too many sign-in attempts. Please try again later.' } }),
});

router.post('/login', loginLimiter, asyncHandler(async (req, res) => {
  const { email, password } = validate(loginSchema, req.body);
  const user = await User.findOne({ email, active: true, archivedAt: null }).select('+passwordHash');
  const passwordMatches = await bcrypt.compare(password, user?.passwordHash || dummyPasswordHash);
  if (!user || !passwordMatches) throw new ApiError(401, 'Email or password is incorrect.');
  await regenerateSession(req);
  req.session.userId = user._id.toString();
  req.session.sessionVersion = user.sessionVersion;
  req.session.csrfToken = randomBytes(32).toString('hex');
  await saveSession(req);
  req.user = user;
  await audit(req, 'login', 'User', user._id, 'Signed in.');
  res.set('Cache-Control', 'no-store').json({ user: publicUser(user), csrfToken: req.session.csrfToken });
}));

router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store').json({ user: publicUser(req.user) });
}));

router.post('/logout', asyncHandler(async (req, res) => {
  await new Promise((resolve, reject) => req.session.destroy((error) => error ? reject(error) : resolve()));
  res.clearCookie(config.sessionCookieName, { httpOnly: true, sameSite: 'lax', secure: config.production, path: '/' });
  res.json({ message: 'Signed out.' });
}));

router.patch('/profile', requireAuth, asyncHandler(async (req, res) => {
  const input = validate(profileSchema, req.body);
  const changesCredentials = input.password !== undefined || (input.email !== undefined && input.email !== req.user.email);
  const user = await User.findById(req.user._id).select('+passwordHash');
  if (!user || !user.active || user.archivedAt || user.sessionVersion !== req.session.sessionVersion) {
    throw new ApiError(401, 'Your session has expired. Please sign in again.');
  }
  if (changesCredentials) {
    if (!input.currentPassword || !await bcrypt.compare(input.currentPassword, user.passwordHash)) {
      throw new ApiError(400, 'Enter your current password to change your email or password.');
    }
  }
  if (input.name !== undefined) user.name = input.name;
  if (input.email !== undefined) user.email = input.email;
  if (input.password !== undefined) user.passwordHash = await bcrypt.hash(input.password, 12);
  if (changesCredentials) user.sessionVersion += 1;
  await user.save();
  if (changesCredentials) {
    req.session.sessionVersion = user.sessionVersion;
    await saveSession(req);
  }
  req.user = user;
  await audit(req, 'profile.update', 'User', user._id, 'Updated personal profile.');
  res.json({ user: publicUser(user) });
}));

export default router;
