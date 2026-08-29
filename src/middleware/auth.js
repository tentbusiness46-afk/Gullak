const { verifyToken } = require('../utils/jwt');

// Each role's session lives in its own cookie, so an admin, agent and
// consumer user can all be logged in on the same browser at once
// without interfering with each other (matches the 3 separate
// frontends - /, /admin, /agent).
const COOKIE_NAMES = {
  admin: 'gullak_admin_token',
  agent: 'gullak_agent_token',
  user: 'gullak_user_token'
};

function requireRole(role) {
  return function (req, res, next) {
    const token = req.cookies[COOKIE_NAMES[role]];
    const payload = token ? verifyToken(token) : null;

    if (!payload || payload.role !== role) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    req.auth = payload; // { role, id/email, ... }
    next();
  };
}

module.exports = {
  COOKIE_NAMES,
  requireAdmin: requireRole('admin'),
  requireAgent: requireRole('agent'),
  requireUser: requireRole('user')
};
