import mongoose from 'mongoose';
import config from './config.js';
import { createApp } from './app.js';

mongoose.set('strictQuery', true);
let server;
let app;
let stopping = false;

async function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  const timer = setTimeout(() => process.exit(1), 10000).unref();
  try {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (app?.locals.sessionStore?.close) await app.locals.sessionStore.close();
    await mongoose.disconnect();
    clearTimeout(timer);
    process.exit(exitCode);
  } catch {
    process.exit(1);
  }
}

try {
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10000 });
  await Promise.all(mongoose.modelNames().map((name) => mongoose.model(name).init()));
  app = createApp();
  server = app.listen(config.port, config.host, () => console.log(`ExNett API listening on port ${config.port}.`));
  server.on('error', () => { console.error('The API could not bind its listening port.'); stop(1); });
  process.on('SIGTERM', () => stop());
  process.on('SIGINT', () => stop());
} catch {
  console.error('API startup failed. Check MongoDB availability and environment configuration.');
  await stop(1);
}
