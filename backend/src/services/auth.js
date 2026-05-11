import argon2 from 'argon2';
import crypto from 'node:crypto';

const argonOpts = {
  type: argon2.argon2id,
  memoryCost: 64 * 1024,
  timeCost: 3,
  parallelism: 4,
};

// Pre-computed dummy hash for timing-constant verification when user doesn't exist.
// Hash of a random unguessable string — argon2.verify against this always fails
// but spends the same CPU time as a real verification.
const DUMMY_HASH = await argon2.hash(crypto.randomBytes(32).toString('hex'), argonOpts);

export async function hashPassword(pw) {
  return argon2.hash(pw, argonOpts);
}

export async function verifyPassword(hash, pw) {
  return argon2.verify(hash, pw);
}

// Always spends ~argon2 time, even if user doesn't exist
export async function verifyOrDummy(maybeHash, pw) {
  const target = maybeHash || DUMMY_HASH;
  try {
    return await argon2.verify(target, pw);
  } catch {
    return false;
  }
}

export function hashIp(ip) {
  if (!ip) return null;
  return crypto.createHash('sha256').update(ip + (process.env.SESSION_SECRET || '')).digest('hex').slice(0, 32);
}

export async function recordLoginAttempt(pool, { email, ipHash, success }) {
  await pool.query(
    'insert into login_attempts (email, ip_hash, success) values ($1,$2,$3)',
    [email || null, ipHash || null, success]
  );
}

// returns number of failed attempts in last `windowMinutes` for email OR ip
export async function recentFailures(pool, { email, ipHash, windowMinutes = 15 }) {
  const { rows } = await pool.query(
    `select count(*)::int as n from login_attempts
      where success = false
        and created_at > now() - ($1 || ' minutes')::interval
        and (email = $2 or ip_hash = $3)`,
    [windowMinutes, email || null, ipHash || null]
  );
  return rows[0].n;
}
