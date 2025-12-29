const express = require('express');
const yearplan = require('../services/yearplan');

const router = express.Router();

function parseYear(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num)) return null;
  return num;
}

function parseId(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num)) return null;
  return num;
}

router.get('/', async (req, res, next) => {
  try {
    const year = parseYear(req.query.year);
    if (year === null) {
      return res.status(400).json({ error: { code: 'validation_error', message: 'year is required' } });
    }
    const activities = await yearplan.listByYear(year);
    res.json(activities);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const created = await yearplan.create(req.body || {});
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: { code: 'validation_error', message: 'id is invalid' } });
    }
    const updated = await yearplan.update(id, req.body || {});
    if (!updated) {
      return res.status(404).json({ error: { code: 'not_found', message: 'Activity not found' } });
    }
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: { code: 'validation_error', message: 'id is invalid' } });
    }
    const deleted = await yearplan.remove(id);
    if (!deleted) {
      return res.status(404).json({ error: { code: 'not_found', message: 'Activity not found' } });
    }
    res.status(204).send('');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
