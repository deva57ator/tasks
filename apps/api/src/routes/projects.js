const express = require('express');
const { z } = require('zod');
const projects = require('../services/projects');
const validate = require('../middleware/validate');
const { NotFoundError } = require('../lib/errors');

const paginationSchema = z.object({
  limit: z.coerce.number().int().min(0).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional()
});

const projectPayloadSchema = z.object({
  title: z.string().trim().min(1, 'title is required'),
  emoji: z.string().trim().max(4).optional().nullable()
});

const projectUpdateSchema = projectPayloadSchema.partial().refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field must be provided'
});

const router = express.Router();

router.get('/', validate(paginationSchema, 'query'), async (req, res, next) => {
  try {
    const limit = req.query.limit;
    const offset = req.query.offset ?? 0;
    const result = await projects.list({ limit, offset });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/', validate(projectPayloadSchema), async (req, res, next) => {
  try {
    const created = await projects.create(req.body);
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', validate(projectUpdateSchema), async (req, res, next) => {
  try {
    const updated = await projects.update(req.params.id, req.body || {});
    if (!updated) {
      throw new NotFoundError('Project not found');
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
