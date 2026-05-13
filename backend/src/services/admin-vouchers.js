// Admin-side voucher_orders operations
import { z } from 'zod';

export async function listVoucherOrders(pool, { status } = {}) {
  const params = [];
  let where = '';
  if (status) { params.push(status); where = `where status = $${params.length}`; }
  const { rows } = await pool.query(
    `select id, betrag_chf, fuer, von, rvname, rnname, email, telefon,
            status, paid, shipped_at,
            customer_mail_status, school_mail_status,
            created_at, updated_at
       from voucher_orders
       ${where}
       order by created_at desc`,
    params
  );
  return rows;
}

export async function getVoucherOrder(pool, id) {
  const { rows } = await pool.query(
    `select * from voucher_orders where id = $1`, [id]
  );
  return rows[0] || null;
}

export const editInputSchema = z.object({
  status: z.enum(['new', 'contacted', 'shipped', 'closed', 'cancelled']).optional(),
  paid: z.preprocess(v => v === 'on' || v === true || v === 'true', z.boolean()).default(false),
  admin_notes: z.string().max(2000).optional().or(z.literal('')),
});

export async function updateVoucherOrder(pool, id, input) {
  // When status transitions to 'shipped', stamp shipped_at if not set.
  await pool.query(
    `update voucher_orders
        set status = coalesce($1, status),
            paid = $2,
            admin_notes = $3,
            shipped_at = case
              when $1 = 'shipped' and shipped_at is null then now()
              else shipped_at
            end,
            updated_at = now()
      where id = $4`,
    [input.status || null, !!input.paid, input.admin_notes || null, id]
  );
}

export async function cancelVoucherOrder(pool, id) {
  const { rowCount } = await pool.query(
    `update voucher_orders set status='cancelled', updated_at=now()
      where id=$1 and status <> 'cancelled'`,
    [id]
  );
  return rowCount > 0;
}

export async function hardDeleteVoucherOrder(pool, id) {
  const { rows } = await pool.query('select status from voucher_orders where id=$1', [id]);
  if (!rows[0]) { const e = new Error('Bestellung nicht gefunden.'); e.userMessage = e.message; throw e; }
  if (rows[0].status !== 'cancelled') {
    const e = new Error('Bestellung muss zuerst storniert werden.');
    e.userMessage = e.message;
    throw e;
  }
  await pool.query('delete from voucher_orders where id=$1', [id]);
}

function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/["\n,;]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function voucherOrdersToCsv(rows) {
  const head = [
    'id', 'betrag_chf', 'status', 'paid', 'shipped_at',
    'fuer', 'von',
    'rvname', 'rnname', 'rstrasse', 'rhnr', 'rplz', 'rort',
    'lvname', 'lnname', 'lstrasse', 'lhnr', 'lplz', 'lort',
    'email', 'telefon', 'eingegangen',
  ];
  const lines = [head.join(';')];
  for (const r of rows) {
    lines.push([
      r.id, r.betrag_chf, r.status, r.paid ? 'ja' : 'nein',
      r.shipped_at ? new Date(r.shipped_at).toISOString() : '',
      r.fuer, r.von,
      r.rvname, r.rnname, r.rstrasse, r.rhnr, r.rplz, r.rort,
      r.lvname || '', r.lnname || '', r.lstrasse || '', r.lhnr || '', r.lplz || '', r.lort || '',
      r.email, r.telefon || '',
      new Date(r.created_at).toISOString(),
    ].map(csvCell).join(';'));
  }
  return lines.join('\n');
}
