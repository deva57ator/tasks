const logger = require('../lib/logger');

function requestLogger(req, res, next) {
  const started = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - started;
    logger.info(`${req.method} ${req.originalUrl || req.url} ${res.statusCode} ${ms}ms`);
  });
  next();
}

module.exports = requestLogger;
