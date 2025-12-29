const express = require('express');
const requestLogger = require('./middleware/request-logger');
const errorHandler = require('./middleware/error');
const auth = require('./middleware/auth');
const cors = require('./middleware/cors');

const healthRouter = require('./routes/health');
const projectsRouter = require('./routes/projects');
const tasksRouter = require('./routes/tasks');
const archiveRouter = require('./routes/archive');
const workdayRouter = require('./routes/workday');
const importRouter = require('./routes/import');
const statsRouter = require('./routes/stats');
const yearplanRouter = require('./routes/yearplan');

function createApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(requestLogger);
  app.use(cors);

  app.use('/api/health', healthRouter);

  app.use('/api', auth);

  app.use('/api/projects', projectsRouter);
  app.use('/api/tasks', tasksRouter);
  app.use('/api/archive', archiveRouter);
  app.use('/api/workday', workdayRouter);
  app.use('/api/import', importRouter);
  app.use('/api/stats', statsRouter);
  app.use('/api/yearplan', yearplanRouter);

  app.use(errorHandler);

  return app;
}

module.exports = createApp;
