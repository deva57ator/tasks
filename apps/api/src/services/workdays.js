const db = require('../db/client');
const { nowIso } = require('../lib/time');
const logger = require('../lib/logger');

const WORKDAY_START_HOUR = 6;
const WORKDAY_END_HOUR = 3;

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatWorkdayId(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function getWorkdayWindow(nowTs = Date.now()) {
  const current = new Date(nowTs);
  const hour = current.getHours();
  if (hour < WORKDAY_END_HOUR) {
    const start = new Date(current);
    start.setDate(start.getDate() - 1);
    start.setHours(WORKDAY_START_HOUR, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    end.setHours(WORKDAY_END_HOUR, 0, 0, 0);
    return {
      state: 'active',
      id: formatWorkdayId(start),
      startTs: start.getTime(),
      endTs: end.getTime()
    };
  }
  if (hour >= WORKDAY_START_HOUR) {
    const start = new Date(current);
    start.setHours(WORKDAY_START_HOUR, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    end.setHours(WORKDAY_END_HOUR, 0, 0, 0);
    return {
      state: 'active',
      id: formatWorkdayId(start),
      startTs: start.getTime(),
      endTs: end.getTime()
    };
  }

  const prevStart = new Date(current);
  prevStart.setDate(prevStart.getDate() - 1);
  prevStart.setHours(WORKDAY_START_HOUR, 0, 0, 0);
  const prevEnd = new Date(prevStart);
  prevEnd.setDate(prevEnd.getDate() + 1);
  prevEnd.setHours(WORKDAY_END_HOUR, 0, 0, 0);
  const nextStart = new Date(current);
  nextStart.setHours(WORKDAY_START_HOUR, 0, 0, 0);
  return {
    state: 'waiting',
    id: formatWorkdayId(prevStart),
    startTs: prevStart.getTime(),
    endTs: prevEnd.getTime(),
    nextStartTs: nextStart.getTime()
  };
}

function buildOpenPayloadFromWindow(window) {
  if (!window || !window.id) {
    return null;
  }
  return {
    id: window.id,
    start: window.startTs,
    end: window.endTs,
    baseline: {},
    completed: {},
    locked: false,
    closedAt: null,
    closedManually: false,
    manualClosedStats: { timeMs: 0, doneCount: 0 },
    finalTimeMs: 0,
    finalDoneCount: 0,
    reopenedAt: null
  };
}

async function ensureActiveWorkday(nowTs = Date.now()) {
  const window = getWorkdayWindow(nowTs);
  if (!window || window.state !== 'active' || !window.id) {
    return null;
  }
  const existing = await db.get('SELECT * FROM workdays WHERE id = ?', [window.id]);
  if (existing) {
    return hydrateWorkday(existing);
  }
  const payload = buildOpenPayloadFromWindow(window);
  return upsert({
    id: window.id,
    startTs: window.startTs,
    endTs: window.endTs,
    summaryTimeMs: 0,
    summaryDone: 0,
    payload,
    closedAt: null
  });
}

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

function resetPayloadForReopen(source) {
  const reopenedAt = Date.now();
  if (!source || typeof source !== 'object') {
    return {
      locked: false,
      closedAt: null,
      closedManually: false,
      manualClosedStats: { timeMs: 0, doneCount: 0 },
      baseline: {},
      completed: {},
      finalTimeMs: 0,
      finalDoneCount: 0,
      reopenedAt
    };
  }

  const manualStats = extractManualStats(source);
  const finalTimeRaw = source.finalTimeMs;
  const finalDoneRaw = source.finalDoneCount;
  const finalTime = Number.isFinite(Number(finalTimeRaw))
    ? Math.max(0, Math.round(coerceNumber(finalTimeRaw)))
    : manualStats.timeMs;
  const finalDone = Number.isFinite(Number(finalDoneRaw))
    ? Math.max(0, Math.round(coerceNumber(finalDoneRaw)))
    : manualStats.doneCount;

  return {
    ...source,
    baseline: {},
    completed: {},
    locked: false,
    closedAt: null,
    closedManually: false,
    manualClosedStats: manualStats,
    finalTimeMs: finalTime,
    finalDoneCount: finalDone,
    reopenedAt
  };
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

async function computeWorkdayDelta(payload) {
  if (!payload || typeof payload !== 'object') {
    return { timeMs: 0, doneCount: 0, hasSource: false };
  }

  const baseline = payload.baseline && typeof payload.baseline === 'object' ? payload.baseline : {};
  const completed = payload.completed && typeof payload.completed === 'object' ? payload.completed : {};
  const needsTasks = Object.keys(baseline).length > 0 || Object.keys(completed).length > 0;
  if (!needsTasks) {
    return { timeMs: 0, doneCount: 0, hasSource: false };
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
  let hasSource = false;
  for (const [taskId, baseValue] of Object.entries(baseline)) {
    const task = taskMap.get(taskId);
    if (!task) continue;
    hasSource = true;
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
      hasSource = true;
    }
  }

  return { timeMs: deltaTime, doneCount: deltaDone, hasSource };
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
  let hasStatsSource = manual.timeMs > 0 || manual.doneCount > 0;

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
    if (delta.hasSource) {
      hasStatsSource = true;
    }
  }

  if (hasStatsSource) {
    mapped.summaryTimeMs = Math.max(0, Math.round(coerceNumber(summaryTimeMs)) || 0);
    mapped.summaryDone = Math.max(0, Math.round(coerceNumber(summaryDone)) || 0);
  } else {
    mapped.summaryTimeMs = Math.max(mapped.summaryTimeMs, 0);
    mapped.summaryDone = Math.max(mapped.summaryDone, 0);
  }
  return mapped;
}

async function computeFinalStats(row) {
  const payload = parsePayload(row.payload);
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const manual = extractManualStats(payload);
  const delta = await computeWorkdayDelta(payload);
  const deltaTime = Math.max(0, coerceNumber(delta.timeMs));
  const deltaDone = Math.max(0, Math.round(coerceNumber(delta.doneCount)));
  let summaryTimeMs = manual.timeMs;
  let summaryDone = manual.doneCount;

  if (delta.hasSource) {
    summaryTimeMs += deltaTime;
    summaryDone += deltaDone;
  }

  const hasStats = summaryTimeMs > 0 || summaryDone > 0;
  if (!hasStats) {
    return null;
  }
  return {
    timeMs: Math.max(0, Math.round(coerceNumber(summaryTimeMs)) || 0),
    doneCount: Math.max(0, Math.round(coerceNumber(summaryDone)) || 0)
  };
}

async function finalizeWorkdayRow(row, closedAtValue, options = {}) {
  const hydrated = await hydrateWorkday(row);
  if (!hydrated) return;

  const recomputed = await computeFinalStats(row);
  const timeSource = recomputed ? recomputed.timeMs : hydrated.summaryTimeMs;
  const doneSource = recomputed ? recomputed.doneCount : hydrated.summaryDone;
  const finalTime = Math.max(0, Math.round(coerceNumber(timeSource)) || 0);
  const finalDone = Math.max(0, Math.round(coerceNumber(doneSource)) || 0);
  const timestamp = nowIso();
  const closedManually = options && options.closedManually === true;

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
      closedManually,
      locked: true,
      closedAt: closedAtValue,
      reopenedAt: null
    };
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
    await finalizeWorkdayRow(row, closedAtValue, { closedManually: false });
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
    await finalizeWorkdayRow(row, closedAtValue, { closedManually: false });
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
  if (row) {
    return hydrateWorkday(row);
  }
  return ensureActiveWorkday(nowTs);
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

async function closeById(id, closedAtValue = Date.now()) {
  if (!id) return null;
  const row = await db.get('SELECT * FROM workdays WHERE id = ?', [id]);
  if (!row) return null;
  if (row.closedAt !== undefined && row.closedAt !== null) {
    return hydrateWorkday(row);
  }
  const effectiveClosedAt = Number.isFinite(Number(closedAtValue))
    ? Number(closedAtValue)
    : (Number.isFinite(Number(row.closedAt)) ? Number(row.closedAt) : Date.now());
  await finalizeWorkdayRow(row, effectiveClosedAt, { closedManually: true });
  const updated = await db.get('SELECT * FROM workdays WHERE id = ?', [id]);
  return updated ? hydrateWorkday(updated) : null;
}

async function reopen(workday) {
  if (!workday || !workday.id) return null;
  const existing = await db.get('SELECT * FROM workdays WHERE id = ?', [workday.id]);
  if (!existing) {
    const payload = resetPayloadForReopen(workday.payload);
    return upsert({ ...workday, closedAt: null, payload });
  }
  if (existing.closedAt === undefined || existing.closedAt === null) {
    return hydrateWorkday(existing);
  }
  const timestamp = nowIso();
  const parsedExisting = parsePayload(existing.payload);
  const providedPayload = workday.payload && typeof workday.payload === 'object' ? workday.payload : null;
  const payloadSource = parsedExisting || providedPayload;
  const payload = resetPayloadForReopen(payloadSource);
  const existingSummaryTime = Math.max(0, Number(existing.summaryTimeMs) || 0);
  const existingSummaryDone = Math.max(0, Math.round(Number(existing.summaryDone) || 0));
  const providedSummaryTime =
    workday.summaryTimeMs !== undefined && workday.summaryTimeMs !== null
      ? Math.max(0, Number(workday.summaryTimeMs) || 0)
      : null;
  const providedSummaryDone =
    workday.summaryDone !== undefined && workday.summaryDone !== null
      ? Math.max(0, Math.round(Number(workday.summaryDone) || 0))
      : null;
  const summaryTime = providedSummaryTime === null
    ? existingSummaryTime
    : Math.max(existingSummaryTime, providedSummaryTime);
  const summaryDone = providedSummaryDone === null
    ? existingSummaryDone
    : Math.max(existingSummaryDone, providedSummaryDone);
  await db.run(
    'UPDATE workdays SET startTs = ?, endTs = ?, summaryTimeMs = ?, summaryDone = ?, payload = ?, closedAt = NULL, updatedAt = ? WHERE id = ?',
    [
      workday.startTs !== undefined && workday.startTs !== null ? workday.startTs : existing.startTs,
      workday.endTs !== undefined && workday.endTs !== null ? workday.endTs : existing.endTs,
      Math.max(0, Number(summaryTime) || 0),
      Math.max(0, Math.round(coerceNumber(summaryDone))),
      payload ? JSON.stringify(payload) : null,
      timestamp,
      workday.id
    ]
  );
  await ensureSingleOpenWorkday(workday.id);
  return getById(workday.id);
}

module.exports = {
  getCurrent,
  getById,
  upsert,
  importCurrent,
  closeById,
  reopen,
  mapWorkday: mapWorkdayRow,
  countBacklogOpenDays,
  ensureSingleOpenWorkday,
  getLatestUpdateMarker
};
