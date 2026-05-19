import { Resend } from 'resend';
import ejs from 'ejs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatZurich } from './courses.js';
import { typeLabel } from './package-requests.js';
import { hasSeparateShipping, shippingAddress } from './vouchers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAILS_DIR = join(__dirname, '..', 'mails');

let resendClient = null;
function getClient() {
  if (resendClient) return resendClient;
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  resendClient = new Resend(key);
  return resendClient;
}

async function renderTemplate(name, data) {
  const tpl = await readFile(join(MAILS_DIR, name), 'utf8');
  return ejs.render(tpl, data, { async: false });
}

function sanitize(s) {
  // Strip newlines + control chars for header use
  return String(s || '').replace(/[\r\n\t\x00-\x1f]/g, ' ').slice(0, 200);
}

function sessionsTable(sessions) {
  if (!Array.isArray(sessions)) return '';
  return sessions.map(s => `${s.day} ${s.date}  ${s.from} – ${s.to}`).join('\n');
}

async function sendOne({ to, subject, html, text, replyTo }) {
  const client = getClient();
  const from = process.env.MAIL_FROM || 'anmeldung@verkehrsschule-mittelland.ch';
  if (!client) {
    // Dev mode: log instead of actually sending
    console.log('--- MAIL (dry-run, no RESEND_API_KEY) ---');
    console.log('From:', from);
    console.log('To:', to);
    console.log('Subject:', subject);
    console.log('Text:', text);
    console.log('---');
    return { id: 'dry-run-' + Date.now(), simulated: true };
  }
  const resp = await client.emails.send({
    from,
    to,
    subject: sanitize(subject),
    html,
    text,
    replyTo: replyTo ? sanitize(replyTo) : undefined,
  });
  if (resp.error) throw new Error(resp.error.message || JSON.stringify(resp.error));
  return resp.data;
}

/**
 * Send both confirmation mails for a registration.
 * Updates DB with per-target status (sent / failed + error).
 * Never throws — failures are stored in DB for admin to retry.
 */
export async function sendRegistrationMails(pool, registrationId, log) {
  const { rows } = await pool.query(
    `select r.*, c.course_no, c.location, c.variant, c.price_chf, c.starts_at, c.sessions,
            rm.name as room_name, rm.address_line1 as room_addr1, rm.address_line2 as room_addr2,
            rm.postal_code as room_plz, rm.city as room_city
       from registrations r
       join courses c on c.id = r.course_id
       left join rooms rm on rm.id = c.room_id
      where r.id = $1`,
    [registrationId]
  );
  const r = rows[0];
  if (!r) { log?.warn({ registrationId }, 'mail: registration not found'); return; }

  const roomAddressLines = [];
  if (r.room_name) roomAddressLines.push(r.room_name);
  if (r.room_addr1) roomAddressLines.push(r.room_addr1);
  if (r.room_addr2) roomAddressLines.push(r.room_addr2);
  if (r.room_plz) roomAddressLines.push(`${r.room_plz} ${r.room_city}`);

  const ctx = {
    reg: r,
    fullName: `${r.vname} ${r.nname}`,
    variantLabel: r.variant === 'classic' ? 'Klassischer Nothelferkurs' : 'eNothelferkurs',
    isElearning: r.variant === 'elearning',
    coursePretty: `${r.course_no} (${r.location})`,
    startsAtPretty: formatZurich(r.starts_at),
    sessionsText: sessionsTable(r.sessions),
    roomAddress: roomAddressLines.join('\n'),
    hasRoom: roomAddressLines.length > 0,
  };

  // --- Participant mail ---
  if (r.participant_mail_status !== 'sent') {
    try {
      const html = await renderTemplate('participant.html.ejs', ctx);
      const text = await renderTemplate('participant.txt.ejs', ctx);
      await sendOne({
        to: r.email,
        subject: `Anmeldebestätigung Nothelferkurs ${r.course_no}`,
        html, text,
        replyTo: process.env.MAIL_TO_SCHOOL,
      });
      await pool.query(
        `update registrations set participant_mail_status='sent', participant_mail_error=null where id=$1`,
        [registrationId]
      );
      log?.info({ registrationId }, 'participant mail sent');
    } catch (err) {
      log?.error({ registrationId, err: err.message }, 'participant mail failed');
      await pool.query(
        `update registrations set participant_mail_status='failed', participant_mail_error=$1 where id=$2`,
        [String(err.message || err).slice(0, 500), registrationId]
      );
    }
  }

  // --- School mail ---
  if (r.school_mail_status !== 'sent') {
    const schoolTo = process.env.MAIL_TO_SCHOOL;
    if (!schoolTo) {
      log?.warn({ registrationId }, 'MAIL_TO_SCHOOL not set, skipping school mail');
    } else {
      try {
        const html = await renderTemplate('school.html.ejs', ctx);
        const text = await renderTemplate('school.txt.ejs', ctx);
        await sendOne({
          to: schoolTo,
          subject: `Neue Anmeldung: ${ctx.fullName} (${r.course_no})`,
          html, text,
          replyTo: r.email,
        });
        await pool.query(
          `update registrations set school_mail_status='sent', school_mail_error=null where id=$1`,
          [registrationId]
        );
        log?.info({ registrationId }, 'school mail sent');
      } catch (err) {
        log?.error({ registrationId, err: err.message }, 'school mail failed');
        await pool.query(
          `update registrations set school_mail_status='failed', school_mail_error=$1 where id=$2`,
          [String(err.message || err).slice(0, 500), registrationId]
        );
      }
    }
  }
}

