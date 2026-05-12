import { Resend } from 'resend';
import ejs from 'ejs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatZurich } from './courses.js';

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
