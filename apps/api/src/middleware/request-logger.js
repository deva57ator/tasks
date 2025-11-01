const pinoHttp = require('pino-http');
const logger = require('../lib/logger');
const config = require('../config');

const healthPath = `${config.basePath || ''}/health`;

function isHealthRequest(url = '') {
  if (!url) {
    return false;
  }
  return url === healthPath || url.startsWith(`${healthPath}?`) || url.startsWith(`${healthPath}/`);
}

const requestLogger = pinoHttp({
  logger,
  autoLogging: {
    ignore: (req) => isHealthRequest(req.url)
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
