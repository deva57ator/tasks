const pinoHttp = require('pino-http');
const logger = require('../lib/logger');

const requestLogger = pinoHttp({
  logger,
  autoLogging: {
    ignore: (req) => req.url.includes('/api/health')
  },
  customSuccessMessage: function () {
    return 'request completed';
  },
  customErrorMessage: function () {
    return 'request failed';
  },
  customLogLevel: function (req, res, err) {
    if (res.statusCode >= 500 || err) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  }
});

module.exports = requestLogger;
