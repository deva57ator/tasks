const crypto = require('node:crypto');
const db = require('../db/client');
const { nowIso } = require('../lib/time');
const {
  buildTaskTree,
  filterTasksTree,
  flattenTasks,
  mapRowToTask,
  filterTasksByIds,
  collectDescendantIds
} = require('../lib/task-utils');

function cloneTask(task) {
  return {
    id: task.id,
    title: task.title,
    done: task.done,
    due: task.due,
    project: task.project,
    notes: task.notes,
    timeSpent: task.timeSpent,
    parentId: task.parentId,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt,
    collapsed: task.collapsed,
    timerActive: task.timerActive,
    timerStart: task.timerStart,
    children: Array.isArray(task.children) ? task.children.map(cloneTask) : []
  };
}

async function fetchAllRows() {
  return db.all('SELECT * FROM tasks ORDER BY createdAt ASC');
}

function coerceBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return value === 'true' || value === '1';
  }
  return undefined;
}

async function list(filters = {}, options = {}) {
  const rows = await fetchAllRows();
  const { roots } = buildTaskTree(rows);
  const normalizedFilters = {
    projectId: filters.projectId || null,
    done: filters.done !== undefined ? coerceBoolean(filters.done) : undefined,
    dueFrom: filters.dueFrom || null,
    dueTo: filters.dueTo || null
  };
  let filtered = roots;
  if (normalizedFilters.projectId || typeof normalizedFilters.done === 'boolean' || normalizedFilters.dueFrom || normalizedFilters.dueTo) {
    filtered = filterTasksTree(roots, normalizedFilters);
  }
  const flat = flattenTasks(filtered);
  const total = flat.length;
  const limit = options.limit != null ? options.limit : total;
  const offset = options.offset || 0;
  const window = limit === 0 ? [] : flat.slice(offset, offset + limit);
  const idSet = new Set(window.map((task) => task.id));
  const items = (limit === total && offset === 0) || limit === undefined
    ? filtered
    : filterTasksByIds(filtered, idSet);
  return { items, total };
}

async function getById(id) {
  const row = await db.get('SELECT * FROM tasks WHERE id = ?', [id]);
  return row ? mapRowToTask(row) : null;
}

async function create(data) {
  const id = data.id || crypto.randomUUID();
  const timestamp = nowIso();
  const done = data.done === true;
  const completedAt = done ? (data.completedAt || timestamp) : null;
  await db.run(
    'INSERT INTO tasks (id, title, done, due, projectId, notes, timeSpentMs, parentId, createdAt, updatedAt, completedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      id,
      data.title || '',
      done ? 1 : 0,
      data.due || null,
      data.project || null,
      data.notes || '',
      Number.isFinite(Number(data.timeSpent)) ? Math.max(0, Number(data.timeSpent)) : 0,
      data.parentId || null,
      timestamp,
      timestamp,
      completedAt
    ]
  );
  return getById(id);
}

async function update(id, data) {
  const current = await getById(id);
  if (!current) return null;
  const timestamp = nowIso();
  const done = data.done !== undefined ? data.done === true : current.done;
  const completedAt = done ? (data.completedAt || current.completedAt || timestamp) : null;
  await db.run(
    'UPDATE tasks SET title = ?, done = ?, due = ?, projectId = ?, notes = ?, timeSpentMs = ?, parentId = ?, updatedAt = ?, completedAt = ? WHERE id = ?',
    [
      data.title !== undefined ? data.title : current.title,
      done ? 1 : 0,
      data.due !== undefined ? data.due : current.due,
      data.project !== undefined ? data.project : current.project,
      data.notes !== undefined ? data.notes : current.notes,
      data.timeSpent !== undefined ? Math.max(0, Number(data.timeSpent) || 0) : current.timeSpent,
      data.parentId !== undefined ? data.parentId : current.parentId,
      timestamp,
      completedAt,
      id
    ]
  );
  return getById(id);
}

async function remove(id) {
  await db.run('DELETE FROM tasks WHERE id = ?', [id]);
}

async function removeMany(ids = []) {
  if (!ids.length) return;
  await db.transaction(async (tx) => {
    for (const id of ids) {
      tx.run('DELETE FROM tasks WHERE id = ?', [id]);
    }
  });
}

async function importMany(list = []) {
  if (!Array.isArray(list)) return;
  await db.transaction(async (tx) => {
    for (const task of list) {
      if (!task || !task.id) continue;
      const createdAt = task.createdAt || nowIso();
      const updatedAt = task.updatedAt || createdAt;
      const done = task.done === true;
      const completedAt = done ? (task.completedAt || updatedAt) : null;
      tx.run(
        'INSERT INTO tasks (id, title, done, due, projectId, notes, timeSpentMs, parentId, createdAt, updatedAt, completedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\n        ON CONFLICT(id) DO UPDATE SET title = excluded.title, done = excluded.done, due = excluded.due, projectId = excluded.projectId, notes = excluded.notes, timeSpentMs = excluded.timeSpentMs, parentId = excluded.parentId, updatedAt = excluded.updatedAt, completedAt = excluded.completedAt',
        [
          task.id,
          task.title || '',
          done ? 1 : 0,
          task.due || null,
          task.project || null,
          task.notes || '',
          Number.isFinite(Number(task.timeSpent)) ? Math.max(0, Number(task.timeSpent)) : 0,
          task.parentId || null,
          createdAt,
          updatedAt,
          completedAt
        ]
      );
    }
  });
}

async function selectSubtree(id) {
  const rows = await fetchAllRows();
  const { map } = buildTaskTree(rows);
  const node = map.get(id);
  if (!node) return null;
  return node;
}

async function archiveAndRemove(ids) {
  const rows = await fetchAllRows();
  const { map } = buildTaskTree(rows);
  const payloads = [];
  const removeIds = new Set();
  for (const id of ids) {
    const node = map.get(id);
    if (!node) continue;
    payloads.push(cloneTask(node));
    collectDescendantIds(node).forEach((taskId) => removeIds.add(taskId));
  }
  if (!payloads.length) return { payloads: [], removed: [] };
  await removeMany(Array.from(removeIds));
  return { payloads, removed: Array.from(removeIds) };
}

module.exports = {
  list,
  getById,
  create,
  update,
  remove,
  removeMany,
  importMany,
  selectSubtree,
  archiveAndRemove
};
