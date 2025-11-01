const path = require('node:path');
const dotenv = require('dotenv');

dotenv.config();

const env = process.env.NODE_ENV || 'development';

const config = {
  env,
  port: parseInt(process.env.PORT || '4001', 10),
  host: process.env.HOST || '127.0.0.1',
  dbPath: path.resolve(process.cwd(), process.env.DB_PATH || './data/tasks.db'),
  dbBusyTimeoutMs: parseInt(process.env.DB_BUSY_TIMEOUT_MS || '5000', 10),
  apiKey: process.env.API_KEY || '',
  corsOrigin: process.env.CORS_ORIGIN || '',
  trustProxy: process.env.TRUST_PROXY === 'true',
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
    max: parseInt(process.env.RATE_LIMIT_MAX || '120', 10)
  },
  logLevel: process.env.LOG_LEVEL || (env === 'production' ? 'info' : 'debug'),
  requestTimeoutMs: parseInt(process.env.REQUEST_TIMEOUT_MS || '10000', 10),
  version: require('../../package.json').version
};

module.exports = config;
