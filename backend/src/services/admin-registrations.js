// Admin-side registration operations: list, view, edit, cancel, anonymize, hard-delete, csv
import { z } from 'zod';

export async function listRegistrations(pool, { courseId, status } = {}) {
  const where = [];
  const params = [];
  if (courseId) { params.push(courseId); where.push(`r.course_id = $${params.length}`); }
  if (status) { params.push(status); where.push(`r.status = $${params.length}`); }
  const sql = `
    select r.*, c.course_no, c.location, c.starts_at, c.variant
      from registrations r
      join courses c on c.id = r.course_id
      ${where.length ? 'where ' + where.join(' and ') : ''}
      order by r.created_at desc`;
  const { rows } = await pool.query(sql, params);
  return rows;
}

export async function getRegistration(pool, id) {
  const { rows } = await pool.query(
    `select r.*, c.course_no, c.location, c.starts_at, c.variant
       from registrations r join courses c on c.id = r.course_id
      where r.id = $1`,
    [id]
  );
  return rows[0] || null;
}

export const editInputSchema = z.object({
  paid: z.preprocess(v => v === 'on' || v === true || v === 'true', z.boolean()).default(false),
  admin_notes: z.string().max(2000).optional().or(z.literal('')),
});

export async function updateRegistration(pool, id, input) {
  await pool.query(
    `update registrations set paid = $1, admin_notes = $2, updated_at = now() where id = $3`,
    [!!input.paid, input.admin_notes || null, id]
  );
}

/** Race-safe cancel: only decrement seats if status was confirmed */
export async function cancelRegistration(pool, id) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const upd = await client.query(
      `update registrations set status='cancelled', cancelled_at=now(), updated_at=now()
        where id=$1 and status='confirmed'
       returning course_id`,
      [id]
    );
    if (upd.rowCount > 0) {
      await client.query(
        `update courses set booked_seats = booked_seats - 1, updated_at = now() where id = $1`,
        [upd.rows[0].course_id]
      );
    }
    await client.query('commit');
    return upd.rowCount > 0;
  } catch (err) {
    try { await client.query('rollback'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Anonymize: replace PII with placeholders, set status='cancelled' (decrementing seats
 * only if previous status was confirmed — idempotent via WHERE status='confirmed').
 * Email is set to anon+<id>@invalid.local so the partial unique index has no collision.
 */
export async function anonymizeRegistration(pool, id) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    // First, decrement seats if it was confirmed (atomic guard)
    const wasConfirmed = await client.query(
      `update registrations
          set status='cancelled', cancelled_at=now(), updated_at=now()
        where id=$1 and status='confirmed'
       returning course_id`,
      [id]
    );
    if (wasConfirmed.rowCount > 0) {
      await client.query(
        `update courses set booked_seats = booked_seats - 1, updated_at = now() where id = $1`,
        [wasConfirmed.rows[0].course_id]
      );
    }
    // Then anonymize PII (regardless of previous status — idempotent)
    await client.query(
      `update registrations
          set vname='—', nname='—', strasse='—', hnr='—', plz='0000', ort='—',
              geburt='1900-01-01',
              email='anon+' || id || '@invalid.local',
              telefon=null,
              admin_notes=coalesce(admin_notes,'') || ' [anonymisiert]',
              user_agent=null, submitted_ip_hash=null,
              updated_at=now()
        where id=$1`,
      [id]
    );
    await client.query('commit');
  } catch (err) {
    try { await client.query('rollback'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

export async function hardDeleteRegistration(pool, id) {
  // Only allow when status='cancelled' (Anonymize already ensures this).
  const { rows } = await pool.query('select status from registrations where id=$1', [id]);
  if (!rows[0]) { const e = new Error('Anmeldung nicht gefunden.'); e.userMessage = e.message; throw e; }
  if (rows[0].status !== 'cancelled') {
    const e = new Error('Anmeldung muss zuerst storniert oder anonymisiert werden.');
    e.userMessage = e.message;
    throw e;
  }
  await pool.query('delete from registrations where id=$1', [id]);
}

// CSV escape — guard against formula injection
function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // Prevent CSV/Excel formula injection
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  // Quote if needed
  if (/["\n,;]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function registrationsToCsv(rows) {
  const head = [
    'id', 'kurs', 'ort', 'status', 'paid',
    'vname', 'nname', 'strasse', 'hnr', 'plz', 'ort_teilnehmer',
    'geburt', 'email', 'telefon', 'eingegangen',
  ];
  const lines = [head.join(';')];
  for (const r of rows) {
    lines.push([
      r.id, r.course_no, r.location, r.status, r.paid ? 'ja' : 'nein',
      r.vname, r.nname, r.strasse, r.hnr, r.plz, r.ort,
      r.geburt && new Date(r.geburt).toISOString().slice(0, 10),
      r.email, r.telefon || '',
      new Date(r.created_at).toISOString(),
    ].map(csvCell).join(';'));
  }
  return lines.join('\n');
}
