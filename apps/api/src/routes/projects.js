const express = require('express');
const projects = require('../services/projects');
const { parseLimit, parseOffset } = require('../lib/pagination');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const limit = parseLimit(req.query.limit);
    const offset = parseOffset(req.query.offset);
    const result = await projects.list({ limit, offset });
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
    const created = await projects.create(req.body);
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const updated = await projects.update(req.params.id, req.body || {});
    if (!updated) {
      return res.status(404).json({ error: { code: 'not_found', message: 'Project not found' } });
    }
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await projects.remove(req.params.id);
    res.status(204).send('');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
