// Auth state model in session:
//   session.authStage:
//     undefined → not logged in
//     'awaiting_2fa' → password ok, waiting for TOTP/recovery code (max 5 min)
//     'authed' → fully authenticated
//   session.adminId, session.email
//   session.preAuthExpiresAt (when awaiting_2fa)

export async function loadAdmin(req) {
  if (!req.session?.adminId) return null;
  const { rows } = await req.server.pg.query(
    'select id, email, totp_secret, totp_enrolled_at, must_change_password, disabled_at from admins where id=$1',
    [req.session.adminId]
  );
  const a = rows[0];
  if (!a || a.disabled_at) return null;
  return a;
}

export function requirePreAuth(handler) {
  return async (req, reply) => {
    if (req.session?.authStage !== 'awaiting_2fa') {
      return reply.redirect('/admin/login');
    }
    if (req.session.preAuthExpiresAt && Date.now() > req.session.preAuthExpiresAt) {
      req.session.destroy?.();
      return reply.redirect('/admin/login?error=expired');
    }
    return handler(req, reply);
  };
}

export function requireAuth(handler) {
  return async (req, reply) => {
    if (req.session?.authStage !== 'authed') {
      return reply.redirect('/admin/login');
    }
    const admin = await loadAdmin(req);
    if (!admin) {
      req.session.destroy?.();
      return reply.redirect('/admin/login');
    }
    req.admin = admin;
    // Path-only (strip query string)
    const path = (req.url || '').split('?')[0];
    // Enforce: must change pw before anything else
    if (admin.must_change_password
        && path !== '/admin/profile'
        && path !== '/admin/profile/password'
        && path !== '/admin/logout') {
      return reply.redirect('/admin/profile?force=password');
    }
    // Enforce: must enrol 2FA (only after password change is done)
    if (!admin.must_change_password
        && !admin.totp_enrolled_at
        && !path.startsWith('/admin/setup-2fa')
        && path !== '/admin/logout') {
      return reply.redirect('/admin/setup-2fa');
    }
    return handler(req, reply);
  };
}
