const config = require('../config');
const logger = require('../lib/logger');

const apiKey = config.apiKey;

if (!apiKey) {
  logger.error('TASKS_API_KEY is not set. All API endpoints except /api/health will be unauthorized.');
}

function authMiddleware(req, res, next) {
  if (req.method === 'OPTIONS') {
    return next();
  }

  const isHealthCheck = req.path === '/health'
    || req.path === '/api/health'
    || req.originalUrl === '/api/health'
    || req.originalUrl === '/health';

  if (isHealthCheck) {
    return next();
  }

  if (!apiKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const headerKey = req.get('X-API-Key');
  if (!headerKey || headerKey !== apiKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  return next();
}

module.exports = authMiddleware;
