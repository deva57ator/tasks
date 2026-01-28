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

function normalizeProjectId(raw) {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return trimmed === '' ? null : trimmed;
  }
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return null;
    return String(raw);
  }
  return null;
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function compareMonthDay(aMonth, aDay, bMonth, bDay) {
  if (aMonth !== bMonth) return aMonth - bMonth;
  return aDay - bDay;
}

function normalizeTitle(value) {
  const title = value === undefined || value === null ? '' : String(value).trim();
  return title.length ? title : 'активность';
}

function normalizeColor(value, fallback) {
  const normalized =
    value === undefined || value === null ? null : String(value).trim().toLowerCase();
  if (!normalized) {
    return fallback || '#3a82f6';
  }
  return normalized;
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
  const startMonth =
    raw.startMonth !== undefined ? normalizeInt(raw.startMonth) : normalizeInt(defaults.startMonth);
  const endMonth = raw.endMonth !== undefined ? normalizeInt(raw.endMonth) : normalizeInt(defaults.endMonth);
  const startDay = raw.startDay !== undefined ? normalizeInt(raw.startDay) : normalizeInt(defaults.startDay);
  const endDay = raw.endDay !== undefined ? normalizeInt(raw.endDay) : normalizeInt(defaults.endDay);
  const title = normalizeTitle(raw.title !== undefined ? raw.title : defaults.title);
  const color = normalizeColor(raw.color, defaults.color);
  const isDone = normalizeIsDone(raw.isDone, defaults.isDone || 0);
  const projectId = normalizeProjectId(
    raw.projectId !== undefined ? raw.projectId : defaults.projectId
  );

  if (year === null) throw validationError('year is required');
  if (startMonth === null) throw validationError('startMonth is required');
  if (endMonth === null) throw validationError('endMonth is required');
  if (startDay === null) throw validationError('startDay is required');
  if (endDay === null) throw validationError('endDay is required');

  if (startMonth < 1 || startMonth > 12) throw validationError('startMonth must be between 1 and 12');
  if (endMonth < 1 || endMonth > 12) throw validationError('endMonth must be between 1 and 12');
  if (startDay < 1) throw validationError('startDay must be at least 1');

  const maxStartDay = daysInMonth(year, startMonth);
  if (startDay > maxStartDay) throw validationError('startDay exceeds days in month');
  const maxEndDay = daysInMonth(year, endMonth);
  if (endDay > maxEndDay) throw validationError('endDay exceeds days in month');
  if (compareMonthDay(endMonth, endDay, startMonth, startDay) < 0) {
    throw validationError('end date must be greater than or equal to start date');
  }

  return {
    year,
    startMonth,
    endMonth,
    startDay,
    endDay,
    title,
    color,
    isDone: isDone ? 1 : 0,
    projectId
  };
}

function mapRow(row) {
  if (!row) return null;
  return {
    ...row,
    id: Number(row.id),
    year: Number(row.year),
    startMonth: Number(row.startMonth),
    endMonth: Number(row.endMonth),
    startDay: Number(row.startDay),
    endDay: Number(row.endDay),
    isDone: Number(row.isDone),
    createdTs: Number(row.createdTs),
    updatedTs: Number(row.updatedTs),
    color: row.color ? String(row.color) : '#3a82f6',
    projectId: normalizeProjectId(row.projectId)
  };
}

async function listByYear(year) {
  const rows = await db.all(
    'SELECT * FROM yearplan_activities WHERE year = ? ORDER BY startMonth ASC, startDay ASC, endMonth ASC, endDay ASC, id ASC',
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
    'INSERT INTO yearplan_activities (year, startMonth, startDay, endMonth, endDay, title, color, isDone, projectId, createdTs, updatedTs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *',
    [
      normalized.year,
      normalized.startMonth,
      normalized.startDay,
      normalized.endMonth,
      normalized.endDay,
      normalized.title,
      normalized.color,
      normalized.isDone,
      normalized.projectId,
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
    'UPDATE yearplan_activities SET year = ?, startMonth = ?, startDay = ?, endMonth = ?, endDay = ?, title = ?, color = ?, isDone = ?, projectId = ?, updatedTs = ? WHERE id = ? RETURNING *',
    [
      normalized.year,
      normalized.startMonth,
      normalized.startDay,
      normalized.endMonth,
      normalized.endDay,
      normalized.title,
      normalized.color,
      normalized.isDone,
      normalized.projectId,
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
