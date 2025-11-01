const express = require('express');
const { z } = require('zod');
const workdays = require('../services/workdays');
const tasks = require('../services/tasks');
const archive = require('../services/archive');
const { nowIso } = require('../lib/time');
const validate = require('../middleware/validate');

const workdayPayloadSchema = z.object({
  workday: z.object({
    id: z.string().trim().min(1)
  }).passthrough()
});

const workdayCloseSchema = workdayPayloadSchema.extend({
  completedTaskIds: z.array(z.string().trim().min(1)).optional()
});

const router = express.Router();

router.get('/current', async (req, res, next) => {
  try {
    const current = await workdays.getCurrent();
    res.json({ workday: current });
  } catch (err) {
    next(err);
  }
});

router.post('/sync', validate(workdayPayloadSchema), async (req, res, next) => {
  try {
    const payload = req.body || {};
    const workdayRecord = await workdays.upsert({
      ...payload.workday,
      closedAt: payload.workday.closedAt || null
    });
    res.json({ workday: workdayRecord });
  } catch (err) {
    next(err);
  }
});

router.post('/close', validate(workdayCloseSchema), async (req, res, next) => {
  try {
    const payload = req.body || {};
    const closedAt = payload.workday.closedAt || nowIso();
    const workdayRecord = await workdays.upsert({
      ...payload.workday,
      closedAt
    });
    const archivedIds = Array.isArray(payload.completedTaskIds) ? payload.completedTaskIds : [];
    const archivedAt = nowIso();
    const archivedPayloads = [];
    const applyArchivedAt = (node) => ({
      ...node,
      archivedAt,
      children: Array.isArray(node.children) ? node.children.map(applyArchivedAt) : []
    });

    if (archivedIds.length) {
      const snapshot = await tasks.archiveAndRemove(archivedIds);
      for (const item of snapshot.payloads) {
        const normalized = applyArchivedAt(item);
        archivedPayloads.push(normalized);
        await archive.insert({ id: normalized.id, payload: normalized, archivedAt });
      }
    }
    res.json({ workday: workdayRecord, archived: archivedPayloads });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
