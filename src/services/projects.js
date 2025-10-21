const crypto = require('node:crypto');
const db = require('../db/client');
const { nowIso } = require('../lib/time');

function mapProject(row) {
  return {
    id: row.id,
    title: row.title,
    emoji: row.emoji || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

async function list({ limit = 50, offset = 0 } = {}) {
  const totalRow = await db.get('SELECT COUNT(1) AS count FROM projects');
  const rows = await db.all('SELECT * FROM projects ORDER BY createdAt DESC LIMIT ? OFFSET ?', [limit, offset]);
  return {
    items: rows.map(mapProject),
    total: totalRow ? Number(totalRow.count) : 0
  };
}

async function create(data) {
  const id = data.id || crypto.randomUUID();
  const timestamp = nowIso();
  await db.run(
    'INSERT INTO projects (id, title, emoji, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)',
    [id, data.title, data.emoji || null, timestamp, timestamp]
  );
  return getById(id);
}

async function getById(id) {
  const row = await db.get('SELECT * FROM projects WHERE id = ?', [id]);
  return row ? mapProject(row) : null;
}

async function update(id, data) {
  const current = await getById(id);
  if (!current) return null;
  const timestamp = nowIso();
  await db.run(
    'UPDATE projects SET title = ?, emoji = ?, updatedAt = ? WHERE id = ?',
    [
      data.title !== undefined ? data.title : current.title,
      data.emoji !== undefined ? data.emoji : current.emoji,
      timestamp,
      id
    ]
  );
  return getById(id);
}

async function remove(id) {
  await db.run('DELETE FROM projects WHERE id = ?', [id]);
}

async function importMany(list = []) {
  if (!Array.isArray(list)) return;
  await db.transaction(async (tx) => {
    for (const item of list) {
      if (!item || !item.id) continue;
      const createdAt = item.createdAt || nowIso();
      const updatedAt = item.updatedAt || createdAt;
      tx.run(
        'INSERT INTO projects (id, title, emoji, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title = excluded.title, emoji = excluded.emoji, updatedAt = excluded.updatedAt',
        [item.id, item.title || '', item.emoji || null, createdAt, updatedAt]
      );
    }
  });
}

module.exports = {
  list,
  create,
  getById,
  update,
  remove,
  importMany,
  mapProject
};
