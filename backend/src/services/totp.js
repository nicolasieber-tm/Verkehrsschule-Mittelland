import { authenticator } from 'otplib';
import qrcode from 'qrcode';

authenticator.options = { window: 1 }; // ±30s tolerance

export function generateSecret() {
  return authenticator.generateSecret();
}

export function verifyToken(secret, token) {
  if (!secret || !token) return false;
  const clean = String(token).replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return false;
  try {
    return authenticator.verify({ token: clean, secret });
  } catch {
    return false;
  }
}

export async function makeQrDataUrl(email, secret) {
  const issuer = process.env.TOTP_ISSUER || 'Verkehrsschule Mittelland';
  const otpauth = authenticator.keyuri(email, issuer, secret);
  return qrcode.toDataURL(otpauth, { errorCorrectionLevel: 'M', margin: 1, width: 240 });
}
