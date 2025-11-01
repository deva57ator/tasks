const http = require('node:http');
const config = require('./config');
const createApp = require('./app');
const logger = require('./lib/logger');

async function start() {
  const app = createApp();
  const server = http.createServer(app);
  server.on('error', (error) => {
    logger.error({ err: error }, 'HTTP server error');
  });

  server.listen(config.port, config.host, () => {
    logger.info({ host: config.host, port: config.port }, 'Server listening');
  });

  const shutdown = () => {
    logger.info('Shutting down server...');
    server.close((err) => {
      if (err) {
        logger.error({ err }, 'Error while closing HTTP server');
        process.exit(1);
      }
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start().catch((err) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});
