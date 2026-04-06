import { YEAR_PLAN_COLORS, YEAR_PLAN_DEFAULT_TITLE, YEAR_PLAN_COLUMN_GAP } from '../config.js';
import { getDaysInMonth, uid } from '../utils.js';

// --- Сравнение и нормализация дат ---

export function compareYearPlanDates(aMonth, aDay, bMonth, bDay) {
  if (aMonth !== bMonth) return aMonth - bMonth;
  return aDay - bDay;
}

export function normalizeYearPlanRange(startMonth, startDay, endMonth, endDay) {
  if (compareYearPlanDates(startMonth, startDay, endMonth, endDay) <= 0)
    return { startMonth, startDay, endMonth, endDay };
  return { startMonth: endMonth, startDay: endDay, endMonth: startMonth, endDay: startDay };
}

// --- Нормализация полей ---

export function normalizeYearPlanTitle(title) {
  return String(title || '').trim() || YEAR_PLAN_DEFAULT_TITLE;
}

export function normalizeYearPlanYear(value) {
  const year = Math.trunc(Number(value));
  return Number.isFinite(year) ? year : null;
}

export function generateLocalYearPlanId() {
  return `l_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function clampYearPlanMonth(value) {
  const month = Math.trunc(Number(value));
  if (!Number.isFinite(month)) return 1;
  return Math.max(1, Math.min(12, month));
}

export function clampYearPlanDay(year, month, day) {
  const daysInMonth = getDaysInMonth(year, month - 1);
  const normalized = Math.trunc(Number(day));
  if (!Number.isFinite(normalized)) return 1;
  return Math.max(1, Math.min(daysInMonth, normalized));
}

export function normalizeYearPlanRangeForYear(year, startMonth, startDay, endMonth, endDay) {
  const safeStartMonth = clampYearPlanMonth(startMonth);
  const safeEndMonth = clampYearPlanMonth(endMonth);
  const safeStartDay = clampYearPlanDay(year, safeStartMonth, startDay);
  const safeEndDay = clampYearPlanDay(year, safeEndMonth, endDay);
  if (compareYearPlanDates(safeStartMonth, safeStartDay, safeEndMonth, safeEndDay) <= 0) {
    return { startMonth: safeStartMonth, startDay: safeStartDay, endMonth: safeEndMonth, endDay: safeEndDay };
  }
  return { startMonth: safeStartMonth, startDay: safeStartDay, endMonth: safeStartMonth, endDay: safeStartDay };
}

export function normalizeYearPlanProjectId(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

export function normalizeYearPlanColor(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!normalized) return YEAR_PLAN_COLORS[0];
  const match = YEAR_PLAN_COLORS.find(color => color.toLowerCase() === normalized);
  return match || YEAR_PLAN_COLORS[0];
}

// --- Цвета ---

export function hexToRgb(hex) {
  if (typeof hex !== 'string') return null;
  const raw = hex.trim().replace('#', '');
  if (raw.length === 3) {
    const r = parseInt(raw[0] + raw[0], 16);
    const g = parseInt(raw[1] + raw[1], 16);
    const b = parseInt(raw[2] + raw[2], 16);
    if ([r, g, b].some(v => Number.isNaN(v))) return null;
    return { r, g, b };
  }
  if (raw.length !== 6) return null;
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  if ([r, g, b].some(v => Number.isNaN(v))) return null;
  return { r, g, b };
}

export function rgbaFromRgb(rgb, alpha) {
  if (!rgb) return null;
  const a = Math.max(0, Math.min(1, Number(alpha)));
  if (!Number.isFinite(a)) return null;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a})`;
}

export function getYearPlanColorTokens(color) {
  const base = normalizeYearPlanColor(color);
  const rgb = hexToRgb(base);
  if (!rgb) {
    return {
      base,
      soft: 'var(--accent-soft)',
      softStrong: 'var(--accent-soft-strong)',
      border: 'var(--accent-border)',
      shadow: 'var(--accent-shadow)'
    };
  }
  return {
    base,
    soft: rgbaFromRgb(rgb, 0.18),
    softStrong: rgbaFromRgb(rgb, 0.32),
    border: rgbaFromRgb(rgb, 0.45),
    shadow: rgbaFromRgb(rgb, 0.25)
  };
}