/**
 * Send the 24h reminder mail for a single registration.
 * Updates DB status (sent / failed). Never throws.
 */
export async function sendReminderMail(pool, registrationId, log) {
  const { rows } = await pool.query(
    `select r.*, c.course_no, c.location, c.variant, c.price_chf, c.starts_at, c.sessions,
            rm.name as room_name, rm.address_line1 as room_addr1, rm.address_line2 as room_addr2,
            rm.postal_code as room_plz, rm.city as room_city
       from registrations r
       join courses c on c.id = r.course_id
       left join rooms rm on rm.id = c.room_id
      where r.id = $1`,
    [registrationId]
  );
  const r = rows[0];
  if (!r) { log?.warn({ registrationId }, 'reminder: registration not found'); return; }
  if (r.reminder_mail_status === 'sent') return;

  const roomAddressLines = [];
  if (r.room_name) roomAddressLines.push(r.room_name);
  if (r.room_addr1) roomAddressLines.push(r.room_addr1);
  if (r.room_addr2) roomAddressLines.push(r.room_addr2);
  if (r.room_plz) roomAddressLines.push(`${r.room_plz} ${r.room_city}`);

  const ctx = {
    reg: r,
    fullName: `${r.vname} ${r.nname}`,
    variantLabel: r.variant === 'classic' ? 'Klassischer Nothelferkurs' : 'eNothelferkurs',
    isElearning: r.variant === 'elearning',
    startsAtPretty: formatZurich(r.starts_at),
    sessionsText: sessionsTable(r.sessions),
    roomAddress: roomAddressLines.join('\n'),
    hasRoom: roomAddressLines.length > 0,
  };

  try {
    const html = await renderTemplate('participant-reminder.html.ejs', ctx);
    const text = await renderTemplate('participant-reminder.txt.ejs', ctx);
    await sendOne({
      to: r.email,
      subject: `Erinnerung: Nothelferkurs morgen — ${r.course_no}`,
      html, text,
      replyTo: process.env.MAIL_TO_SCHOOL,
    });
    await pool.query(
      `update registrations
          set reminder_mail_status='sent', reminder_mail_error=null, reminder_mail_sent_at=now()
        where id=$1`,
      [registrationId]
    );
    log?.info({ registrationId }, 'reminder mail sent');
  } catch (err) {
    log?.error({ registrationId, err: err.message }, 'reminder mail failed');
    await pool.query(
      `update registrations set reminder_mail_status='failed', reminder_mail_error=$1 where id=$2`,
      [String(err.message || err).slice(0, 500), registrationId]
    );
  }
}

/**
 * Send confirmation + school-notification mails for a package_request.
 * Updates DB per-target status (sent / failed + error). Never throws — failures stored in DB.
 */
