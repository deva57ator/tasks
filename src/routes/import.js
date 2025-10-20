const express = require('express');
const importer = require('../services/importer');

const router = express.Router();

router.post('/', async (req, res, next) => {
  try {
    const payload = req.body || {};
    await importer.importData(payload);
    res.status(202).json({ status: 'accepted' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
