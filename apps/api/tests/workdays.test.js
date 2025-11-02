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

const migrationPath = path.join(__dirname, '..', 'migrations/001_init.sql');

test.before(async () => {
  await db.runScript(migrationPath);
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
