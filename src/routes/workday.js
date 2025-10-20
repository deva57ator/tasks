const express = require('express');
const workdays = require('../services/workdays');
const tasks = require('../services/tasks');
const archive = require('../services/archive');
const { nowIso } = require('../lib/time');

const router = express.Router();

router.get('/current', async (req, res, next) => {
  try {
    const current = await workdays.getCurrent();
    res.json({ workday: current });
  } catch (err) {
    next(err);
  }
});

router.post('/close', async (req, res, next) => {
  try {
    const payload = req.body || {};
    if (!payload.workday || !payload.workday.id) {
      return res.status(400).json({ error: { code: 'validation_error', message: 'workday.id is required' } });
    }
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
