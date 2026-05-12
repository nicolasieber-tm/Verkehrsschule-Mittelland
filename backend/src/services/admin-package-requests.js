// Admin-side package_request operations
import { z } from 'zod';

export async function listPackageRequests(pool, { type, status } = {}) {
  const where = [];
  const params = [];
  if (type) { params.push(type); where.push(`type = $${params.length}`); }
  if (status) { params.push(status); where.push(`status = $${params.length}`); }
  const sql = `
    select id, type, with_vku, vname, nname, email, telefon, location_pref,
           status, paid, customer_mail_status, school_mail_status,
           created_at, updated_at
      from package_requests
      ${where.length ? 'where ' + where.join(' and ') : ''}
      order by created_at desc`;
  const { rows } = await pool.query(sql, params);
  return rows;
}

export async function getPackageRequest(pool, id) {
  const { rows } = await pool.query(
    `select * from package_requests where id = $1`, [id]
  );
  if (!rows[0]) return null;
  const files = await pool.query(
    `select id, kind, filename, mime_type, size_bytes, created_at
       from package_request_files where request_id = $1 order by id`,
    [id]
  );
  return { ...rows[0], files: files.rows };
}

export async function getPackageRequestFile(pool, requestId, fileId) {
  const { rows } = await pool.query(
    `select * from package_request_files where id = $1 and request_id = $2`,
    [fileId, requestId]
  );
  return rows[0] || null;
}

export const editInputSchema = z.object({
  status: z.enum(['new', 'contacted', 'closed', 'cancelled']).optional(),
  paid: z.preprocess(v => v === 'on' || v === true || v === 'true', z.boolean()).default(false),
  admin_notes: z.string().max(2000).optional().or(z.literal('')),
});

export async function updatePackageRequest(pool, id, input) {
  await pool.query(
    `update package_requests
        set status = coalesce($1, status),
            paid = $2,
            admin_notes = $3,
            updated_at = now()
      where id = $4`,
    [input.status || null, !!input.paid, input.admin_notes || null, id]
  );
}

export async function cancelPackageRequest(pool, id) {
  const { rowCount } = await pool.query(
    `update package_requests set status='cancelled', updated_at=now()
      where id=$1 and status <> 'cancelled'`,
    [id]
  );
  return rowCount > 0;
}

export async function hardDeletePackageRequest(pool, id) {
  const { rows } = await pool.query('select status from package_requests where id=$1', [id]);
  if (!rows[0]) { const e = new Error('Anfrage nicht gefunden.'); e.userMessage = e.message; throw e; }
  if (rows[0].status !== 'cancelled') {
    const e = new Error('Anfrage muss zuerst storniert werden.');
    e.userMessage = e.message;
    throw e;
  }
  // package_request_files has ON DELETE CASCADE
  await pool.query('delete from package_requests where id=$1', [id]);
}

function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/["\n,;]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function packageRequestsToCsv(rows) {
  const head = [
    'id', 'type', 'mit_vku', 'status', 'paid',
    'vname', 'nname', 'strasse', 'hnr', 'plz', 'ort',
    'geburt', 'email', 'telefon', 'standort_wunsch',
    'eingegangen',
  ];
  const lines = [head.join(';')];
  for (const r of rows) {
    lines.push([
      r.id, r.type, r.with_vku ? 'ja' : 'nein',
      r.status, r.paid ? 'ja' : 'nein',
      r.vname, r.nname, r.strasse, r.hnr, r.plz, r.ort,
      r.geburt && new Date(r.geburt).toISOString().slice(0, 10),
      r.email, r.telefon || '', r.location_pref || '',
      new Date(r.created_at).toISOString(),
    ].map(csvCell).join(';'));
  }
  return lines.join('\n');
}
