const logger = require('../lib/logger');
const { AppError } = require('../lib/errors');

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const isAppError = err instanceof AppError;
  const status = isAppError ? err.status : (err.status || err.statusCode || 500);
  const code = isAppError ? err.code : (err.code || (status === 404 ? 'not_found' : 'internal_error'));
  const expose = isAppError ? err.expose : status < 500;
  const message = expose ? err.message : 'Internal Server Error';
  const payload = { error: { code, message } };

  if (isAppError && err.details) {
    payload.error.details = err.details;
  }

  logger.error({ err, status, code, url: req.originalUrl || req.url }, 'Request failed');
  res.status(status).json(payload);
}

module.exports = errorHandler;
