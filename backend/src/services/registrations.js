import { z } from 'zod';
import crypto from 'node:crypto';

// Strict zod schema for registration input from the public API
export const registrationInputSchema = z.object({
  course_id: z.coerce.number().int().positive(),
  vname: z.string().trim().min(1).max(100),
  nname: z.string().trim().min(1).max(100),
  strasse: z.string().trim().min(1).max(200),
  hnr: z.string().trim().min(1).max(20),
  plz: z.string().trim().regex(/^\d{4,6}$/, 'Ungültige PLZ'),
  ort: z.string().trim().min(1).max(100),
  geburt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Geburtsdatum als YYYY-MM-DD'),
  email: z.string().trim().toLowerCase().email().max(200),
  telefon: z.string().trim().max(50).optional().or(z.literal('')),
  consent_privacy: z.preprocess(v => v === 'on' || v === true || v === 'true', z.boolean()),
  consent_terms: z.preprocess(v => v === 'on' || v === true || v === 'true', z.boolean()),
  // Honeypot — must be empty
  website: z.string().max(0).optional().or(z.literal('')),
  // Bot-trap timestamp — set by frontend on form load, server checks delta
  ts: z.coerce.number().int().optional(),
}).strict();

export class BookingError extends Error {
  constructor(message, { status = 409, code = 'booking_failed' } = {}) {
    super(message); this.status = status; this.code = code; this.userMessage = message;
  }
}

export function hashIp(ip) {
  if (!ip) return null;
  return crypto.createHash('sha256').update(ip + (process.env.SESSION_SECRET || '')).digest('hex').slice(0, 32);
}

/**
 * Race-safe registration insert.
 * Atomic UPDATE on booked_seats with all preconditions, then INSERT in the same TX.
 * On unique-violation (23505) for the partial index, rolls back so booked_seats stays correct.
 */
export async function createRegistration(pool, data, { ip, userAgent }) {
  const client = await pool.connect();
  try {
    await client.query('begin');

    // 1) Atomic seat reservation
    const upd = await client.query(
      `update courses set booked_seats = booked_seats + 1, updated_at = now()
        where id = $1
          and status = 'open'
          and now() < coalesce(registration_deadline, starts_at)
          and booked_seats < max_seats
       returning id, course_no, starts_at, price_chf`,
      [data.course_id]
    );
    if (upd.rowCount === 0) {
      // Determine why
      const { rows } = await client.query(
        `select status, starts_at, registration_deadline, max_seats, booked_seats
           from courses where id=$1`, [data.course_id]
      );
      await client.query('rollback');
      const c = rows[0];
      if (!c) throw new BookingError('Kurs nicht gefunden.', { status: 404, code: 'not_found' });
      if (c.status !== 'open') throw new BookingError('Dieser Kurs ist nicht (mehr) buchbar.', { code: 'closed' });
      const deadline = c.registration_deadline || c.starts_at;
      if (new Date() >= new Date(deadline)) throw new BookingError('Die Anmeldefrist ist abgelaufen.', { code: 'deadline_passed' });
      if (c.booked_seats >= c.max_seats) throw new BookingError('Der Kurs ist ausgebucht.', { code: 'sold_out' });
      throw new BookingError('Anmeldung nicht möglich.', { code: 'unknown' });
    }

    // 2) Insert registration (DB-unique index catches duplicate confirmed email+course)
    let regRow;
    try {
      const ins = await client.query(
        `insert into registrations
           (course_id, vname, nname, strasse, hnr, plz, ort, geburt,
            email, telefon, consent_privacy, consent_terms,
            submitted_ip_hash, user_agent)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         returning id, created_at`,
        [
          data.course_id, data.vname, data.nname, data.strasse, data.hnr,
          data.plz, data.ort, data.geburt,
          data.email, data.telefon || null,
          data.consent_privacy, data.consent_terms,
          hashIp(ip), (userAgent || '').slice(0, 500),
        ]
      );
      regRow = ins.rows[0];
    } catch (err) {
      if (err.code === '23505') {
        await client.query('rollback');
        throw new BookingError('Du bist für diesen Kurs bereits angemeldet.', { code: 'duplicate' });
      }
      throw err;
    }

    await client.query('commit');
    return { registrationId: regRow.id, course: upd.rows[0] };
  } catch (err) {
    try { await client.query('rollback'); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}
