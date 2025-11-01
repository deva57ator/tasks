const express = require('express');
const { z } = require('zod');
const tasks = require('../services/tasks');
const validate = require('../middleware/validate');
const { NotFoundError } = require('../lib/errors');

const listQuerySchema = z.object({
  projectId: z.string().trim().min(1).optional(),
  done: z.union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0')]).optional(),
  dueFrom: z.string().trim().min(1).optional(),
  dueTo: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(0).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional()
}).transform((value) => ({
  ...value,
  done: value.done === undefined ? undefined : (value.done === 'true' || value.done === '1')
}));

const taskPayloadSchema = z.object({
  id: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1, 'title is required'),
  done: z.boolean().optional(),
  due: z.string().trim().min(1).optional().nullable(),
  project: z.string().trim().min(1).optional().nullable(),
  notes: z.string().optional(),
  timeSpent: z.coerce.number().int().min(0).optional(),
  parentId: z.string().trim().min(1).optional().nullable(),
  completedAt: z.string().trim().min(1).optional(),
});

const taskUpdateSchema = taskPayloadSchema.partial().refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field must be provided'
});

const router = express.Router();

router.get('/', validate(listQuerySchema, 'query'), async (req, res, next) => {
  try {
    const filters = {
      projectId: req.query.projectId || null,
      done: req.query.done,
      dueFrom: req.query.dueFrom,
      dueTo: req.query.dueTo
    };
    const limit = req.query.limit;
    const offset = req.query.offset ?? 0;
    const result = await tasks.list(filters, { limit, offset });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/', validate(taskPayloadSchema), async (req, res, next) => {
  try {
    const created = await tasks.create(req.body);
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', validate(taskUpdateSchema), async (req, res, next) => {
  try {
    const updated = await tasks.update(req.params.id, req.body || {});
    if (!updated) {
      throw new NotFoundError('Task not found');
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