export function applyYearPlanColorStyles(el, color) {
  if (!el) return;
  const tokens = getYearPlanColorTokens(color);
  el.style.setProperty('--year-activity-color', tokens.base);
  el.style.setProperty('--year-activity-soft', tokens.soft);
  el.style.setProperty('--year-activity-soft-strong', tokens.softStrong);
  el.style.setProperty('--year-activity-border', tokens.border);
  el.style.setProperty('--year-activity-shadow', tokens.shadow);
}

// --- Форматирование меток ---

export function formatYearPlanDateLabel(month, day) {
  const dd = String(day).padStart(2, '0');
  const mm = String(month).padStart(2, '0');
  return `${dd}.${mm}`;
}

export function formatYearPlanRangeLabel(item) {
  if (!item) return '';
  const start = formatYearPlanDateLabel(item.startMonth, item.startDay);
  const end = formatYearPlanDateLabel(item.endMonth, item.endDay);
  if (start === end) return start;
  return `${start}–${end}`;
}

// --- Сортировка ---

export function sortYearPlanItems(list) {
  if (!Array.isArray(list)) return;
  list.sort((a, b) =>
    a.startMonth - b.startMonth ||
    a.startDay - b.startDay ||
    a.endMonth - b.endMonth ||
    a.endDay - b.endDay ||
    String(a.id).localeCompare(String(b.id))
  );
}

// --- Нормализация объектов ---

export function normalizeStoredYearPlanItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const year = normalizeYearPlanYear(raw.year);
  if (!year) return null;
  const range = normalizeYearPlanRangeForYear(
    year,
    raw.startMonth ?? raw.month, raw.startDay,
    raw.endMonth ?? raw.month, raw.endDay
  );
  const id = typeof raw.id === 'string' || typeof raw.id === 'number' ? String(raw.id) : generateLocalYearPlanId();
  const title = normalizeYearPlanTitle(raw.title);
  const isDone = raw.isDone === true;
  const createdTs = Number.isFinite(raw.createdTs) ? raw.createdTs : Date.now();
  const updatedTs = Number.isFinite(raw.updatedTs) ? raw.updatedTs : createdTs;
  const projectId = normalizeYearPlanProjectId(raw.projectId);
  const color = normalizeYearPlanColor(raw.color);
  return {
    year, id,
    startMonth: range.startMonth, startDay: range.startDay,
    endMonth: range.endMonth, endDay: range.endDay,
    title, isDone, createdTs, updatedTs, projectId, color
  };
}

export function normalizeYearPlanPatchForStorage(item, patch) {
  const year = normalizeYearPlanYear(patch.year ?? item.year) ?? item.year;
  const range = normalizeYearPlanRangeForYear(
    year,
    patch.startMonth ?? item.startMonth, patch.startDay ?? item.startDay,
    patch.endMonth ?? item.endMonth, patch.endDay ?? item.endDay
  );
  const nextTitle = patch.title !== undefined ? normalizeYearPlanTitle(patch.title) : item.title;
  const nextIsDone = patch.isDone !== undefined ? patch.isDone === true : item.isDone;
  const nextProjectId = patch.projectId !== undefined
    ? normalizeYearPlanProjectId(patch.projectId)
    : item.projectId ?? null;
  const nextColor = patch.color !== undefined
    ? normalizeYearPlanColor(patch.color)
    : normalizeYearPlanColor(item.color);
  return {
    year,
    startMonth: range.startMonth, startDay: range.startDay,
    endMonth: range.endMonth, endDay: range.endDay,
    title: nextTitle, isDone: nextIsDone, projectId: nextProjectId, color: nextColor
  };
}

