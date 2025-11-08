const db = require('../db/client');
const { nowIso } = require('../lib/time');
const logger = require('../lib/logger');

function coerceNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function coerceNonNegative(value) {
  const num = coerceNumber(value);
  return num < 0 ? 0 : num;
}

function parsePayload(raw) {
  if (!raw) return null;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (err) {
    return null;
  }
}

function mapWorkdayRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    startTs: row.startTs !== undefined && row.startTs !== null ? row.startTs : null,
    endTs: row.endTs !== undefined && row.endTs !== null ? row.endTs : null,
    summaryTimeMs: coerceNonNegative(row.summaryTimeMs),
    summaryDone: Math.max(0, Math.round(coerceNumber(row.summaryDone))),
    payload: parsePayload(row.payload),
    closedAt: row.closedAt !== undefined && row.closedAt !== null ? row.closedAt : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function extractManualStats(payload) {
  if (!payload || typeof payload !== 'object') {
    return { timeMs: 0, doneCount: 0 };
  }
  const stats = payload.manualClosedStats;
  const timeMs = stats && typeof stats === 'object' ? coerceNonNegative(stats.timeMs) : 0;
  const doneCountRaw = stats && typeof stats === 'object' ? coerceNumber(stats.doneCount) : 0;
  const doneCount = doneCountRaw < 0 ? 0 : Math.round(doneCountRaw);
  return { timeMs, doneCount };
}

async function computeWorkdayDelta(payload) {
  if (!payload || typeof payload !== 'object') {
    return { timeMs: 0, doneCount: 0 };
  }

  const baseline = payload.baseline && typeof payload.baseline === 'object' ? payload.baseline : {};
  const completed = payload.completed && typeof payload.completed === 'object' ? payload.completed : {};
  const needsTasks = Object.keys(baseline).length > 0 || Object.keys(completed).length > 0;
  if (!needsTasks) {
    return { timeMs: 0, doneCount: 0 };
  }

  const rows = await db.all('SELECT id, timeSpentMs, done FROM tasks');
  const taskMap = new Map();
  for (const row of rows) {
    taskMap.set(row.id, {
      timeSpent: coerceNonNegative(row.timeSpentMs),
      done: row.done === 1
    });
  }

  let deltaTime = 0;
  for (const [taskId, baseValue] of Object.entries(baseline)) {
    const task = taskMap.get(taskId);
    if (!task) continue;
    const base = coerceNonNegative(baseValue);
    if (task.timeSpent > base) {
      deltaTime += task.timeSpent - base;
    }
  }

  let deltaDone = 0;
  for (const taskId of Object.keys(completed)) {
    const task = taskMap.get(taskId);
    if (task && task.done) {
      deltaDone += 1;
    }
  }

  return { timeMs: deltaTime, doneCount: deltaDone };
}

async function hydrateWorkday(row) {
  const mapped = mapWorkdayRow(row);
  if (!mapped) return null;

  const payload = mapped.payload;
  if (!payload) {
    return mapped;
  }

  const manual = extractManualStats(payload);
  let summaryTimeMs = manual.timeMs;
  let summaryDone = manual.doneCount;

  let includeDelta = payload.closedManually !== true;
  if (includeDelta) {
    const closedAtTs = Number.isFinite(Number(mapped.closedAt)) ? Number(mapped.closedAt) : null;
    const endTs = Number.isFinite(Number(mapped.endTs)) ? Number(mapped.endTs) : null;
    if (closedAtTs !== null && (endTs === null || closedAtTs >= endTs)) {
      includeDelta = false;
    }
  }

  if (includeDelta) {
    const delta = await computeWorkdayDelta(payload);
    summaryTimeMs += delta.timeMs;
    summaryDone += delta.doneCount;
  }

  mapped.summaryTimeMs = Math.max(mapped.summaryTimeMs, summaryTimeMs);
  mapped.summaryDone = Math.max(mapped.summaryDone, summaryDone);
  return mapped;
}

async function finalizeWorkdayRow(row, closedAtValue) {
  const hydrated = await hydrateWorkday(row);
  if (!hydrated) return;

  const finalTime = Math.max(0, Math.round(coerceNumber(hydrated.summaryTimeMs)) || 0);
  const finalDone = Math.max(0, Math.round(coerceNumber(hydrated.summaryDone)) || 0);
  const timestamp = nowIso();

  let payload = null;
  if (hydrated.payload && typeof hydrated.payload === 'object') {
    const basePayload = hydrated.payload;
    const manualStats = {
      timeMs: finalTime,
      doneCount: finalDone
    };

    payload = {
      ...basePayload,
      manualClosedStats: manualStats,
      finalTimeMs: finalTime,
      finalDoneCount: finalDone,
      closedManually: basePayload.closedManually === true,
      locked: true,
      closedAt: closedAtValue
    };
    if (payload.closedManually !== true) {
      payload.closedManually = false;
    }
  }

  await db.run(
    'UPDATE workdays SET summaryTimeMs = ?, summaryDone = ?, payload = ?, closedAt = ?, updatedAt = ? WHERE id = ?',
    [
      finalTime,
      finalDone,
      payload ? JSON.stringify(payload) : null,
      closedAtValue,
      timestamp,
      row.id
    ]
  );
}