export async function sendPackageRequestMails(pool, requestId, log) {
  const { rows } = await pool.query(
    `select * from package_requests where id = $1`,
    [requestId]
  );
  const r = rows[0];
  if (!r) { log?.warn({ requestId }, 'mail: package_request not found'); return; }

  const hasFile = (await pool.query(
    `select 1 from package_request_files where request_id=$1 limit 1`, [requestId]
  )).rowCount > 0;

  const ctx = {
    req: r,
    fullName: `${r.vname} ${r.nname}`,
    typeLabel: typeLabel(r.type),
    withVku: !!r.with_vku,
    hasFile,
    createdAtPretty: formatZurich(r.created_at),
  };

  // --- Customer confirmation ---
  if (r.customer_mail_status !== 'sent') {
    try {
      const html = await renderTemplate('package-request-customer.html.ejs', ctx);
      const text = await renderTemplate('package-request-customer.txt.ejs', ctx);
      await sendOne({
        to: r.email,
        subject: `Anfrage erhalten — ${ctx.typeLabel}`,
        html, text,
        replyTo: process.env.MAIL_TO_SCHOOL,
      });
      await pool.query(
        `update package_requests set customer_mail_status='sent', customer_mail_error=null, updated_at=now() where id=$1`,
        [requestId]
      );
      log?.info({ requestId }, 'package customer mail sent');
    } catch (err) {
      log?.error({ requestId, err: err.message }, 'package customer mail failed');
      await pool.query(
        `update package_requests set customer_mail_status='failed', customer_mail_error=$1, updated_at=now() where id=$2`,
        [String(err.message || err).slice(0, 500), requestId]
      );
    }
  }

  // --- School notification ---
  if (r.school_mail_status !== 'sent') {
    const schoolTo = process.env.MAIL_TO_SCHOOL;
    if (!schoolTo) {
      log?.warn({ requestId }, 'MAIL_TO_SCHOOL not set, skipping school mail');
    } else {
      try {
        const html = await renderTemplate('package-request-school.html.ejs', ctx);
        const text = await renderTemplate('package-request-school.txt.ejs', ctx);
        await sendOne({
          to: schoolTo,
          subject: `Neue Anfrage: ${ctx.typeLabel} — ${ctx.fullName}`,
          html, text,
          replyTo: r.email,
        });
        await pool.query(
          `update package_requests set school_mail_status='sent', school_mail_error=null, updated_at=now() where id=$1`,
          [requestId]
        );
        log?.info({ requestId }, 'package school mail sent');
      } catch (err) {
        log?.error({ requestId, err: err.message }, 'package school mail failed');
        await pool.query(
          `update package_requests set school_mail_status='failed', school_mail_error=$1, updated_at=now() where id=$2`,
          [String(err.message || err).slice(0, 500), requestId]
        );
      }
    }
  }
}

/**
 * Send confirmation + school-notification mails for a voucher_order.
 * Updates DB per-target status (sent / failed + error). Never throws.
 */
export async function sendVoucherOrderMails(pool, orderId, log) {
  const { rows } = await pool.query(
    `select * from voucher_orders where id = $1`,
    [orderId]
  );
  const o = rows[0];
  if (!o) { log?.warn({ orderId }, 'mail: voucher_order not found'); return; }

  const adminBase = process.env.ADMIN_BASE_URL || 'https://admin.verkehrsschule-mittelland.ch';
  const ctx = {
    order: o,
    rechnungName: `${o.rvname} ${o.rnname}`,
    shipping: shippingAddress(o),
    hasSeparateShipping: hasSeparateShipping(o),
    adminUrl: `${adminBase.replace(/\/+$/, '')}/admin/vouchers/${o.id}`,
    createdAtPretty: formatZurich(o.created_at),
  };

  // --- Customer confirmation ---
  if (o.customer_mail_status !== 'sent') {
    try {
      const html = await renderTemplate('voucher-customer.html.ejs', ctx);
      const text = await renderTemplate('voucher-customer.txt.ejs', ctx);
      await sendOne({
        to: o.email,
        subject: `Gutschein-Bestellung bestätigt — CHF ${o.betrag_chf}`,
        html, text,
        replyTo: process.env.MAIL_TO_SCHOOL,
      });
      await pool.query(
        `update voucher_orders set customer_mail_status='sent', customer_mail_error=null, updated_at=now() where id=$1`,
        [orderId]
      );
      log?.info({ orderId }, 'voucher customer mail sent');
    } catch (err) {
      log?.error({ orderId, err: err.message }, 'voucher customer mail failed');
      await pool.query(
        `update voucher_orders set customer_mail_status='failed', customer_mail_error=$1, updated_at=now() where id=$2`,
        [String(err.message || err).slice(0, 500), orderId]
      );
    }
  }

  // --- School notification ---
  if (o.school_mail_status !== 'sent') {
    const schoolTo = process.env.MAIL_TO_SCHOOL;
    if (!schoolTo) {
      log?.warn({ orderId }, 'MAIL_TO_SCHOOL not set, skipping voucher school mail');
    } else {
      try {
        const html = await renderTemplate('voucher-school.html.ejs', ctx);
        const text = await renderTemplate('voucher-school.txt.ejs', ctx);
        await sendOne({
          to: schoolTo,
          subject: `Neue Gutschein-Bestellung: CHF ${o.betrag_chf} — ${ctx.rechnungName}`,
          html, text,
          replyTo: o.email,
        });
        await pool.query(
          `update voucher_orders set school_mail_status='sent', school_mail_error=null, updated_at=now() where id=$1`,
          [orderId]
        );
        log?.info({ orderId }, 'voucher school mail sent');
      } catch (err) {
        log?.error({ orderId, err: err.message }, 'voucher school mail failed');
        await pool.query(
          `update voucher_orders set school_mail_status='failed', school_mail_error=$1, updated_at=now() where id=$2`,
          [String(err.message || err).slice(0, 500), orderId]
        );
      }
    }
  }
}
