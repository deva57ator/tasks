const express = require('express');
const db = require('../db/client');
const config = require('../config');
const logger = require('../lib/logger');
const workdays = require('../services/workdays');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const [row, backlogOpenDays] = await Promise.all([
      db.get('SELECT schemaVersion FROM meta LIMIT 1'),
      workdays.countBacklogOpenDays()
    ]);
    logger.info('health.metrics', { backlogOpenDays });
    res.json({
      status: 'ok',
      version: config.version,
      schemaVersion: row ? Number(row.schemaVersion) : null,
      backlogOpenDays
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
