const http = require('node:http');
const config = require('./config');
const createApp = require('./app');
const logger = require('./lib/logger');

async function start() {
  const app = createApp();
  const server = http.createServer(app);
  server.listen(config.port, config.host, () => {
    logger.info(`Server listening on http://${config.host}:${config.port}`);
  });

  const shutdown = () => {
    logger.info('Shutting down server...');
    server.close(() => {
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start().catch((err) => {
  logger.error('Failed to start server', err);
  process.exit(1);
});
