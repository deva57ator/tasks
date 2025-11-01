const express = require('express');
const { z } = require('zod');
const archive = require('../services/archive');
const validate = require('../middleware/validate');

const paginationSchema = z.object({
  limit: z.coerce.number().int().min(0).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional()
});

const router = express.Router();

router.get('/', validate(paginationSchema, 'query'), async (req, res, next) => {
  try {
    const limit = req.query.limit;
    const offset = req.query.offset ?? 0;
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
