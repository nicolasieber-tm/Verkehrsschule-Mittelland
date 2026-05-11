import { z } from 'zod';

export const roomInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  address_line1: z.string().trim().min(1).max(200),
  address_line2: z.string().trim().max(200).optional().or(z.literal('')),
  postal_code: z.string().trim().regex(/^\d{4,6}$/, 'Ungültige PLZ'),
  city: z.string().trim().min(1).max(100),
  capacity: z.preprocess(
    v => v === '' || v == null ? null : v,
    z.coerce.number().int().positive().max(500).nullable()
  ),
  notes: z.string().trim().max(2000).optional().or(z.literal('')),
});

export async function listRooms(pool, { includeArchived = false } = {}) {
  const where = includeArchived ? '' : 'where archived_at is null';
  const { rows } = await pool.query(
    `select r.*,
            (select count(*) from courses c where c.room_id = r.id) as course_count
       from rooms r
       ${where}
       order by archived_at nulls first, city asc, name asc`
  );
  return rows;
}

export async function getRoom(pool, id) {
  const { rows } = await pool.query('select * from rooms where id=$1', [id]);
  return rows[0] || null;
}

export async function createRoom(pool, data) {
  const { rows } = await pool.query(
    `insert into rooms (name, address_line1, address_line2, postal_code, city, capacity, notes)
     values ($1,$2,$3,$4,$5,$6,$7)
     returning id`,
    [data.name, data.address_line1, data.address_line2 || null,
     data.postal_code, data.city, data.capacity, data.notes || null]
  );
  return rows[0];
}

export async function updateRoom(pool, id, data) {
  await pool.query(
    `update rooms set
       name=$1, address_line1=$2, address_line2=$3,
       postal_code=$4, city=$5, capacity=$6, notes=$7,
       updated_at=now()
     where id=$8`,
    [data.name, data.address_line1, data.address_line2 || null,
     data.postal_code, data.city, data.capacity, data.notes || null, id]
  );
}

export async function archiveRoom(pool, id) {
  await pool.query('update rooms set archived_at=now(), updated_at=now() where id=$1', [id]);
}

export async function restoreRoom(pool, id) {
  await pool.query('update rooms set archived_at=null, updated_at=now() where id=$1', [id]);
}

export async function deleteRoom(pool, id) {
  // Only allow physical delete if no courses use it. If courses use it, force archive.
  const { rows } = await pool.query('select count(*)::int as n from courses where room_id=$1', [id]);
  if (rows[0].n > 0) {
    const e = new Error('Raum kann nicht gelöscht werden — wird von ' + rows[0].n + ' Kurs(en) verwendet. Bitte stattdessen archivieren.');
    e.userMessage = e.message;
    throw e;
  }
  await pool.query('delete from rooms where id=$1', [id]);
}

export function roomToAddressString(r) {
  if (!r) return '';
  const lines = [r.address_line1];
  if (r.address_line2) lines.push(r.address_line2);
  lines.push(`${r.postal_code} ${r.city}`);
  return lines.join('\n');
}
