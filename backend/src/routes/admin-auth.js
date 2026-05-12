import { z } from 'zod';
import {
  hashPassword, verifyPassword, verifyOrDummy,
  hashIp, recordLoginAttempt, recentFailures,
} from '../services/auth.js';
import { generateSecret, verifyToken, makeQrDataUrl } from '../services/totp.js';
import { generateCodes, hashCodes, findMatchingHash } from '../services/recovery.js';
import { requirePreAuth, requireAuth, loadAdmin } from '../middleware/auth.js';
import {
  setResetToken, findAdminByValidToken, clearResetToken,
} from '../services/password-reset.js';
import { sendPasswordResetMail } from '../services/mail.js';

const PRE_AUTH_TTL_MS = 5 * 60 * 1000;

function setPreAuth(req, admin) {
  req.session.authStage = 'awaiting_2fa';
  req.session.pendingAdminId = admin.id;
  req.session.preAuthExpiresAt = Date.now() + PRE_AUTH_TTL_MS;
}

async function regenerateSession(req) {
  // Session-Fixation-Schutz: neue Session-ID nach erfolgreichem Login
  return new Promise((resolve, reject) => {
    req.session.regenerate(err => err ? reject(err) : resolve());
  });
}

function csrf(reply) {
  return reply.generateCsrf();
}

