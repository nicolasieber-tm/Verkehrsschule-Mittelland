import crypto from 'node:crypto';

export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

export function generateToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function setResetToken(pool, adminId) {
  const token = generateToken();
  const hash = hashToken(token);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
  await pool.query(
    'update admins set reset_token_hash=$1, reset_token_expires_at=$2 where id=$3',
    [hash, expiresAt, adminId]
  );
  return { token, expiresAt };
}

export async function findAdminByValidToken(pool, token) {
  if (!token || typeof token !== 'string') return null;
  const hash = hashToken(token);
  const { rows } = await pool.query(
    `select id, email
       from admins
      where reset_token_hash = $1
        and reset_token_expires_at > now()
        and disabled_at is null`,
    [hash]
  );
  return rows[0] || null;
}

export async function clearResetToken(pool, adminId) {
  await pool.query(
    'update admins set reset_token_hash=null, reset_token_expires_at=null where id=$1',
    [adminId]
  );
}
