const db = require('../db/client');
const { nowIso } = require('../lib/time');

function mapArchive(row) {
  return {
    id: row.id,
    payload: JSON.parse(row.payload),
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

async function list({ limit = 50, offset = 0 } = {}) {
  const totalRow = await db.get('SELECT COUNT(1) AS count FROM archive');
  const rows = await db.all('SELECT * FROM archive ORDER BY archivedAt DESC LIMIT ? OFFSET ?', [limit, offset]);
  return {
    items: rows.map(mapArchive),
    total: totalRow ? Number(totalRow.count) : 0
  };
}

async function insert(entry) {
  const timestamp = nowIso();
  await db.run(
    'INSERT INTO archive (id, payload, archivedAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, archivedAt = excluded.archivedAt, updatedAt = excluded.updatedAt',
    [entry.id, JSON.stringify(entry.payload), entry.archivedAt, timestamp, timestamp]
  );
}

async function remove(id) {
  await db.run('DELETE FROM archive WHERE id = ?', [id]);
}

async function importMany(list = []) {
  if (!Array.isArray(list)) return;
  await db.transaction(async (tx) => {
    for (const item of list) {
      if (!item || !item.id) continue;
      const archivedAt = item.archivedAt || nowIso();
      const createdAt = item.createdAt || archivedAt;
      const updatedAt = item.updatedAt || createdAt;
      tx.run(
        'INSERT INTO archive (id, payload, archivedAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, archivedAt = excluded.archivedAt, updatedAt = excluded.updatedAt',
        [item.id, JSON.stringify(item.payload), archivedAt, createdAt, updatedAt]
      );
    }
  });
}

module.exports = {
  list,
  insert,
  remove,
  importMany,
  mapArchive
};
