const config = require('../config');

function authMiddleware(req, res, next) {
  if (!config.apiKey) {
    return res.status(500).json({ error: { code: 'config_error', message: 'API key is not configured' } });
  }
  const headerKey = req.headers['x-api-key'];
  if (!headerKey || headerKey !== config.apiKey) {
    return res.status(401).json({ error: { code: 'unauthorized', message: 'Invalid API key' } });
  }
  return next();
}

module.exports = authMiddleware;
