const db = require('../db/client');
const { nowIso } = require('../lib/time');

function mapWorkday(row) {
  return {
    id: row.id,
    startTs: row.startTs,
    endTs: row.endTs,
    summaryTimeMs: row.summaryTimeMs,
    summaryDone: row.summaryDone,
    payload: row.payload ? JSON.parse(row.payload) : null,
    closedAt: row.closedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

async function getCurrent() {
  const row = await db.get('SELECT * FROM workdays WHERE closedAt IS NULL ORDER BY startTs DESC LIMIT 1');
  return row ? mapWorkday(row) : null;
}

async function upsert(workday) {
  const timestamp = nowIso();
  await db.run(
    'INSERT INTO workdays (id, startTs, endTs, summaryTimeMs, summaryDone, payload, closedAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)\n    ON CONFLICT(id) DO UPDATE SET startTs = excluded.startTs, endTs = excluded.endTs, summaryTimeMs = excluded.summaryTimeMs, summaryDone = excluded.summaryDone, payload = excluded.payload, closedAt = excluded.closedAt, updatedAt = excluded.updatedAt',
    [
      workday.id,
      workday.startTs || null,
      workday.endTs || null,
      Math.max(0, Number(workday.summaryTimeMs) || 0),
      Math.max(0, Number(workday.summaryDone) || 0),
      workday.payload ? JSON.stringify(workday.payload) : null,
      workday.closedAt || null,
      workday.createdAt || timestamp,
      timestamp
    ]
  );
  return mapWorkday(await db.get('SELECT * FROM workdays WHERE id = ?', [workday.id]));
}

async function importCurrent(state) {
  if (!state || !state.id) return;
  await upsert(state);
}

module.exports = {
  getCurrent,
  upsert,
  importCurrent,
  mapWorkday
};
