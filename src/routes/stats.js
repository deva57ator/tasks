const express = require('express');
const stats = require('../services/stats');

const router = express.Router();

router.get('/summary', async (req, res, next) => {
  try {
    const result = await stats.summary();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
