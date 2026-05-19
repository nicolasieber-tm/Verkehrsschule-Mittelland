import 'dotenv/config';
import Fastify from 'fastify';

// Last-resort: never let an unhandled rejection / uncaught exception take the process down.
// Fire-and-forget background tasks (e.g. mail send) should not bring down the API.
process.on('unhandledRejection', (reason) => {
  try { console.error('[unhandledRejection]', reason instanceof Error ? reason.stack : reason); } catch {}
});
process.on('uncaughtException', (err) => {
  try { console.error('[uncaughtException]', err?.stack || err); } catch {}
});

import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import session from '@fastify/session';
import csrfProtection from '@fastify/csrf-protection';
import formbody from '@fastify/formbody';
import multipart from '@fastify/multipart';
import view from '@fastify/view';
import fastifyStatic from '@fastify/static';
import ejs from 'ejs';
import connectPgSimple from 'connect-pg-simple';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPool, runMigrations } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PgSession = connectPgSimple({ Store: session.Store });

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      transport: process.env.NODE_ENV === 'production'
        ? undefined
        : { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', singleLine: true } },
      // PII-arm: redact common fields
      redact: ['req.headers.authorization', 'req.headers.cookie', 'req.body.password', 'req.body.email', 'req.body.vname', 'req.body.nname', 'req.body.strasse', 'req.body.geburt', 'req.body.telefon'],
    },
    trustProxy: process.env.TRUST_PROXY === 'true',
    bodyLimit: 16 * 1024, // 16kb
  });

  const pool = createPool();
  app.decorate('pg', pool);

  await runMigrations(pool, app.log);

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:'],
        'connect-src': ["'self'"],
        'frame-ancestors': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });

  await app.register(rateLimit, {
    global: false, // wir setzen per-route limits
  });

  await app.register(formbody);
  await app.register(multipart, {
    limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 50, parts: 60 },
    throwFileSizeLimit: true,
  });
  await app.register(cookie);
  await app.register(session, {
    secret: process.env.SESSION_SECRET,
    cookieName: 'vsm_session',
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 8 * 60 * 60 * 1000, // 8h idle
    },
    store: new PgSession({
      pool,
      tableName: 'session',
      createTableIfMissing: false, // migration handles it
    }),
    saveUninitialized: false,
  });

  await app.register(csrfProtection, {
    sessionPlugin: '@fastify/session',
    cookieOpts: { signed: false },
  });

  // Apply CSRF protection to all unsafe methods on /admin/*
  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/admin')) return;
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return;
    await new Promise((resolve, reject) => {
      app.csrfProtection(req, reply, (err) => err ? reject(err) : resolve());
    });
  });

  // Friendly error page for CSRF failures
  app.setErrorHandler((err, req, reply) => {
    if (err.code === 'FST_CSRF_INVALID_TOKEN' || err.code === 'FST_CSRF_MISSING_SECRET') {
      req.log.warn({ url: req.url, code: err.code }, 'CSRF rejected');
      // For unauthenticated login pages: just bounce back to login (don't destroy session
      // because the user may have a half-formed pre-auth state from a stale cached page).
      const isLoginFlow = req.url.startsWith('/admin/login') || req.url.startsWith('/admin/setup-2fa');
      if (isLoginFlow) {
        return reply.redirect('/admin/login?error=expired');
      }
      // For authenticated admin actions: destroy session for safety
      if (req.session?.destroy) {
        return new Promise(r => req.session.destroy(() => r()))
          .then(() => reply.redirect('/admin/login?error=expired'));
      }
      return reply.redirect('/admin/login?error=expired');
    }
    if (err.statusCode && err.statusCode < 500) {
      return reply.code(err.statusCode).send({
        error: err.code || 'error',
        message: err.message,
      });
    }
    req.log.error({ err }, 'unhandled');
    reply.code(err.statusCode || 500).send({ error: 'internal' });
  });

  // Disable browser caching for all admin pages — prevents stale CSRF tokens
  app.addHook('onSend', async (req, reply) => {
    if (req.url.startsWith('/admin')) {
      reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      reply.header('Pragma', 'no-cache');
    }
  });

  await app.register(view, {
    engine: { ejs },
    root: join(__dirname, 'views'),
    viewExt: 'ejs',
  });

  // Serve static admin assets (JS, CSS) under /admin-assets/*
  await app.register(fastifyStatic, {
    root: join(__dirname, 'public'),
    prefix: '/admin-assets/',
    decorateReply: false,
    serve: true,
    constraints: {},
  });

  // CORS: handled manually for fine-grained control (only allow listed origins)
  app.addHook('onSend', async (req, reply) => {
    const origin = req.headers.origin;
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
      reply.header('Access-Control-Allow-Origin', origin);
      reply.header('Vary', 'Origin');
      reply.header('Access-Control-Allow-Credentials', 'false');
      reply.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      reply.header('Access-Control-Allow-Headers', 'Content-Type');
    }
  });

  // Health check
  app.get('/health', async () => {
    await pool.query('select 1');
    return { ok: true };
  });

  // CORS preflight
  app.options('/api/*', async (req, reply) => {
    reply.code(204).send();
  });

  // Routes (lazy registration in subsequent phases)
  const { publicRoutes } = await import('./routes/public.js');
  await app.register(publicRoutes, { prefix: '/api' });

  const { adminAuthRoutes } = await import('./routes/admin-auth.js');
  await app.register(adminAuthRoutes, { prefix: '/admin' });

  const { adminRoutes } = await import('./routes/admin.js');
  await app.register(adminRoutes, { prefix: '/admin' });

  // DSG retention cron (anonymize old registrations, purge IP hashes)
  const { startAnonymizer } = await import('./services/anonymizer.js');
  startAnonymizer(pool, app.log);

  // Google Reviews weekly sync
  const { startReviewSync } = await import('./services/google-reviews.js');
  startReviewSync(app.log);

  // 24h reminder mails for Nothelferkurs participants
  const { startReminderSender } = await import('./services/reminder-mailer.js');
  startReminderSender(pool, app.log);

  return app;
}

const app = await buildApp();
const port = Number(process.env.PORT || 3000);
try {
  await app.listen({ port, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
