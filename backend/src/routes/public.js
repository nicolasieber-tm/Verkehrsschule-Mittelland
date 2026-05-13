import { registrationInputSchema, createRegistration, BookingError } from '../services/registrations.js';
import {
  packageRequestInputSchema, createPackageRequest,
  isValidMagic, ALLOWED_FILE_MIME, MAX_FILE_BYTES,
} from '../services/package-requests.js';
import { sendRegistrationMails, sendPackageRequestMails, sendVoucherOrderMails } from '../services/mail.js';
import { voucherOrderInputSchema, createVoucherOrder } from '../services/vouchers.js';

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

function originOk(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  return ALLOWED_ORIGINS.includes(origin);
}

export async function publicRoutes(app) {

  // ---- GET /api/courses?location=… ----
  app.get('/courses', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const location = typeof req.query?.location === 'string' ? req.query.location : null;
    const params = [];
    let where = `status = 'open' and starts_at > now() and booked_seats < max_seats`;
    if (location) { params.push(location); where += ` and location = $${params.length}`; }
    const { rows } = await app.pg.query(
      `select id, category, variant, location, course_no, price_chf,
              max_seats, booked_seats, starts_at, registration_deadline, sessions
         from courses
        where ${where}
        order by starts_at asc`,
      params
    );
    reply.header('Cache-Control', 'no-store');
    return { courses: rows };
  });

  // ---- GET /api/courses/:id ----
  app.get('/courses/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(404).send({ error: 'Not found' });
    const { rows } = await app.pg.query(
      `select id, category, variant, location, course_no, price_chf,
              max_seats, booked_seats, starts_at, registration_deadline, sessions, status
         from courses where id = $1`,
      [id]
    );
    const c = rows[0];
    if (!c) return reply.code(404).send({ error: 'Not found' });
    // Only expose bookable courses publicly
    if (c.status !== 'open' || new Date(c.starts_at) < new Date()) {
      return reply.code(404).send({ error: 'Not bookable' });
    }
    reply.header('Cache-Control', 'no-store');
    return { course: c };
  });

  // ---- POST /api/registrations ----
  app.post('/registrations', {
    config: {
      rateLimit: {
        // Per-IP only (body not available in keyGenerator). Email throttling
        // is enforced via the DB unique index on (course_id, lower(email)).
        max: 20,
        timeWindow: '1 minute',
      },
    },
  }, async (req, reply) => {
    // Origin check — strict, no Referer fallback
    if (!originOk(req)) {
      app.log.warn({ origin: req.headers.origin }, 'rejected POST /api/registrations: bad origin');
      return reply.code(403).send({ error: 'Forbidden origin' });
    }

    const parsed = registrationInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_input',
        details: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
      });
    }

    const data = parsed.data;

    // Honeypot
    if (data.website && data.website.length > 0) {
      app.log.warn({ ip: req.ip }, 'honeypot triggered');
      return reply.code(400).send({ error: 'invalid_input' });
    }
    // Time-trap: must be at least 2 seconds since form load
    if (data.ts) {
      const elapsedMs = Date.now() - data.ts;
      if (elapsedMs < 2000 || elapsedMs > 30 * 60 * 1000) {
        app.log.warn({ elapsedMs }, 'time-trap triggered');
        return reply.code(400).send({ error: 'invalid_input' });
      }
    }

    // Consent both required
    if (!data.consent_privacy || !data.consent_terms) {
      return reply.code(400).send({ error: 'consent_required' });
    }

    try {
      const result = await createRegistration(app.pg, data, {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });

      // Trigger mail send (fire-and-forget; failures logged by mailer)
      app.log.info({ registrationId: result.registrationId, courseId: data.course_id }, 'registration created');
      // Phase 6 will hook into this point and call mail.js sendRegistrationMails
      sendMailsAsync(app, result.registrationId).catch(err => {
        app.log.error({ err: err.message, registrationId: result.registrationId }, 'mail send failed');
      });

      return reply.code(201).send({
        ok: true,
        registrationId: result.registrationId,
        courseNo: result.course.course_no,
      });
    } catch (err) {
      if (err instanceof BookingError) {
        return reply.code(err.status).send({ error: err.code, message: err.userMessage });
      }
      app.log.error({ err: err.message }, 'unhandled error in /registrations');
      return reply.code(500).send({ error: 'internal' });
    }
  });

  // Register multipart-based package request route on the same plugin scope
  await packageRequestRoute(app);

  // ---- POST /api/voucher-orders ----
  app.post('/voucher-orders', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    if (!originOk(req)) {
      app.log.warn({ origin: req.headers.origin }, 'rejected POST /api/voucher-orders: bad origin');
      return reply.code(403).send({ error: 'Forbidden origin' });
    }

    const parsed = voucherOrderInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_input',
        details: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const data = parsed.data;

    if (data.website && data.website.length > 0) {
      app.log.warn({ ip: req.ip }, 'honeypot triggered (voucher-order)');
      return reply.code(400).send({ error: 'invalid_input' });
    }
    if (data.ts) {
      const elapsedMs = Date.now() - data.ts;
      if (elapsedMs < 2000 || elapsedMs > 30 * 60 * 1000) {
        app.log.warn({ elapsedMs }, 'time-trap triggered (voucher-order)');
        return reply.code(400).send({ error: 'invalid_input' });
      }
    }
    if (!data.consent_privacy || !data.consent_terms) {
      return reply.code(400).send({ error: 'consent_required' });
    }

    try {
      const result = await createVoucherOrder(app.pg, data, {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
      app.log.info({ orderId: result.orderId, betrag: data.betrag_chf }, 'voucher order created');
      // Detach mail send to a separate microtask so any failure cannot interfere
      // with this reply's lifecycle. Triple-guarded against unhandled rejections.
      setImmediate(() => {
        Promise.resolve()
          .then(() => sendVoucherOrderMails(app.pg, result.orderId, app.log))
          .catch(err => {
            try { app.log.error({ err: String(err?.message || err), orderId: result.orderId }, 'voucher mail send failed'); } catch {}
          });
      });
      return reply.code(201).send({ ok: true, orderId: result.orderId });
    } catch (err) {
      app.log.error({ err: err.message }, 'unhandled error in /voucher-orders');
      return reply.code(500).send({ error: 'internal' });
    }
  });
}

