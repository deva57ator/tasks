const logger = require('../lib/logger');

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const status = err.status || err.statusCode || 500;
  const code = err.code || (status === 404 ? 'not_found' : 'internal_error');
  const message = err.expose ? err.message : (status === 500 ? 'Internal Server Error' : err.message || 'Error');
  logger.error(`Request failed ${req.method} ${req.originalUrl || req.url}`, err);
  res.status(status).json({ error: { code, message } });
}

module.exports = errorHandler;