export function normalizeYearPlanItem(raw, year) {
  if (!raw || typeof raw !== 'object') return null;
  const normalizedYear = normalizeYearPlanYear(raw.year ?? year) ?? year;
  const startMonthRaw = raw.startMonth !== undefined ? raw.startMonth : raw.month;
  const endMonthRaw = raw.endMonth !== undefined ? raw.endMonth : raw.month;
  const safeStartMonth = Math.min(12, Math.max(1, Math.trunc(Number(startMonthRaw) || 1)));
  const safeEndMonth = Math.min(12, Math.max(1, Math.trunc(Number(endMonthRaw) || safeStartMonth)));
  const startMonthDays = getDaysInMonth(normalizedYear, safeStartMonth - 1);
  let startDay = Math.trunc(Number(raw.startDay));
  if (!Number.isFinite(startDay)) startDay = 1;
  startDay = Math.min(Math.max(1, startDay), startMonthDays);
  const endMonthDays = getDaysInMonth(normalizedYear, safeEndMonth - 1);
  let endDay = Math.trunc(Number(raw.endDay));
  if (!Number.isFinite(endDay)) endDay = startDay;
  endDay = Math.min(Math.max(1, endDay), endMonthDays);
  const normalizedRange = normalizeYearPlanRange(safeStartMonth, startDay, safeEndMonth, endDay);
  const id = typeof raw.id === 'string' || typeof raw.id === 'number' ? String(raw.id) : String(uid());
  const title = typeof raw.title === 'string' ? raw.title : '';
  const createdTs = Number.isFinite(raw.createdTs) ? raw.createdTs : null;
  const updatedTs = Number.isFinite(raw.updatedTs) ? raw.updatedTs : null;
  const projectId = normalizeYearPlanProjectId(raw.projectId);
  const color = normalizeYearPlanColor(raw.color);
  return {
    id, year: normalizedYear,
    startMonth: normalizedRange.startMonth, startDay: normalizedRange.startDay,
    endMonth: normalizedRange.endMonth, endDay: normalizedRange.endDay,
    title, isDone: raw.isDone === true,
    createdTs, updatedTs, projectId, color
  };
}

export function normalizeYearPlanList(list, year) {
  const normalized = [];
  if (Array.isArray(list)) {
    for (const entry of list) {
      const item = normalizeYearPlanItem(entry, year);
      if (item) normalized.push(item);
    }
  }
  return normalized;
}

// --- Дата-математика ---

export function getYearPlanDayOfYear(year, month, day) {
  let total = 0;
  for (let m = 1; m < month; m++) total += getDaysInMonth(year, m - 1);
  return total + day;
}

export function getYearPlanDateFromDayOfYear(year, dayOfYear) {
  let remaining = dayOfYear;
  for (let month = 1; month <= 12; month++) {
    const days = getDaysInMonth(year, month - 1);
    if (remaining > days) { remaining -= days; continue; }
    return { month, day: remaining };
  }
  return { month: 12, day: getDaysInMonth(year, 11) };
}

export function getYearPlanDaysInYear(year) {
  let total = 0;
  for (let m = 0; m < 12; m++) total += getDaysInMonth(year, m);
  return total;
}

// --- Геометрия сегментов (чистые вычисления) ---

export function getYearPlanSegmentPosition(segment) {
  const leftPercent = segment.colCount ? segment.slotIndex / segment.colCount * 100 : 0;
  const widthPercent = segment.colCount ? 100 / segment.colCount : 100;
  const leftOffset = YEAR_PLAN_COLUMN_GAP / 2;
  const widthOffset = YEAR_PLAN_COLUMN_GAP;
  return {
    left: YEAR_PLAN_COLUMN_GAP ? `calc(${leftPercent}% + ${leftOffset}px)` : leftPercent + '%',
    width: YEAR_PLAN_COLUMN_GAP ? `calc(${widthPercent}% - ${widthOffset}px)` : widthPercent + '%'
  };
}
