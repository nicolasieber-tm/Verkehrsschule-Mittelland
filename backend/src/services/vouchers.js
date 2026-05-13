import { z } from 'zod';
import { hashIp, BookingError } from './registrations.js';

const boolFromForm = z.preprocess(
  v => v === 'on' || v === true || v === 'true' || v === '1',
  z.boolean()
);

export const voucherOrderInputSchema = z.object({
  betrag_chf: z.coerce.number().int().min(1).max(100000),
  fuer: z.string().trim().min(1).max(100),
  von: z.string().trim().min(1).max(100),
  lvname: z.string().trim().max(100).optional().or(z.literal('')),
  lnname: z.string().trim().max(100).optional().or(z.literal('')),
  lstrasse: z.string().trim().max(200).optional().or(z.literal('')),
  lhnr: z.string().trim().max(20).optional().or(z.literal('')),
  lplz: z.string().trim().max(10).optional().or(z.literal('')),
  lort: z.string().trim().max(100).optional().or(z.literal('')),
  rvname: z.string().trim().min(1).max(100),
  rnname: z.string().trim().min(1).max(100),
  rstrasse: z.string().trim().min(1).max(200),
  rhnr: z.string().trim().min(1).max(20),
  rplz: z.string().trim().regex(/^\d{4,6}$/, 'Ungültige PLZ'),
  rort: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email().max(200),
  telefon: z.string().trim().max(50).optional().or(z.literal('')),
  consent_privacy: boolFromForm,
  consent_terms: boolFromForm,
  website: z.string().max(0).optional().or(z.literal('')),
  ts: z.coerce.number().int().optional(),
}).strict();

export async function createVoucherOrder(pool, data, { ip, userAgent }) {
  const { rows } = await pool.query(
    `insert into voucher_orders
       (betrag_chf, fuer, von,
        lvname, lnname, lstrasse, lhnr, lplz, lort,
        rvname, rnname, rstrasse, rhnr, rplz, rort,
        email, telefon,
        consent_privacy, consent_terms, submitted_ip_hash, user_agent)
     values ($1,$2,$3, $4,$5,$6,$7,$8,$9, $10,$11,$12,$13,$14,$15, $16,$17, $18,$19,$20,$21)
     returning id, created_at`,
    [
      data.betrag_chf, data.fuer, data.von,
      data.lvname || null, data.lnname || null, data.lstrasse || null,
      data.lhnr || null, data.lplz || null, data.lort || null,
      data.rvname, data.rnname, data.rstrasse, data.rhnr, data.rplz, data.rort,
      data.email, data.telefon || null,
      data.consent_privacy, data.consent_terms,
      hashIp(ip), (userAgent || '').slice(0, 500),
    ]
  );
  return { orderId: rows[0].id };
}

export function hasSeparateShipping(o) {
  return !!(o.lvname || o.lnname || o.lstrasse || o.lplz || o.lort);
}

export function shippingAddress(o) {
  if (hasSeparateShipping(o)) {
    return {
      vname: o.lvname || o.rvname,
      nname: o.lnname || o.rnname,
      strasse: o.lstrasse || o.rstrasse,
      hnr: o.lhnr || o.rhnr,
      plz: o.lplz || o.rplz,
      ort: o.lort || o.rort,
    };
  }
  return {
    vname: o.rvname, nname: o.rnname,
    strasse: o.rstrasse, hnr: o.rhnr,
    plz: o.rplz, ort: o.rort,
  };
}

export { BookingError };
