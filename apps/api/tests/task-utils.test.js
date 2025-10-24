const test = require('node:test');
const assert = require('node:assert');
const { buildTaskTree, flattenTasks } = require('../src/lib/task-utils');

test('buildTaskTree creates hierarchy', () => {
  const rows = [
    { id: '1', title: 'Root', done: 0, due: null, projectId: null, notes: '', timeSpentMs: 0, parentId: null, createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z', completedAt: null },
    { id: '2', title: 'Child', done: 0, due: null, projectId: null, notes: '', timeSpentMs: 0, parentId: '1', createdAt: '2024-01-01T00:00:01.000Z', updatedAt: '2024-01-01T00:00:01.000Z', completedAt: null }
  ];
  const { roots } = buildTaskTree(rows);
  assert.strictEqual(roots.length, 1);
  assert.strictEqual(roots[0].children.length, 1);
  const flat = flattenTasks(roots);
  assert.strictEqual(flat.length, 2);
});
