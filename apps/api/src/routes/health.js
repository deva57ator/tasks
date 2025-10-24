const express = require('express');
const db = require('../db/client');
const config = require('../config');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const row = await db.get('SELECT schemaVersion FROM meta LIMIT 1');
    res.json({ status: 'ok', version: config.version, schemaVersion: row ? Number(row.schemaVersion) : null });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
