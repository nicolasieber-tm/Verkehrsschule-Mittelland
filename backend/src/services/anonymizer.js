// DSG-Retention Cron — automated anonymization of old registrations + IP-hash purge
import { anonymizeRegistration } from './admin-registrations.js';

// Defaults (overridable via env):
//   ANONYMIZE_AFTER_DAYS — how long to keep PII after course end (default 730 = 2 years)
//   IP_HASH_RETENTION_DAYS — how long to keep IP hashes (default 30)
//   ANONYMIZE_INTERVAL_MINUTES — how often to run the cron (default 1440 = daily)
export function startAnonymizer(pool, log) {
  const days = Number(process.env.ANONYMIZE_AFTER_DAYS || 730);
  const ipDays = Number(process.env.IP_HASH_RETENTION_DAYS || 30);
  const intervalMin = Number(process.env.ANONYMIZE_INTERVAL_MINUTES || 1440);

  async function runOnce() {
    try {
      // 1) Purge IP hashes older than IP_HASH_RETENTION_DAYS regardless of status
      const ipRes = await pool.query(
        `update registrations
            set submitted_ip_hash = null, user_agent = null
          where submitted_ip_hash is not null
            and created_at < now() - ($1 || ' days')::interval`,
        [ipDays]
      );
      if (ipRes.rowCount > 0) log.info({ purged: ipRes.rowCount }, 'anonymizer: purged IP hashes');

      // 2) Find registrations to anonymize:
      //    - course ended more than ANONYMIZE_AFTER_DAYS ago
      //    - PII not yet anonymized (vname != '—')
      const { rows } = await pool.query(
        `select r.id from registrations r
           join courses c on c.id = r.course_id
          where c.starts_at < now() - ($1 || ' days')::interval
            and r.vname <> '—'`,
        [days]
      );
      for (const r of rows) {
        try {
          await anonymizeRegistration(pool, r.id);
          log.info({ registrationId: r.id }, 'anonymizer: anonymized');
        } catch (err) {
          log.error({ err: err.message, registrationId: r.id }, 'anonymizer: failed for one record');
        }
      }
      if (rows.length > 0) log.info({ count: rows.length }, 'anonymizer: batch done');
    } catch (err) {
      log.error({ err: err.message }, 'anonymizer: tick failed');
    }
  }

  // Run once on boot (catch up), then on interval
  setTimeout(runOnce, 5_000);
  const handle = setInterval(runOnce, intervalMin * 60_000);
  return () => clearInterval(handle);
}
