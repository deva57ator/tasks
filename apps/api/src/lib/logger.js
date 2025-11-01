const pino = require('pino');
const config = require('../config');

const logger = pino({
  level: config.logLevel,
  redact: ['req.headers.authorization', 'req.headers.cookie'],
  base: { env: config.env, version: config.version }
});

module.exports = logger;
