const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workday-tests-'));
process.env.DB_PATH = path.join(tempDir, 'db.sqlite');

const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function mockDotenv(request, parent, isMain) {
  if (request === 'dotenv') {
    return { config() { return {}; } };
  }
  return originalLoad(request, parent, isMain);
};

const db = require('../src/db/client');
const workdays = require('../src/services/workdays');
const tasks = require('../src/services/tasks');
const projects = require('../src/services/projects');
const { flattenTasks } = require('../src/lib/task-utils');

const migrationsDir = path.join(__dirname, '..', 'migrations');
const migrationFiles = fs
  .readdirSync(migrationsDir)
  .filter((file) => file.endsWith('.sql'))
  .sort();

test.before(async () => {
  for (const file of migrationFiles) {
    await db.runScript(path.join(migrationsDir, file));
  }
});

test.afterEach(async () => {
  await db.run('DELETE FROM workdays');
  await db.run('DELETE FROM tasks');
  await db.run('DELETE FROM projects');
  await db.run('DELETE FROM archive');
});

test.after(() => {
  Module._load = originalLoad;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('computes live workday summary using current task progress', async () => {
  const taskA = await tasks.create({ title: 'Task A', timeSpent: 60000 });
  const taskB = await tasks.create({ title: 'Task B', timeSpent: 0 });

  await tasks.update(taskA.id, { timeSpent: 180000 });
  await tasks.update(taskB.id, { timeSpent: 30000, done: true });

  const payload = {
    id: 'day-1',
    start: Date.now() - 1000,
    end: Date.now() + 1000,
    baseline: {
      [taskA.id]: 60000,
      [taskB.id]: 0
    },
    completed: {
      [taskB.id]: Date.now()
    },
    manualClosedStats: { timeMs: 0, doneCount: 0 },
    closedManually: false
  };

  await workdays.upsert({
    id: 'day-1',
    startTs: payload.start,
    endTs: payload.end,
    summaryTimeMs: 0,
    summaryDone: 0,
    payload,
    closedAt: null
  });

  const current = await workdays.getCurrent();
  assert.ok(current, 'expected workday to be returned');
  assert.equal(current.summaryTimeMs, 150000);
  assert.equal(current.summaryDone, 1);
});

test('uses manual statistics when workday was closed manually', async () => {
  const payload = {
    id: 'day-2',
    start: Date.now() - 1000,
    end: Date.now() + 1000,
    baseline: {},
    completed: {},
    manualClosedStats: { timeMs: 5000, doneCount: 2 },
    closedManually: true
  };

  const record = await workdays.upsert({
    id: 'day-2',
    startTs: payload.start,
    endTs: payload.end,
    summaryTimeMs: 1000,
    summaryDone: 1,
    payload,
    closedAt: new Date().toISOString()
  });

  assert.equal(record.summaryTimeMs, 5000);
  assert.equal(record.summaryDone, 2);
});

test('getCurrent returns manually closed workday before scheduled end', async () => {
  const now = Date.now();
  const payload = {
    id: 'day-2b',
    start: now - 1000,
    end: now + 3600000,
    baseline: {},
    completed: {},
    manualClosedStats: { timeMs: 12345, doneCount: 3 },
    closedManually: true
  };

  await workdays.upsert({
    id: 'day-2b',
    startTs: payload.start,
    endTs: payload.end,
    summaryTimeMs: 12345,
    summaryDone: 3,
    payload,
    closedAt: now
  });

  const current = await workdays.getCurrent();
  assert.ok(current, 'expected manually closed workday to be returned');
  assert.equal(current.id, 'day-2b');
  assert.equal(current.summaryTimeMs, 12345);
  assert.equal(current.summaryDone, 3);
});

test('getCurrent creates active workday when none exists', async () => {
  const realNow = Date.now;
  const base = new Date();
  base.setHours(12, 0, 0, 0);
  const fixedTs = base.getTime();
  Date.now = () => fixedTs;
  const pad = (value) => String(value).padStart(2, '0');
  const expectedStart = new Date(base);
  expectedStart.setHours(6, 0, 0, 0);
  const expectedEnd = new Date(expectedStart);
  expectedEnd.setDate(expectedEnd.getDate() + 1);
  expectedEnd.setHours(3, 0, 0, 0);

  try {
    const current = await workdays.getCurrent();
    assert.ok(current);
    const expectedId = `${expectedStart.getFullYear()}-${pad(expectedStart.getMonth() + 1)}-${pad(expectedStart.getDate())}`;
    assert.equal(current.id, expectedId);
    assert.equal(current.startTs, expectedStart.getTime());
    assert.equal(current.endTs, expectedEnd.getTime());
    assert.equal(current.closedAt, null);
    assert.ok(current.payload);
    assert.equal(current.payload.locked, false);
  } finally {
    Date.now = realNow;
  }
});

test('falls back to stored summary when payload information is incomplete', async () => {
  const payload = {
    id: 'day-3',
    start: Date.now() - 1000,
    end: Date.now() + 1000,
    baseline: { missing: 1200 },
    completed: { missing: Date.now() },
    manualClosedStats: { timeMs: 0, doneCount: 0 },
    closedManually: false
  };

  const record = await workdays.upsert({
    id: 'day-3',
    startTs: payload.start,
    endTs: payload.end,
    summaryTimeMs: 4321,
    summaryDone: 3,
    payload,
    closedAt: null
  });

  assert.equal(record.summaryTimeMs, 4321);
  assert.equal(record.summaryDone, 3);
});

test('getCurrent ignores closed workday once end time has passed', async () => {
  const now = Date.now();
  const payload = {
    id: 'day-4',
    start: now - 7200000,
    end: now - 3600000,
    baseline: {},
    completed: {},
    manualClosedStats: { timeMs: 2000, doneCount: 1 },
    closedManually: true
  };

  await workdays.upsert({
    id: 'day-4',
    startTs: payload.start,
    endTs: payload.end,
    summaryTimeMs: 2000,
    summaryDone: 1,
    payload,
    closedAt: now - 1800000
  });

  const current = await workdays.getCurrent();
  assert.ok(current);
  assert.notEqual(current.id, payload.id);
  assert.equal(current.closedAt, null);
});

test('closeById recomputes summary from tasks and ignores repeated closes', async () => {
  const task = await tasks.create({ title: 'Manual close task', timeSpent: 150000 });
  const payload = {
    id: 'day-close-manual',
    start: Date.now() - 3600000,
    end: Date.now() + 3600000,
    baseline: {
      [task.id]: 60000
    },
    completed: {},
    manualClosedStats: { timeMs: 0, doneCount: 0 },
    closedManually: true
  };

  await workdays.upsert({
    id: payload.id,
    startTs: payload.start,
    endTs: payload.end,
    summaryTimeMs: 1000,
    summaryDone: 5,
    payload,
    closedAt: null
  });

  const firstClose = await workdays.closeById(payload.id, payload.end - 1000);
  assert.ok(firstClose);
  assert.equal(firstClose.summaryTimeMs, 90000);
  assert.equal(firstClose.summaryDone, 0);

  await tasks.update(task.id, { timeSpent: 210000 });
  const secondClose = await workdays.closeById(payload.id, payload.end);
  assert.ok(secondClose);
  assert.equal(secondClose.summaryTimeMs, 90000);
  assert.equal(secondClose.summaryDone, 0);
});

test('reopen clears closed flag and allows totals to refresh', async () => {
  const task = await tasks.create({ title: 'Reopen task', timeSpent: 60000 });
  const payload = {
    id: 'day-reopen',
    start: Date.now() - 3600000,
    end: Date.now() + 3600000,
    baseline: {
      [task.id]: 60000
    },
    completed: {
      [task.id]: Date.now()
    },
    manualClosedStats: { timeMs: 0, doneCount: 0 },
    closedManually: true
  };

  await workdays.upsert({
    id: payload.id,
    startTs: payload.start,
    endTs: payload.end,
    summaryTimeMs: 0,
    summaryDone: 0,
    payload,
    closedAt: null
  });

  await workdays.closeById(payload.id, payload.end - 5000);
  let stored = await workdays.getById(payload.id);
  assert.ok(stored.closedAt);
  assert.equal(stored.payload && stored.payload.locked, true);

  await workdays.reopen({ id: payload.id, payload });
  stored = await workdays.getById(payload.id);
  assert.equal(stored.closedAt, null);
  assert.equal(stored.payload && stored.payload.locked, false);

  await tasks.update(task.id, { timeSpent: 180000, done: true });
  const finalClose = await workdays.closeById(payload.id, payload.end);
  assert.ok(finalClose);
  assert.equal(finalClose.summaryTimeMs, 120000);
  assert.equal(finalClose.summaryDone, 1);
});

test('finalizes stale workday automatically at scheduled end', async () => {
  const now = Date.now();
  const start = now - 10 * 3600000;
  const end = now - 3600000;
  const baseTime = 60000;
  const finalTime = 180000;

  const task = await tasks.create({ title: 'Carryover task', timeSpent: baseTime });
  await tasks.update(task.id, { timeSpent: finalTime, done: true });

  const payload = {
    id: 'day-auto',
    start,
    end,
    baseline: {
      [task.id]: baseTime
    },
    completed: {
      [task.id]: end - 1000
    },
    manualClosedStats: { timeMs: 0, doneCount: 0 },
    closedManually: false
  };

  await workdays.upsert({
    id: 'day-auto',
    startTs: start,
    endTs: end,
    summaryTimeMs: 0,
    summaryDone: 0,
    payload,
    closedAt: null
  });

  const current = await workdays.getCurrent();
  assert.ok(current);
  assert.notEqual(current.id, payload.id);
  assert.equal(current.closedAt, null);

  const stored = await workdays.getById('day-auto');
  assert.ok(stored);
  assert.equal(stored.summaryTimeMs, finalTime - baseTime);
  assert.equal(stored.summaryDone, 1);
  assert.equal(stored.closedAt, end);
  assert.ok(stored.payload);
  assert.equal(stored.payload.locked, true);
  assert.equal(stored.payload.closedManually, false);
  assert.deepEqual(stored.payload.manualClosedStats, { timeMs: finalTime - baseTime, doneCount: 1 });
});

test('upsert automatically closes older open workdays', async () => {
  const now = Date.now();
  const timestamp = new Date().toISOString();

  await db.run(
    'INSERT INTO workdays (id, startTs, endTs, summaryTimeMs, summaryDone, payload, closedAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ['legacy-1', now - 5 * 3600000, now - 4 * 3600000, 0, 0, null, null, timestamp, timestamp]
  );
  await db.run(
    'INSERT INTO workdays (id, startTs, endTs, summaryTimeMs, summaryDone, payload, closedAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ['legacy-2', now - 3 * 3600000, now - 2 * 3600000, 0, 0, null, null, timestamp, timestamp]
  );

  const current = await workdays.upsert({
    id: 'current-day',
    startTs: now - 3600000,
    endTs: now + 3600000,
    summaryTimeMs: 0,
    summaryDone: 0,
    payload: null,
    closedAt: null
  });

  assert.ok(current);
  assert.equal(current.id, 'current-day');
  assert.equal(current.closedAt, null);

  const legacyRows = await db.all('SELECT id, closedAt FROM workdays WHERE id IN (?, ?)', ['legacy-1', 'legacy-2']);
  assert.equal(legacyRows.length, 2);
  for (const row of legacyRows) {
    assert.notEqual(row.closedAt, null);
  }

  const backlog = await workdays.countBacklogOpenDays();
  assert.equal(backlog, 0);
});

test('getCurrent prefers open workday when duplicates share start time', async () => {
  const now = Date.now();
  const start = now - 1000;
  const end = now + 3600000;
  const timestamp = new Date().toISOString();

  await db.run(
    'INSERT INTO workdays (id, startTs, endTs, summaryTimeMs, summaryDone, payload, closedAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ['duplicate-old', start, end, 0, 0, null, null, timestamp, timestamp]
  );

  await workdays.upsert({
    id: 'duplicate-new',
    startTs: start,
    endTs: end,
    summaryTimeMs: 0,
    summaryDone: 0,
    payload: null,
    closedAt: null
  });

  const current = await workdays.getCurrent();

  assert.ok(current);
  assert.equal(current.id, 'duplicate-new');
  assert.equal(current.closedAt, null);

  const oldRow = await workdays.getById('duplicate-old');
  assert.ok(oldRow);
  assert.notEqual(oldRow.closedAt, null);
});

test('countBacklogOpenDays highlights stale workdays', async () => {
  const now = Date.now();
  const timestamp = new Date().toISOString();

  await db.run(
    'INSERT INTO workdays (id, startTs, endTs, summaryTimeMs, summaryDone, payload, closedAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ['backlog-1', now - 7200000, now - 3600000, 0, 0, null, null, timestamp, timestamp]
  );

  const backlogBefore = await workdays.countBacklogOpenDays(now);
  assert.equal(backlogBefore, 1);

  await workdays.ensureSingleOpenWorkday();

  const backlogAfter = await workdays.countBacklogOpenDays();
  assert.equal(backlogAfter, 0);
});

test('getLatestUpdateMarker changes when workdays mutate', async () => {
  const now = Date.now();
  const payload = { id: 'marker-test' };

  await workdays.upsert({
    id: 'marker-test',
    startTs: now,
    endTs: now + 3600000,
    summaryTimeMs: 0,
    summaryDone: 0,
    payload,
    closedAt: null
  });

  const markerBefore = await workdays.getLatestUpdateMarker();
  assert.ok(markerBefore);

  const closed = await workdays.upsert({
    id: 'marker-test',
    startTs: now,
    endTs: now + 3600000,
    summaryTimeMs: 0,
    summaryDone: 0,
    payload,
    closedAt: now + 1800000
  });

  assert.ok(closed.closedAt);
  const markerAfter = await workdays.getLatestUpdateMarker();
  assert.ok(markerAfter);
  assert.notEqual(markerAfter, markerBefore);
});

test('task listing accepts numeric project identifiers', async () => {
  await projects.create({ id: '0', title: 'Inbox' });
  await projects.create({ id: 'alpha', title: 'Alpha' });

  const matching = await tasks.create({ title: 'First task', project: '0' });
  await tasks.create({ title: 'Second task', project: 'alpha' });

  const { items, total } = await tasks.list({ projectId: 0 });

  assert.equal(total, 1);
  const flat = flattenTasks(items);
  assert.equal(flat.length, 1);
  assert.equal(flat[0].id, matching.id);
});
