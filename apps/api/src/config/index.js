const path = require('node:path');
const dotenv = require('dotenv');

dotenv.config();

const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '4001', 10),
  host: process.env.HOST || '127.0.0.1',
  dbPath: path.resolve(process.cwd(), process.env.DB_PATH || './data/tasks.db'),
  apiKey: process.env.API_KEY || '',
  corsOrigin: process.env.CORS_ORIGIN || '',
  version: require('../../package.json').version
};

module.exports = config;