async function finalizeExpiredWorkdays(nowTs = Date.now()) {
  const staleRows = await db.all(
    'SELECT * FROM workdays WHERE closedAt IS NULL AND endTs IS NOT NULL AND endTs <= ?',
    [nowTs]
  );

  if (!staleRows.length) {
    return;
  }

  const closedIds = [];
  for (const row of staleRows) {
    const closedAtValue = Number.isFinite(Number(row.endTs)) ? Number(row.endTs) : nowTs;
    await finalizeWorkdayRow(row, closedAtValue);
    closedIds.push(row.id);
  }

  const backlogOpenDays = await countBacklogOpenDays(nowTs);
  logger.info('workdays.finalizeExpired', { closedIds, backlogOpenDays });
}

async function countBacklogOpenDays(nowTs = Date.now()) {
  const row = await db.get(
    'SELECT COUNT(*) AS count FROM workdays WHERE closedAt IS NULL AND endTs IS NOT NULL AND endTs <= ?',
    [nowTs]
  );
  return row ? Number(row.count) || 0 : 0;
}

async function ensureSingleOpenWorkday(preferredOpenId = null) {
  const nowTs = Date.now();
  await finalizeExpiredWorkdays(nowTs);

  const rows = await db.all(
    'SELECT * FROM workdays WHERE closedAt IS NULL ORDER BY startTs DESC, createdAt DESC'
  );

  if (!rows.length) {
    return;
  }

  let keep = null;
  if (preferredOpenId) {
    keep = rows.find((row) => row.id === preferredOpenId) || null;
  }
  if (!keep) {
    keep = rows[0];
  }

  const closedIds = [];
  for (const row of rows) {
    if (row.id === keep.id) {
      continue;
    }
    const closedAtValue = Number.isFinite(Number(row.endTs)) ? Number(row.endTs) : nowTs;
    await finalizeWorkdayRow(row, closedAtValue);
    closedIds.push(row.id);
  }

  if (closedIds.length) {
    const backlogOpenDays = await countBacklogOpenDays(nowTs);
    logger.info('workdays.ensureSingleOpenWorkday', { keptId: keep.id, closedIds, backlogOpenDays });
  }
}

async function getLatestUpdateMarker() {
  const row = await db.get('SELECT MAX(updatedAt) AS updatedAt FROM workdays');
  return row && row.updatedAt ? row.updatedAt : null;
}

async function getCurrent() {
  await ensureSingleOpenWorkday();
  const nowTs = Date.now();
  const row = await db.get(
    'SELECT * FROM workdays WHERE closedAt IS NULL OR (endTs IS NOT NULL AND endTs > ?) ORDER BY (closedAt IS NULL) DESC, startTs DESC, createdAt DESC LIMIT 1',
    [nowTs]
  );
  return row ? hydrateWorkday(row) : null;
}

async function getById(id) {
  await finalizeExpiredWorkdays(Date.now());
  const row = await db.get('SELECT * FROM workdays WHERE id = ?', [id]);
  return row ? hydrateWorkday(row) : null;
}

async function upsert(workday) {
  const timestamp = nowIso();
  await db.run(
    'INSERT INTO workdays (id, startTs, endTs, summaryTimeMs, summaryDone, payload, closedAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)\n    ON CONFLICT(id) DO UPDATE SET startTs = excluded.startTs, endTs = excluded.endTs, summaryTimeMs = excluded.summaryTimeMs, summaryDone = excluded.summaryDone, payload = excluded.payload, closedAt = excluded.closedAt, updatedAt = excluded.updatedAt',
    [
      workday.id,
      workday.startTs !== undefined && workday.startTs !== null ? workday.startTs : null,
      workday.endTs !== undefined && workday.endTs !== null ? workday.endTs : null,
      Math.max(0, Number(workday.summaryTimeMs) || 0),
      Math.max(0, Number(workday.summaryDone) || 0),
      workday.payload ? JSON.stringify(workday.payload) : null,
      workday.closedAt !== undefined && workday.closedAt !== null ? workday.closedAt : null,
      workday.createdAt || timestamp,
      timestamp
    ]
  );
  const keepOpenId = workday && (workday.closedAt === undefined || workday.closedAt === null) ? workday.id : null;
  await ensureSingleOpenWorkday(keepOpenId);
  return getById(workday.id);
}

async function importCurrent(state) {
  if (!state || !state.id) return;
  await upsert(state);
}

module.exports = {
  getCurrent,
  getById,
  upsert,
  importCurrent,
  mapWorkday: mapWorkdayRow,
  countBacklogOpenDays,
  ensureSingleOpenWorkday,
  getLatestUpdateMarker
};
