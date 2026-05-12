import { z } from 'zod';
import { hashIp, BookingError } from './registrations.js';

// Mime types accepted for Lernfahrausweis upload
export const ALLOWED_FILE_MIME = ['application/pdf', 'image/jpeg', 'image/png'];
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

const boolFromForm = z.preprocess(
  v => v === 'on' || v === true || v === 'true' || v === '1',
  z.boolean()
);

export const packageRequestInputSchema = z.object({
  type: z.enum(['fahrstunden_10', 'starterbox']),
  with_vku: boolFromForm.default(false),
  vname: z.string().trim().min(1).max(100),
  nname: z.string().trim().min(1).max(100),
  strasse: z.string().trim().min(1).max(200),
  hnr: z.string().trim().min(1).max(20),
  plz: z.string().trim().regex(/^\d{4,6}$/, 'Ungültige PLZ'),
  ort: z.string().trim().min(1).max(100),
  geburt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Geburtsdatum als YYYY-MM-DD'),
  email: z.string().trim().toLowerCase().email().max(200),
  telefon: z.string().trim().max(50).optional().or(z.literal('')),
  location_pref: z.string().trim().max(100).optional().or(z.literal('')),
  notes: z.string().trim().max(2000).optional().or(z.literal('')),
  consent_privacy: boolFromForm,
  consent_terms: boolFromForm,
  website: z.string().max(0).optional().or(z.literal('')),
  ts: z.coerce.number().int().optional(),
}).strict();

// Magic-byte check: validates file header matches the declared mime type.
// Header-level check only — sufficient for typical misuse; not anti-forensic.
export function isValidMagic(buf, mime) {
  if (!Buffer.isBuffer(buf) || buf.length < 4) return false;
  if (mime === 'application/pdf') {
    return buf.slice(0, 4).toString('ascii') === '%PDF';
  }
  if (mime === 'image/png') {
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (buf.length < 8) return false;
    for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) return false;
    return true;
  }
  if (mime === 'image/jpeg') {
    return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  }
  return false;
}

export function typeLabel(t) {
  return {
    fahrstunden_10: '10er Fahrstunden-Paket',
    starterbox: 'Starter-Box',
  }[t] || t;
}

/**
 * Inserts a package_request and (optionally) one package_request_files row
 * in a single transaction. Returns the new request id.
 */
export async function createPackageRequest(pool, data, { ip, userAgent, file }) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const ins = await client.query(
      `insert into package_requests
         (type, with_vku, vname, nname, strasse, hnr, plz, ort, geburt,
          email, telefon, location_pref, notes,
          consent_privacy, consent_terms, submitted_ip_hash, user_agent)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       returning id, created_at`,
      [
        data.type, data.with_vku, data.vname, data.nname, data.strasse, data.hnr,
        data.plz, data.ort, data.geburt,
        data.email, data.telefon || null,
        data.location_pref || null, data.notes || null,
        data.consent_privacy, data.consent_terms,
        hashIp(ip), (userAgent || '').slice(0, 500),
      ]
    );
    const requestId = ins.rows[0].id;

    if (file && file.buf && file.meta) {
      await client.query(
        `insert into package_request_files
           (request_id, kind, filename, mime_type, size_bytes, data)
         values ($1,$2,$3,$4,$5,$6)`,
        [requestId, 'lernfahrausweis',
         (file.meta.filename || 'upload').slice(0, 200),
         file.meta.mime_type,
         file.meta.size_bytes,
         file.buf]
      );
    }

    await client.query('commit');
    return { requestId };
  } catch (err) {
    try { await client.query('rollback'); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

export { BookingError };
