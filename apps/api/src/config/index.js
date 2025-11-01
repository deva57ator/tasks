const path = require('node:path');
const dotenv = require('dotenv');

dotenv.config();

const env = process.env.NODE_ENV || 'development';

const parsedMaxCodeAttempts = parseInt(process.env.AUTH_CODE_MAX_ATTEMPTS || '5', 10);

function normalizeBasePath(rawBasePath) {
  if (!rawBasePath || rawBasePath.trim() === '') {
    return '/api';
  }

  let normalized = rawBasePath.trim();
  if (!normalized.startsWith('/')) {
    normalized = `/${normalized}`;
  }

  // Trim trailing slashes while keeping the root path intact.
  normalized = normalized.replace(/\/+$/u, '');
  if (normalized === '') {
    return '';
  }

  return normalized;
}

const config = {
  env,
  port: parseInt(process.env.PORT || '4001', 10),
  host: process.env.HOST || '127.0.0.1',
  dbPath: path.resolve(process.cwd(), process.env.DB_PATH || './data/tasks.db'),
  dbBusyTimeoutMs: parseInt(process.env.DB_BUSY_TIMEOUT_MS || '5000', 10),
  corsOrigin: process.env.CORS_ORIGIN || '',
  trustProxy: process.env.TRUST_PROXY === 'true',
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
    max: parseInt(process.env.RATE_LIMIT_MAX || '120', 10)
  },
  logLevel: process.env.LOG_LEVEL || (env === 'production' ? 'info' : 'debug'),
  requestTimeoutMs: parseInt(process.env.REQUEST_TIMEOUT_MS || '10000', 10),
  basePath: normalizeBasePath(process.env.BASE_PATH),
  auth: {
    allowedEmail: (process.env.AUTH_ALLOWED_EMAIL || 'deva57ator@gmail.com').trim().toLowerCase(),
    codeTtlMs: parseInt(process.env.AUTH_CODE_TTL_MS || '300000', 10),
    maxCodeAttempts: Number.isFinite(parsedMaxCodeAttempts) && parsedMaxCodeAttempts > 0 ? parsedMaxCodeAttempts : 5,
    sessionTtlMs: parseInt(process.env.AUTH_SESSION_TTL_MS || '900000', 10),
    sessionCookieName: process.env.AUTH_SESSION_COOKIE_NAME || 'tasks_session',
    sessionCookieSecure: process.env.AUTH_SESSION_COOKIE_SECURE === 'true' || env === 'production'
  },
  version: require('../../package.json').version
};

module.exports = config;
