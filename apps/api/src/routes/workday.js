const express = require('express');
const workdays = require('../services/workdays');

const router = express.Router();

router.get('/current', async (req, res, next) => {
  try {
    const [current, marker] = await Promise.all([
      workdays.getCurrent(),
      workdays.getLatestUpdateMarker()
    ]);
    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    const etagSource = marker || 'empty';
    const etagValue = marker
      ? `"${Buffer.from(String(etagSource)).toString('base64')}"`
      : '"empty"';
    res.set('ETag', etagValue);
    res.json({ workday: current });
  } catch (err) {
    next(err);
  }
});

router.post('/sync', async (req, res, next) => {
  try {
    const payload = req.body || {};
    if (!payload.workday || !payload.workday.id) {
      return res.status(400).json({ error: { code: 'validation_error', message: 'workday.id is required' } });
    }
    const workdayRecord = await workdays.upsert({
      ...payload.workday,
      closedAt: payload.workday.closedAt || null
    });
    res.json({ workday: workdayRecord });
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
    const current = await workdays.getById(payload.workday.id);
    if (current && current.closedAt !== null) {
      return res.json({ workday: current });
    }
    const closedAtSource = payload.workday.closedAt;
    const closedAt = Number.isFinite(Number(closedAtSource)) ? Number(closedAtSource) : Date.now();
    await workdays.upsert({
      ...payload.workday,
      closedAt: null
    });
    const workdayRecord = await workdays.closeById(payload.workday.id, closedAt);
    res.json({ workday: workdayRecord });
  } catch (err) {
    next(err);
  }
});

router.post('/reopen', async (req, res, next) => {
  try {
    const payload = req.body || {};
    if (!payload.workday || !payload.workday.id) {
      return res.status(400).json({ error: { code: 'validation_error', message: 'workday.id is required' } });
    }
    const workdayRecord = await workdays.reopen(payload.workday);
    if (!workdayRecord) {
      return res.status(404).json({ error: { code: 'not_found', message: 'Workday not found' } });
    }
    res.json({ workday: workdayRecord });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
