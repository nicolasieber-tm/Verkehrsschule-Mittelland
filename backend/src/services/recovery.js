import crypto from 'node:crypto';
import argon2 from 'argon2';

// Generate N recovery codes in format XXXX-XXXX-XXXX (12 chars from [A-Z2-9], no confusing 0/O/I/1)
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 chars
function randomCode() {
  const bytes = crypto.randomBytes(12);
  let s = '';
  for (let i = 0; i < 12; i++) s += ALPHABET[bytes[i] % 32];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}
export function generateCodes(n = 8) {
  return Array.from({ length: n }, () => randomCode());
}

export async function hashCodes(codes) {
  return Promise.all(codes.map(c => argon2.hash(c, { type: argon2.argon2id, memoryCost: 64 * 1024, timeCost: 3, parallelism: 4 })));
}

// Try to find one matching hash. Returns the matched hash (so caller can remove it) or null.
export async function findMatchingHash(input, hashes) {
  const clean = String(input || '').trim().toUpperCase();
  if (!/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(clean)) return null;
  for (const h of hashes) {
    try {
      if (await argon2.verify(h, clean)) return h;
    } catch { /* ignore */ }
  }
  return null;
}
