const express = require('express');
const archive = require('../services/archive');
const { parseLimit, parseOffset } = require('../lib/pagination');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const limit = parseLimit(req.query.limit);
    const offset = parseOffset(req.query.offset);
    const result = await archive.list({ limit, offset });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await archive.remove(req.params.id);
    res.status(204).send('');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
