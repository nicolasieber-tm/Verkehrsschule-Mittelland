import { z } from 'zod';

// JSON schema for course sessions (the actual class days)
export const sessionItemSchema = z.object({
  day: z.string().min(1).max(20),       // 'Freitag' etc.
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  from: z.string().regex(/^\d{2}:\d{2}$/),
  to: z.string().regex(/^\d{2}:\d{2}$/),
});

export const courseInputSchema = z.object({
  category: z.literal('nothelfer').default('nothelfer'),
  variant: z.enum(['classic', 'elearning']),
  room_id: z.coerce.number().int().positive(),
  course_no: z.string().min(3).max(50),
  price_chf: z.coerce.number().int().min(0).max(10000),
  max_seats: z.coerce.number().int().min(1).max(200),
  starts_at: z.string().min(10),
  registration_deadline: z.string().optional().nullable(),
  sessions: z.array(sessionItemSchema).min(1).max(20),
  status: z.enum(['open', 'closed', 'archived']).default('open'),
});

// Convert a local 'Europe/Zurich' datetime-local string to UTC ISO.
// Algorithm: treat input as UTC ("naive"), then see what Zurich would render
// that moment as ("obs"). The Zurich offset is `obs - naive`. The real UTC for
// the desired Zurich-local time is therefore `2*naive - obs`.
export function zurichLocalToUtcIso(localStr) {
  if (!localStr) return null;
  const m = String(localStr).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(naive));
  const p = Object.fromEntries(parts.filter(x => x.type !== 'literal').map(x => [x.type, parseInt(x.value, 10)]));
  const obs = Date.UTC(p.year, p.month - 1, p.day, p.hour === 24 ? 0 : p.hour, p.minute);
  return new Date(2 * naive - obs).toISOString();
}

export function utcToZurichLocalInput(d) {
  if (!d) return '';
  const dt = new Date(d);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(dt);
  const map = Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  const hh = map.hour === '24' ? '00' : map.hour;
  return `${map.year}-${map.month}-${map.day}T${hh}:${map.minute}`;
}

export function formatZurich(d) {
  if (!d) return '';
  return new Date(d).toLocaleString('de-CH', { timeZone: 'Europe/Zurich' });
}

export function listCourses(pool, filter = {}) {
  const where = [];
  const params = [];
  if (filter.status) { params.push(filter.status); where.push(`status = $${params.length}`); }
  if (filter.location) { params.push(filter.location); where.push(`location = $${params.length}`); }
  const sql = `select * from courses ${where.length ? 'where ' + where.join(' and ') : ''} order by starts_at desc`;
  return pool.query(sql, params).then(r => r.rows);
}

export async function getCourse(pool, id) {
  const { rows } = await pool.query('select * from courses where id=$1', [id]);
  return rows[0] || null;
}

// Returns { id } on success or throws with .userMessage
async function locationFromRoom(pool, roomId) {
  const { rows } = await pool.query('select city from rooms where id=$1', [roomId]);
  if (!rows[0]) { const e = new Error('Raum nicht gefunden.'); e.userMessage = e.message; throw e; }
  return rows[0].city;
}

export async function createCourse(pool, input) {
  const startsAtUtc = zurichLocalToUtcIso(input.starts_at);
  if (!startsAtUtc) {
    const err = new Error('Ungültiges Startdatum.');
    err.userMessage = err.message;
    throw err;
  }
  const deadlineUtc = input.registration_deadline ? zurichLocalToUtcIso(input.registration_deadline) : null;
  const location = await locationFromRoom(pool, input.room_id);
  try {
    const { rows } = await pool.query(
      `insert into courses (category, variant, location, room_id, course_no, price_chf, max_seats,
                            starts_at, registration_deadline, sessions, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11) returning id`,
      [input.category, input.variant, location, input.room_id, input.course_no, input.price_chf,
       input.max_seats, startsAtUtc, deadlineUtc, JSON.stringify(input.sessions), input.status]
    );
    return rows[0];
  } catch (err) {
    if (err.code === '23505') {
      const e = new Error('Kursnummer bereits vergeben.'); e.userMessage = e.message; throw e;
    }
    throw err;
  }
}

export async function updateCourse(pool, id, input) {
  const current = await getCourse(pool, id);
  if (!current) { const e = new Error('Kurs nicht gefunden.'); e.userMessage = e.message; throw e; }

  // Guard: max_seats must not be lowered below booked_seats
  if (input.max_seats < current.booked_seats) {
    const e = new Error(`Maximale Plätze (${input.max_seats}) darf nicht kleiner sein als bereits belegte Plätze (${current.booked_seats}).`);
    e.userMessage = e.message;
    throw e;
  }

  const startsAtUtc = zurichLocalToUtcIso(input.starts_at);
  if (!startsAtUtc) { const e = new Error('Ungültiges Startdatum.'); e.userMessage = e.message; throw e; }
  const deadlineUtc = input.registration_deadline ? zurichLocalToUtcIso(input.registration_deadline) : null;
  const location = await locationFromRoom(pool, input.room_id);

  try {
    await pool.query(
      `update courses set
         variant=$1, location=$2, room_id=$3, course_no=$4, price_chf=$5, max_seats=$6,
         starts_at=$7, registration_deadline=$8, sessions=$9::jsonb, status=$10,
         updated_at=now()
       where id=$11`,
      [input.variant, location, input.room_id, input.course_no, input.price_chf, input.max_seats,
       startsAtUtc, deadlineUtc, JSON.stringify(input.sessions), input.status, id]
    );
  } catch (err) {
    if (err.code === '23505') {
      const e = new Error('Kursnummer bereits vergeben.'); e.userMessage = e.message; throw e;
    }
    throw err;
  }
}

export async function setCourseStatus(pool, id, status) {
  if (!['open', 'closed', 'archived'].includes(status)) throw new Error('Ungültiger Status.');
  await pool.query('update courses set status=$1, updated_at=now() where id=$2', [status, id]);
}

export async function deleteCourse(pool, id) {
  // Only allow delete if no registrations exist at all
  const { rows } = await pool.query('select count(*)::int as n from registrations where course_id=$1', [id]);
  if (rows[0].n > 0) {
    const e = new Error('Kurs kann nicht gelöscht werden — Anmeldungen vorhanden. Bitte stattdessen archivieren.');
    e.userMessage = e.message;
    throw e;
  }
  await pool.query('delete from courses where id=$1', [id]);
}

// Parse sessions[] from form fields like: sessions[0][day], sessions[0][date], …
export function parseSessionsFromForm(body) {
  // Supports either pre-parsed array, or repeated indexed fields
  if (Array.isArray(body.sessions)) return body.sessions;
  const out = [];
  const re = /^sessions\[(\d+)\]\[(day|date|from|to)\]$/;
  for (const [k, v] of Object.entries(body)) {
    const m = k.match(re);
    if (!m) continue;
    const idx = Number(m[1]);
    if (!out[idx]) out[idx] = {};
    out[idx][m[2]] = String(v);
  }
  return out.filter(Boolean);
}
