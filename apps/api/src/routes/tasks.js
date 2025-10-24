const express = require('express');
const tasks = require('../services/tasks');
const { parseLimit, parseOffset } = require('../lib/pagination');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const filters = {
      projectId: req.query.projectId || null,
      done: req.query.done,
      dueFrom: req.query.dueFrom,
      dueTo: req.query.dueTo
    };
    const limit = req.query.limit !== undefined ? parseLimit(req.query.limit) : undefined;
    const offset = parseOffset(req.query.offset);
    const result = await tasks.list(filters, { limit, offset });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    if (!req.body || !req.body.title) {
      return res.status(400).json({ error: { code: 'validation_error', message: 'title is required' } });
    }
    const created = await tasks.create(req.body);
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const updated = await tasks.update(req.params.id, req.body || {});
    if (!updated) {
      return res.status(404).json({ error: { code: 'not_found', message: 'Task not found' } });
    }
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await tasks.remove(req.params.id);
    res.status(204).send('');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
