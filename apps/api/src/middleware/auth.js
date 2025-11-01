const { UnauthorizedError } = require('../lib/errors');
const authService = require('../services/auth');

function authMiddleware(req, res, next) {
  const sessionId = authService.parseSessionIdFromRequest(req);
  if (!sessionId) {
    return next(new UnauthorizedError('Authentication required'));
  }
  const session = authService.touchSession(sessionId);
  if (!session) {
    authService.clearSessionCookie(res);
    return next(new UnauthorizedError('Authentication required'));
  }
  authService.attachSessionCookie(res, session);
  req.user = { email: session.email };
  return next();
}

module.exports = authMiddleware;
