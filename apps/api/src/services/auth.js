const { randomBytes, randomInt } = require('node:crypto');
const logger = require('../lib/logger');
const config = require('../config');

const loginCodes = new Map();
const sessions = new Map();

function cleanupExpired(now = Date.now()) {
  for (const [email, entry] of loginCodes.entries()) {
    if (!entry || entry.expiresAt <= now) {
      loginCodes.delete(email);
    }
  }
  for (const [sessionId, session] of sessions.entries()) {
    if (!session || session.expiresAt <= now) {
      sessions.delete(sessionId);
    }
  }
}

function generateCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function ensureAllowedEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized || normalized !== config.auth.allowedEmail) {
    return null;
  }
  return normalized;
}

function requestLoginCode(email) {
  cleanupExpired();
  const allowedEmail = ensureAllowedEmail(email);
  if (!allowedEmail) {
    return null;
  }
  const code = generateCode();
  const expiresAt = Date.now() + config.auth.codeTtlMs;
  loginCodes.set(allowedEmail, {
    code,
    expiresAt,
    attempts: 0
  });
  logger.info({ email: allowedEmail, expiresAt }, 'Auth code generated');
  return { email: allowedEmail, code, expiresAt };
}

function verifyLoginCode(email, code) {
  cleanupExpired();
  const allowedEmail = ensureAllowedEmail(email);
  if (!allowedEmail) {
    return null;
  }
  const entry = loginCodes.get(allowedEmail);
  if (!entry) {
    return null;
  }
  const normalizedCode = String(code || '').trim();
  if (!normalizedCode || normalizedCode !== entry.code) {
    entry.attempts += 1;
    if (entry.attempts >= config.auth.maxCodeAttempts) {
      loginCodes.delete(allowedEmail);
    }
    return null;
  }
  loginCodes.delete(allowedEmail);
  return createSession(allowedEmail);
}

function createSession(email) {
  const sessionId = randomBytes(32).toString('hex');
  const now = Date.now();
  const expiresAt = now + config.auth.sessionTtlMs;
  const session = {
    id: sessionId,
    email,
    createdAt: now,
    updatedAt: now,
    expiresAt
  };
  sessions.set(sessionId, session);
  return session;
}

function getSession(sessionId) {
  if (!sessionId) return null;
  cleanupExpired();
  const session = sessions.get(sessionId);
  if (!session) {
    return null;
  }
  if (session.expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    return null;
  }
  return session;
}

function touchSession(sessionId) {
  const session = getSession(sessionId);
  if (!session) {
    return null;
  }
  const now = Date.now();
  session.updatedAt = now;
  session.expiresAt = now + config.auth.sessionTtlMs;
  sessions.set(sessionId, session);
  return session;
}

function destroySession(sessionId) {
  if (!sessionId) return;
  sessions.delete(sessionId);
}

function parseSessionIdFromRequest(req) {
  const header = req.headers?.cookie;
  if (!header) {
    return null;
  }
  const cookieName = `${config.auth.sessionCookieName}=`;
  const cookies = header.split(';');
  for (const cookie of cookies) {
    const trimmed = cookie.trim();
    if (trimmed.startsWith(cookieName)) {
      return trimmed.slice(cookieName.length);
    }
  }
  return null;
}

function buildSessionCookie(session) {
  const ttlSeconds = Math.max(Math.floor(config.auth.sessionTtlMs / 1000), 1);
  const parts = [
    `${config.auth.sessionCookieName}=${session.id}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${ttlSeconds}`
  ];
  if (config.auth.sessionCookieSecure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

function buildClearCookie() {
  const parts = [
    `${config.auth.sessionCookieName}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT'
  ];
  if (config.auth.sessionCookieSecure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

function appendCookie(res, value) {
  if (!res) return;
  const current = res.getHeader('Set-Cookie');
  if (!current) {
    res.setHeader('Set-Cookie', value);
  } else if (Array.isArray(current)) {
    res.setHeader('Set-Cookie', [...current, value]);
  } else {
    res.setHeader('Set-Cookie', [current, value]);
  }
}

function attachSessionCookie(res, session) {
  if (!res || !session) return;
  appendCookie(res, buildSessionCookie(session));
}

function clearSessionCookie(res) {
  appendCookie(res, buildClearCookie());
}

module.exports = {
  requestLoginCode,
  verifyLoginCode,
  touchSession,
  getSession,
  destroySession,
  parseSessionIdFromRequest,
  attachSessionCookie,
  clearSessionCookie,
  ensureAllowedEmail
};
