const express = require('express');
const helmet = require('helmet');
const requestLogger = require('./middleware/request-logger');
const rateLimit = require('./middleware/rate-limit');
const errorHandler = require('./middleware/error');
const auth = require('./middleware/auth');
const cors = require('./middleware/cors');
const config = require('./config');

const healthRouter = require('./routes/health');
const authRouter = require('./routes/auth');
const projectsRouter = require('./routes/projects');
const tasksRouter = require('./routes/tasks');
const archiveRouter = require('./routes/archive');
const workdayRouter = require('./routes/workday');
const importRouter = require('./routes/import');
const statsRouter = require('./routes/stats');

function createApp() {
  const app = express();
  const basePath = config.basePath;
  const withBasePath = (route) => `${basePath}${route}`;
  if (config.trustProxy) {
    app.set('trust proxy', 1);
  }
  app.use(express.json({ limit: '1mb' }));
  app.use((req, res, next) => {
    res.setTimeout(config.requestTimeoutMs, () => {
      if (!req.destroyed) {
        req.destroy(new Error('Request timeout'));
      }
    });
    req.on('error', next);
    next();
  });
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  }));
  app.use(requestLogger);
  app.use(cors);
  app.use(rateLimit);

  app.use(withBasePath('/health'), healthRouter);
  app.use(withBasePath('/auth'), authRouter);

  app.use(auth);

  app.use(withBasePath('/projects'), projectsRouter);
  app.use(withBasePath('/tasks'), tasksRouter);
  app.use(withBasePath('/archive'), archiveRouter);
  app.use(withBasePath('/workday'), workdayRouter);
  app.use(withBasePath('/import'), importRouter);
  app.use(withBasePath('/stats'), statsRouter);

  app.use(errorHandler);

  return app;
}

module.exports = createApp;
