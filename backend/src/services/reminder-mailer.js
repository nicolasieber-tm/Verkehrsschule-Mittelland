// 24h-Erinnerungs-Mail Cron — schickt Teilnehmern eine Erinnerung am Tag vor Kursbeginn.
// Läuft im selben Prozess wie das Backend (kein externer Scheduler nötig).
import { sendReminderMail } from './mail.js';

// Defaults (overridable via env):
//   REMINDER_INTERVAL_MINUTES — Cron-Tick (default 60 = stündlich)
//   REMINDER_WINDOW_HOURS_MIN/MAX — Zeitfenster vor Kursstart (default 23.5 – 24.5h)
export function startReminderSender(pool, log) {
  const intervalMin = Number(process.env.REMINDER_INTERVAL_MINUTES || 60);
  const winMin = Number(process.env.REMINDER_WINDOW_HOURS_MIN || 23.5);
  const winMax = Number(process.env.REMINDER_WINDOW_HOURS_MAX || 24.5);

  async function runOnce() {
    try {
      const { rows } = await pool.query(
        `select r.id
           from registrations r
           join courses c on c.id = r.course_id
          where r.reminder_mail_status = 'pending'
            and r.status = 'confirmed'
            and c.starts_at between now() + ($1 || ' hours')::interval
                               and now() + ($2 || ' hours')::interval`,
        [winMin, winMax]
      );
      if (rows.length === 0) return;
      log.info({ count: rows.length }, 'reminder: batch start');
      for (const row of rows) {
        try {
          await sendReminderMail(pool, row.id, log);
        } catch (err) {
          log.error({ err: err.message, registrationId: row.id }, 'reminder: send failed');
        }
      }
      log.info({ count: rows.length }, 'reminder: batch done');
    } catch (err) {
      log.error({ err: err.message }, 'reminder: tick failed');
    }
  }

  setTimeout(runOnce, 10_000);
  const handle = setInterval(runOnce, intervalMin * 60_000);
  return () => clearInterval(handle);
}
