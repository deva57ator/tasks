const db = require('../db/client');

function validationError(message) {
  const err = new Error(message);
  err.status = 400;
  err.code = 'validation_error';
  err.expose = true;
  return err;
}

function normalizeInt(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num)) {
    return null;
  }
  return num;
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function normalizeTitle(value) {
  const title = value === undefined || value === null ? '' : String(value).trim();
  return title.length ? title : 'активность';
}

function normalizeIsDone(value, fallback = 0) {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return fallback;
    return value === 0 ? 0 : 1;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === '') return fallback;
    if (trimmed === '0' || trimmed === 'false') return 0;
    if (trimmed === '1' || trimmed === 'true') return 1;
    const num = Number(trimmed);
    if (Number.isFinite(num)) {
      return num === 0 ? 0 : 1;
    }
  }
  return fallback;
}

function normalizeActivityInput(raw, defaults = {}) {
  const year = raw.year !== undefined ? normalizeInt(raw.year) : normalizeInt(defaults.year);
  const month = raw.month !== undefined ? normalizeInt(raw.month) : normalizeInt(defaults.month);
  const startDay = raw.startDay !== undefined ? normalizeInt(raw.startDay) : normalizeInt(defaults.startDay);
  const endDay = raw.endDay !== undefined ? normalizeInt(raw.endDay) : normalizeInt(defaults.endDay);
  const title = normalizeTitle(raw.title !== undefined ? raw.title : defaults.title);
  const isDone = normalizeIsDone(raw.isDone, defaults.isDone || 0);

  if (year === null) throw validationError('year is required');
  if (month === null) throw validationError('month is required');
  if (startDay === null) throw validationError('startDay is required');
  if (endDay === null) throw validationError('endDay is required');

  if (month < 1 || month > 12) throw validationError('month must be between 1 and 12');
  if (startDay < 1) throw validationError('startDay must be at least 1');
  if (endDay < startDay) throw validationError('endDay must be greater than or equal to startDay');

  const maxDay = daysInMonth(year, month);
  if (startDay > maxDay || endDay > maxDay) throw validationError('startDay/endDay exceed days in month');

  return {
    year,
    month,
    startDay,
    endDay,
    title,
    isDone: isDone ? 1 : 0
  };
}

function mapRow(row) {
  if (!row) return null;
  return {
    ...row,
    id: Number(row.id),
    year: Number(row.year),
    month: Number(row.month),
    startDay: Number(row.startDay),
    endDay: Number(row.endDay),
    isDone: Number(row.isDone),
    createdTs: Number(row.createdTs),
    updatedTs: Number(row.updatedTs)
  };
}

async function listByYear(year) {
  const rows = await db.all(
    'SELECT * FROM yearplan_activities WHERE year = ? ORDER BY month ASC, startDay ASC, endDay ASC, id ASC',
    [year]
  );
  return rows.map(mapRow);
}

async function getById(id) {
  if (id === undefined || id === null) return null;
  const row = await db.get('SELECT * FROM yearplan_activities WHERE id = ?', [id]);
  return mapRow(row);
}

async function create(data) {
  const normalized = normalizeActivityInput(data || {});
  const timestamp = Date.now();
  const rows = await db.all(
    'INSERT INTO yearplan_activities (year, month, startDay, endDay, title, isDone, createdTs, updatedTs) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *',
    [
      normalized.year,
      normalized.month,
      normalized.startDay,
      normalized.endDay,
      normalized.title,
      normalized.isDone,
      timestamp,
      timestamp
    ]
  );
  return getById(rows[0].id);
}

async function update(id, patch) {
  const existing = await getById(id);
  if (!existing) return null;
  const normalized = normalizeActivityInput(patch || {}, existing);
  const timestamp = Date.now();
  const rows = await db.all(
    'UPDATE yearplan_activities SET year = ?, month = ?, startDay = ?, endDay = ?, title = ?, isDone = ?, updatedTs = ? WHERE id = ? RETURNING *',
    [
      normalized.year,
      normalized.month,
      normalized.startDay,
      normalized.endDay,
      normalized.title,
      normalized.isDone,
      timestamp,
      id
    ]
  );
  return rows[0] ? getById(rows[0].id) : null;
}

async function remove(id) {
  const row = await db.get('DELETE FROM yearplan_activities WHERE id = ? RETURNING *', [id]);
  return !!row;
}

module.exports = {
  listByYear,
  create,
  update,
  remove,
  getById
};