async function sendMailsAsync(app, registrationId) {
  // Fire-and-forget; mail.js stores per-target status in DB
  return sendRegistrationMails(app.pg, registrationId, app.log);
}

// ---- POST /api/package-requests (multipart) ----
export async function packageRequestRoute(app) {
  app.post('/package-requests', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    bodyLimit: 6 * 1024 * 1024, // override 16kb global; multipart parses up to its own fileSize limit
  }, async (req, reply) => {
    // Origin check first — FormData posts trigger NO CORS preflight without custom headers
    const origin = req.headers.origin;
    const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!origin || !allowed.includes(origin)) {
      app.log.warn({ origin }, 'rejected POST /api/package-requests: bad origin');
      return reply.code(403).send({ error: 'Forbidden origin' });
    }

    if (!req.isMultipart()) {
      return reply.code(400).send({ error: 'invalid_input', message: 'multipart/form-data required' });
    }

    const fields = {};
    let fileBuf = null;
    let fileMeta = null;

    try {
      for await (const part of req.parts()) {
        if (part.type === 'field') {
          fields[part.fieldname] = part.value;
        } else if (part.type === 'file') {
          if (part.fieldname !== 'lernfahrausweis') {
            // Unexpected file field; drain and ignore
            await part.toBuffer().catch(() => {});
            continue;
          }
          if (!ALLOWED_FILE_MIME.includes(part.mimetype)) {
            return reply.code(400).send({ error: 'invalid_file_type' });
          }
          fileBuf = await part.toBuffer();
          if (fileBuf.length === 0) {
            fileBuf = null;
          } else if (fileBuf.length > MAX_FILE_BYTES) {
            return reply.code(413).send({ error: 'file_too_large' });
          } else if (!isValidMagic(fileBuf, part.mimetype)) {
            return reply.code(400).send({ error: 'invalid_file_type' });
          } else {
            fileMeta = {
              filename: part.filename,
              mime_type: part.mimetype,
              size_bytes: fileBuf.length,
            };
          }
        }
      }
    } catch (err) {
      const isTooLarge =
        err?.code === 'FST_REQ_FILE_TOO_LARGE' ||
        err?.code === 'FST_FILES_LIMIT' ||
        (app.multipartErrors && err instanceof app.multipartErrors.RequestFileTooLargeError);
      if (isTooLarge) {
        return reply.code(413).send({ error: 'file_too_large' });
      }
      app.log.error({ err: err?.message }, 'multipart parse error');
      return reply.code(400).send({ error: 'invalid_input' });
    }

    const parsed = packageRequestInputSchema.safeParse(fields);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_input',
        details: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const data = parsed.data;

    // Honeypot
    if (data.website && data.website.length > 0) {
      app.log.warn({ ip: req.ip }, 'honeypot triggered (package-request)');
      return reply.code(400).send({ error: 'invalid_input' });
    }
    // Time-trap
    if (data.ts) {
      const elapsedMs = Date.now() - data.ts;
      if (elapsedMs < 2000 || elapsedMs > 30 * 60 * 1000) {
        app.log.warn({ elapsedMs }, 'time-trap triggered (package-request)');
        return reply.code(400).send({ error: 'invalid_input' });
      }
    }
    if (!data.consent_privacy || !data.consent_terms) {
      return reply.code(400).send({ error: 'consent_required' });
    }

    try {
      const result = await createPackageRequest(app.pg, data, {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        file: fileBuf && fileMeta ? { buf: fileBuf, meta: fileMeta } : null,
      });
      app.log.info({ requestId: result.requestId, type: data.type, with_vku: data.with_vku }, 'package request created');
      sendPackageRequestMails(app.pg, result.requestId, app.log).catch(err => {
        app.log.error({ err: err.message, requestId: result.requestId }, 'package mail send failed');
      });
      return reply.code(201).send({ ok: true, requestId: result.requestId });
    } catch (err) {
      if (err instanceof BookingError) {
        return reply.code(err.status).send({ error: err.code, message: err.userMessage });
      }
      app.log.error({ err: err.message }, 'unhandled error in /package-requests');
      return reply.code(500).send({ error: 'internal' });
    }
  });
}