export async function adminAuthRoutes(app) {

  // Rate limit on login (per IP + email)
  const loginLimiter = {
    rateLimit: {
      max: 10,
      timeWindow: '15 minutes',
      keyGenerator: (req) => `${req.ip}:${req.body?.email?.toLowerCase()?.trim() || 'anon'}`,
    },
  };
  const twofaLimiter = {
    rateLimit: { max: 10, timeWindow: '10 minutes' },
  };

  // ---- LOGIN ----
  app.get('/login', async (req, reply) => {
    if (req.session?.authStage === 'authed') return reply.redirect('/admin');
    if (req.session?.authStage === 'awaiting_2fa') return reply.redirect('/admin/login/2fa');
    const error = req.query.error === 'expired' ? 'Sitzung abgelaufen. Bitte erneut anmelden.' : null;
    return reply.view('login', { csrfToken: csrf(reply), error, info: null, email: '' });
  });

  app.post('/login', { config: loginLimiter }, async (req, reply) => {
    const schema = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });
    const parsed = schema.safeParse(req.body);
    const ipHash = hashIp(req.ip);

    if (!parsed.success) {
      await recordLoginAttempt(app.pg, { email: null, ipHash, success: false });
      return reply.view('login', { csrfToken: csrf(reply), error: 'Ungültige Eingabe.', info: null, email: req.body?.email || '' });
    }

    const email = parsed.data.email.trim().toLowerCase();
    const fails = await recentFailures(app.pg, { email, ipHash, windowMinutes: 15 });
    if (fails >= 10) {
      app.log.warn({ email, ipHash }, 'login rate-limit triggered');
      return reply.view('login', { csrfToken: csrf(reply), error: 'Zu viele Fehlversuche. Bitte später erneut probieren.', info: null, email });
    }

    const { rows } = await app.pg.query(
      'select id, email, password_hash, disabled_at from admins where email=$1',
      [email]
    );
    const admin = rows[0];
    const passOk = await verifyOrDummy(admin?.password_hash, parsed.data.password);
    const ok = passOk && admin && !admin.disabled_at;

    await recordLoginAttempt(app.pg, { email, ipHash, success: ok });

    if (!ok) {
      // generische Fehlermeldung — keine User-Enumeration
      return reply.view('login', { csrfToken: csrf(reply), error: 'Anmeldung fehlgeschlagen.', info: null, email });
    }

    setPreAuth(req, admin);
    return reply.redirect('/admin/login/2fa');
  });

  // ---- PASSWORD RESET ----
  const forgotLimiter = {
    rateLimit: {
      max: 3,
      timeWindow: '1 hour',
      keyGenerator: (req) => `${req.ip}:${req.body?.email?.toLowerCase()?.trim() || 'anon'}`,
    },
  };
  const resetLimiter = {
    rateLimit: { max: 10, timeWindow: '15 minutes' },
  };

  app.get('/forgot-password', async (req, reply) => {
    return reply.view('forgot-password', { csrfToken: csrf(reply), error: null, info: null, email: '' });
  });

  app.post('/forgot-password', { config: forgotLimiter }, async (req, reply) => {
    const schema = z.object({ email: z.string().email().max(200) });
    const parsed = schema.safeParse(req.body);

    const generic = () => reply.view('forgot-password', {
      csrfToken: csrf(reply),
      error: null,
      info: 'Falls ein Account mit dieser E-Mail-Adresse existiert, wurde ein Link zum Zurücksetzen verschickt. Prüfe dein Postfach (auch Spam).',
      email: '',
    });

    if (!parsed.success) {
      return reply.view('forgot-password', {
        csrfToken: csrf(reply),
        error: 'Bitte eine gültige E-Mail-Adresse eingeben.',
        info: null,
        email: req.body?.email || '',
      });
    }

    const email = parsed.data.email.trim().toLowerCase();
    const { rows } = await app.pg.query(
      'select id, email from admins where email=$1 and disabled_at is null',
      [email]
    );
    const admin = rows[0];

    if (admin) {
      try {
        const { token } = await setResetToken(app.pg, admin.id);
        const base = process.env.ADMIN_BASE_URL
          || `${req.protocol}://${req.headers.host}`;
        const resetUrl = `${base.replace(/\/$/, '')}/admin/reset-password?token=${encodeURIComponent(token)}`;
        await sendPasswordResetMail(admin.email, resetUrl, req.log);
      } catch (err) {
        req.log.error({ err: err.message, adminId: admin.id }, 'password reset flow failed');
        // Still respond generically — don't leak existence
      }
    } else {
      req.log.info({ email }, 'forgot-password: no matching admin');
    }

    return generic();
  });

  app.get('/reset-password', { config: resetLimiter }, async (req, reply) => {
    const token = String(req.query?.token || '');
    const admin = await findAdminByValidToken(app.pg, token);
    if (!admin) {
      return reply.view('reset-password', {
        csrfToken: csrf(reply),
        error: 'Dieser Link ist ungültig oder abgelaufen. Bitte fordere einen neuen an.',
        info: null,
        token: '',
      });
    }
    return reply.view('reset-password', { csrfToken: csrf(reply), error: null, info: null, token });
  });

  app.post('/reset-password', { config: resetLimiter }, async (req, reply) => {
    const schema = z.object({
      token: z.string().min(10).max(200),
      new: z.string().min(12).max(200),
      confirm: z.string().min(12).max(200),
    });
    const parsed = schema.safeParse(req.body);

    const renderErr = (msg, token = '') => reply.view('reset-password', {
      csrfToken: csrf(reply), error: msg, info: null, token,
    });

    if (!parsed.success) return renderErr('Ungültige Eingabe. Passwort muss mindestens 12 Zeichen lang sein.', req.body?.token || '');
    if (parsed.data.new !== parsed.data.confirm) return renderErr('Die Passwörter stimmen nicht überein.', parsed.data.token);

    const admin = await findAdminByValidToken(app.pg, parsed.data.token);
    if (!admin) {
      return reply.view('reset-password', {
        csrfToken: csrf(reply),
        error: 'Dieser Link ist ungültig oder abgelaufen. Bitte fordere einen neuen an.',
        info: null,
        token: '',
      });
    }

    const newHash = await hashPassword(parsed.data.new);
    await app.pg.query(
      `update admins
          set password_hash=$1,
              must_change_password=false,
              reset_token_hash=null,
              reset_token_expires_at=null
        where id=$2`,
      [newHash, admin.id]
    );
    // Invalidate all sessions of this admin (defence-in-depth)
    await app.pg.query(
      `delete from session where sess::jsonb -> 'adminId' = to_jsonb($1::int)`,
      [admin.id]
    ).catch(() => { /* best-effort */ });

    req.log.info({ adminId: admin.id }, 'password reset via token');
    return reply.view('forgot-password', {
      csrfToken: csrf(reply),
      error: null,
      info: 'Passwort wurde gesetzt. Du kannst dich jetzt mit dem neuen Passwort anmelden.',
      email: '',
    });
  });

  // ---- 2FA ----
  app.get('/login/2fa', requirePreAuth(async (req, reply) => {
    // If the admin hasn't enrolled TOTP yet, skip verification and go to setup
    const { rows } = await app.pg.query(
      'select id, email, totp_secret from admins where id=$1',
      [req.session.pendingAdminId]
    );
    const admin = rows[0];
    if (!admin) {
      req.session.destroy?.();
      return reply.redirect('/admin/login');
    }
    if (!admin.totp_secret) {
      await finalizeAuth(req, admin);
      return reply.redirect('/admin/setup-2fa');
    }
    return reply.view('login-2fa', { csrfToken: csrf(reply), error: null });
  }));

  app.post('/login/2fa', { config: twofaLimiter }, requirePreAuth(async (req, reply) => {
    const token = String(req.body?.token || '').trim();
    const adminId = req.session.pendingAdminId;
    const { rows } = await app.pg.query(
      'select id, email, totp_secret, recovery_codes_hash, must_change_password from admins where id=$1',
      [adminId]
    );
    const admin = rows[0];
    if (!admin) {
      req.session.destroy?.();
      return reply.redirect('/admin/login');
    }

    // If not enrolled yet → can't verify TOTP, redirect to setup
    if (!admin.totp_secret) {
      // Finalize pre-auth → auth (allow setup-2fa access)
      await finalizeAuth(req, admin);
      return reply.redirect('/admin/setup-2fa');
    }

    let ok = false;
    let usedRecoveryHash = null;
    if (/^\d{6}$/.test(token)) {
      ok = verifyToken(admin.totp_secret, token);
    } else if (/-/.test(token)) {
      usedRecoveryHash = await findMatchingHash(token, admin.recovery_codes_hash || []);
      ok = !!usedRecoveryHash;
    }

    if (!ok) {
      await recordLoginAttempt(app.pg, { email: admin.email, ipHash: hashIp(req.ip), success: false });
      return reply.view('login-2fa', { csrfToken: csrf(reply), error: 'Falscher Code.' });
    }

    if (usedRecoveryHash) {
      // Recovery-Code verbrauchen
      await app.pg.query(
        `update admins set recovery_codes_hash = array_remove(recovery_codes_hash, $1) where id=$2`,
        [usedRecoveryHash, admin.id]
      );
    }

    await finalizeAuth(req, admin);
    await app.pg.query('update admins set last_login_at = now() where id=$1', [admin.id]);
    return reply.redirect('/admin');
  }));

  async function finalizeAuth(req, admin) {
    await regenerateSession(req);
    req.session.authStage = 'authed';
    req.session.adminId = admin.id;
    req.session.email = admin.email;
  }

  // ---- 2FA SETUP (first login, after pre-auth promoted to authed) ----
  app.get('/setup-2fa', requireAuth(async (req, reply) => {
    if (req.admin.totp_enrolled_at) return reply.redirect('/admin/profile');
    // Generate-or-reuse pending secret in session for this setup attempt
    if (!req.session.pendingTotpSecret) {
      req.session.pendingTotpSecret = generateSecret();
    }
    const secret = req.session.pendingTotpSecret;
    const qrDataUrl = await makeQrDataUrl(req.admin.email, secret);
    return reply.view('setup-2fa', { csrfToken: csrf(reply), secret, qrDataUrl, error: null });
  }));

  app.post('/setup-2fa', requireAuth(async (req, reply) => {
    if (req.admin.totp_enrolled_at) return reply.redirect('/admin/profile');
    const submittedSecret = String(req.body?.secret || '');
    const sessionSecret = req.session.pendingTotpSecret;
    const token = String(req.body?.token || '').trim();

    if (!sessionSecret || submittedSecret !== sessionSecret) {
      return reply.redirect('/admin/setup-2fa');
    }

    if (!verifyToken(sessionSecret, token)) {
      const qrDataUrl = await makeQrDataUrl(req.admin.email, sessionSecret);
      return reply.view('setup-2fa', { csrfToken: csrf(reply), secret: sessionSecret, qrDataUrl, error: 'Falscher Code. Bitte erneut versuchen.' });
    }

    // Generate recovery codes, store hashes, set secret + enrolled_at
    const codes = generateCodes(8);
    const hashes = await hashCodes(codes);
    await app.pg.query(
      `update admins
          set totp_secret = $1,
              totp_enrolled_at = now(),
              recovery_codes_hash = $2
        where id = $3`,
      [sessionSecret, hashes, req.admin.id]
    );
    delete req.session.pendingTotpSecret;
    // Stash codes in session for one-time display
    req.session.pendingRecoveryCodes = codes;
    return reply.redirect('/admin/recovery-codes');
  }));

  // ---- Display recovery codes (one-time) ----
  app.get('/recovery-codes', requireAuth(async (req, reply) => {
    const codes = req.session.pendingRecoveryCodes;
    if (!codes) return reply.redirect('/admin');
    return reply.view('recovery-codes', { csrfToken: csrf(reply), codes });
  }));

  app.post('/recovery-codes/acknowledge', requireAuth(async (req, reply) => {
    delete req.session.pendingRecoveryCodes;
    return reply.redirect('/admin');
  }));

  // ---- LOGOUT ----
  app.post('/logout', async (req, reply) => {
    await new Promise(r => req.session.destroy(r));
    return reply.redirect('/admin/login');
  });

  // ---- PROFILE ----
  app.get('/profile', requireAuth(async (req, reply) => {
    return reply.view('profile', {
      csrfToken: csrf(reply),
      currentAdmin: req.admin,
      active: 'profile',
      error: null, success: null,
      force: req.query.force || null,
    });
  }));

  app.post('/profile/password', requireAuth(async (req, reply) => {
    const schema = z.object({
      current: z.string().min(1).max(200),
      new: z.string().min(12).max(200),
      confirm: z.string().min(12).max(200),
    });
    const parsed = schema.safeParse(req.body);

    const render = (msg, kind = 'error') => reply.view('profile', {
      csrfToken: csrf(reply), currentAdmin: req.admin, active: 'profile',
      error: kind === 'error' ? msg : null,
      success: kind === 'success' ? msg : null,
      force: req.admin.must_change_password ? 'password' : null,
    });

    if (!parsed.success) return render('Ungültige Eingabe.');
    if (parsed.data.new !== parsed.data.confirm) return render('Die neuen Passwörter stimmen nicht überein.');
    if (parsed.data.new === parsed.data.current) return render('Das neue Passwort muss sich vom alten unterscheiden.');

    const { rows } = await app.pg.query('select password_hash from admins where id=$1', [req.admin.id]);
    const ok = await verifyPassword(rows[0].password_hash, parsed.data.current);
    if (!ok) return render('Aktuelles Passwort falsch.');

    const newHash = await hashPassword(parsed.data.new);
    await app.pg.query(
      'update admins set password_hash=$1, must_change_password=false where id=$2',
      [newHash, req.admin.id]
    );
    // Force re-login for safety
    await new Promise(r => req.session.destroy(r));
    return reply.redirect('/admin/login?error=expired');
  }));

  app.post('/profile/2fa-reset', requireAuth(async (req, reply) => {
    await app.pg.query(
      'update admins set totp_secret=null, totp_enrolled_at=null, recovery_codes_hash=$1 where id=$2',
      [[], req.admin.id]
    );
    return reply.redirect('/admin/setup-2fa');
  }));

  app.post('/profile/recovery-codes', requireAuth(async (req, reply) => {
    if (!req.admin.totp_enrolled_at) return reply.redirect('/admin/profile');
    const codes = generateCodes(8);
    const hashes = await hashCodes(codes);
    await app.pg.query('update admins set recovery_codes_hash=$1 where id=$2', [hashes, req.admin.id]);
    req.session.pendingRecoveryCodes = codes;
    return reply.redirect('/admin/recovery-codes');
  }));
}
