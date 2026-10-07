import express from 'express';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import mongoose from 'mongoose';
import helmet from 'helmet';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import config from './config.js';
import authRouter, { csrfProtection } from './auth.js';
import { ApiError, errorHandler, requireAuth } from './core.js';
import expertsRouter from './routes/experts.js';
import operationsRouter from './routes/operations.js';
import analyticsRouter from './routes/analytics.js';
import settingsRouter from './routes/settings.js';
import importsRouter from './routes/imports.js';

export function createApp({ sessionStore } = {}) {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);
  app.use(helmet({
    contentSecurityPolicy: config.production ? {
      directives: { 'upgrade-insecure-requests': null },
    } : false,
    strictTransportSecurity: config.production ? undefined : false,
  }));
  app.use(cors({ origin: config.clientUrl, credentials: true }));
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: false, limit: '256kb' }));

  const store = sessionStore || MongoStore.create({
    mongoUrl: config.mongoUri,
    collectionName: 'sessions',
    ttl: config.sessionMaxAge / 1000,
    touchAfter: 60,
  });
  store.on?.('error', () => console.error('Session storage is unavailable.'));
  app.locals.sessionStore = store;
  app.use(session({
    name: config.sessionCookieName,
    secret: config.sessionSecret,
    store,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { httpOnly: true, sameSite: 'lax', secure: config.production, maxAge: config.sessionMaxAge, path: '/' },
  }));

  app.use('/api', rateLimit({
    windowMs: 60 * 1000,
    limit: 600,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ error: { message: 'Too many requests. Please try again shortly.' } }),
  }));
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use('/api', csrfProtection);
  app.get('/api/health', (_req, res) => {
    const connected = mongoose.connection.readyState === 1;
    res.status(connected ? 200 : 503).json({ status: connected ? 'ok' : 'unavailable', database: connected ? 'connected' : 'disconnected' });
  });
  app.use('/api/auth', authRouter);
  app.use('/api', requireAuth);
  app.use('/api/experts', expertsRouter);
  app.use('/api', operationsRouter);
  app.use('/api', analyticsRouter);
  app.use('/api', settingsRouter);
  app.use('/api/imports', importsRouter);
  app.use('/api', (_req, _res, next) => next(new ApiError(404, 'The requested API endpoint does not exist.')));

  if (config.production && existsSync(join(config.clientDist, 'index.html'))) {
    app.use(express.static(config.clientDist, { index: false }));
    app.get('*', (_req, res) => res.sendFile(join(config.clientDist, 'index.html')));
  }
  app.use((_req, _res, next) => next(new ApiError(404, 'The requested resource does not exist.')));
  app.use(errorHandler);
  return app;
}

export default createApp;
