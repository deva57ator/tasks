const config = require('../config');
const { UnauthorizedError, ConfigError } = require('../lib/errors');

function authMiddleware(req, _res, next) {
  if (!config.apiKey) {
    return next(new ConfigError('API key is not configured'));
  }
  const headerKey = req.headers['x-api-key'];
  if (!headerKey || headerKey !== config.apiKey) {
    return next(new UnauthorizedError('Invalid API key'));
  }
  return next();
}

module.exports = authMiddleware;
