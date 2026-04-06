import { STORAGE_MODES, YEAR_PLAN_STORAGE_KEY, MONTH_NAMES } from '../config.js';
import { getDaysInMonth } from '../utils.js';
import { apiRequest } from '../api.js';
import { storageMode, isServerMode } from '../storage.js';
import {
  normalizeYearPlanTitle, normalizeYearPlanYear, generateLocalYearPlanId,
  normalizeYearPlanRangeForYear, normalizeYearPlanProjectId, normalizeYearPlanColor,
  normalizeStoredYearPlanItem, normalizeYearPlanPatchForStorage,
  normalizeYearPlanItem, normalizeYearPlanList,
  sortYearPlanItems, clampYearPlanMonth
} from './normalize.js';

// --- Коллбэки из main.js ---

const _cb = {};
export function registerYearPlanDataCallbacks(cbs) { Object.assign(_cb, cbs); }
function renderIfVisible() { _cb.render?.(); }
function doToast(msg) { _cb.toast?.(msg); }

// --- Стейт (данные и кэш) ---

export let yearPlanYear = new Date().getFullYear();
export function setYearPlanYear(v) { yearPlanYear = v; }

export let yearPlanDataMode = storageMode;
export function getYearPlanDataMode() { return yearPlanDataMode; }
export function syncYearPlanDataMode() { yearPlanDataMode = storageMode; }

export const yearPlanCache = new Map();
export const yearPlanLoadingYears = new Set();
export const yearPlanErrors = new Map();

export function resetYearPlanCache() {
  yearPlanCache.clear();
  yearPlanLoadingYears.clear();
  yearPlanErrors.clear();
}

// --- UI-стейт Year Plan (используется рендером и интерактивом, PR 6b) ---

export let yearPlanDraft = null;
export function setYearPlanDraft(v) { yearPlanDraft = v; }

export let yearPlanDraftFocusRequested = false;
export function setYearPlanDraftFocusRequested(v) { yearPlanDraftFocusRequested = v; }

export let yearPlanDraftSubmitting = false;
export function setYearPlanDraftSubmitting(v) { yearPlanDraftSubmitting = v; }

export let yearPlanSelectedId = null;
export function setYearPlanSelectedId(v) { yearPlanSelectedId = v; }

export let yearPlanHoverId = null;
export function setYearPlanHoverId(v) { yearPlanHoverId = v; }

export let yearPlanEditingId = null;
export function setYearPlanEditingId(v) { yearPlanEditingId = v; }

export let yearPlanEditingValue = '';
export function setYearPlanEditingValue(v) { yearPlanEditingValue = v; }

export let yearPlanEditingOriginal = '';
export function setYearPlanEditingOriginal(v) { yearPlanEditingOriginal = v; }

export let yearPlanEditingFocusRequested = false;
export function setYearPlanEditingFocusRequested(v) { yearPlanEditingFocusRequested = v; }

export let yearPlanEditingSubmitting = false;
export function setYearPlanEditingSubmitting(v) { yearPlanEditingSubmitting = v; }

export let yearPlanResizeState = null;
export function setYearPlanResizeState(v) { yearPlanResizeState = v; }

export let yearPlanResizeSubmitting = false;
export function setYearPlanResizeSubmitting(v) { yearPlanResizeSubmitting = v; }

export let yearPlanMoveState = null;
export function setYearPlanMoveState(v) { yearPlanMoveState = v; }

export let yearPlanMonthMeta = [];
export function setYearPlanMonthMeta(v) { yearPlanMonthMeta = v; }

export const yearPlanPendingDeletes = new Set();

export let yearPlanFocusId = null;
export function setYearPlanFocusId(v) { yearPlanFocusId = v; }

// --- Форм-стейт ---

export let yearPlanFormOpen = false;
export let yearPlanFormSubmitting = false;
export let yearPlanFormError = '';
export let yearPlanFormState = null;

// --- localStorage ---

export function readYearPlanStorage() {
  try {
    const raw = JSON.parse(localStorage.getItem(YEAR_PLAN_STORAGE_KEY));
    if (!raw || typeof raw !== 'object') return { version: 1, items: [] };
    const items = Array.isArray(raw.items) ? raw.items : [];
    return { version: 1, items };
  } catch {
    return { version: 1, items: [] };
  }
}

export function writeYearPlanStorage(items) {
  try { localStorage.setItem(YEAR_PLAN_STORAGE_KEY, JSON.stringify({ version: 1, items })); } catch {}
}

// --- Data Provider (CRUD) ---

export const yearPlanProvider = {
  list(year) {
    if (getYearPlanDataMode() === STORAGE_MODES.SERVER) {
      return apiRequest(`/yearplan?year=${encodeURIComponent(year)}`).then(payload => {
        const items = Array.isArray(payload?.items) ? payload.items : Array.isArray(payload) ? payload : [];
        return normalizeYearPlanList(items, year);
      });
    }
    const stored = readYearPlanStorage();
    const normalized = [];
    for (const entry of stored.items) {
      const item = normalizeStoredYearPlanItem(entry);
      if (item && item.year === year) normalized.push(item);
    }
    sortYearPlanItems(normalized);
    return Promise.resolve(normalizeYearPlanList(normalized, year));
  },
  create(item) {
    if (getYearPlanDataMode() === STORAGE_MODES.SERVER) {
      return apiRequest('/yearplan', { method: 'POST', body: item }).then(payload => normalizeYearPlanItem(payload, item.year));
    }
    const stored = readYearPlanStorage();
    const year = normalizeYearPlanYear(item.year) || yearPlanYear;
    const range = normalizeYearPlanRangeForYear(year, item.startMonth, item.startDay, item.endMonth, item.endDay);
    const color = normalizeYearPlanColor(item.color);
    const projectId = normalizeYearPlanProjectId(item.projectId);
    const now = Date.now();
    const created = {
      id: generateLocalYearPlanId(), year,
      startMonth: range.startMonth, startDay: range.startDay,
      endMonth: range.endMonth, endDay: range.endDay,
      title: normalizeYearPlanTitle(item.title),
      isDone: item.isDone === true, projectId, color,
      createdTs: now, updatedTs: now
    };
    stored.items.push(created);
    writeYearPlanStorage(stored.items);
    return Promise.resolve(normalizeYearPlanItem(created, year));
  },
  update(id, patch) {
    if (getYearPlanDataMode() === STORAGE_MODES.SERVER) {
      return apiRequest(`/yearplan/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch })
        .then(payload => normalizeYearPlanItem(payload, patch.year || yearPlanYear));
    }
    const stored = readYearPlanStorage();
    const idx = stored.items.findIndex(entry => entry && String(entry.id) === String(id));
    if (idx === -1) throw new Error('Активность не найдена');
    const current = normalizeStoredYearPlanItem(stored.items[idx]);
    if (!current) throw new Error('Активность не найдена');
    const nextPatch = normalizeYearPlanPatchForStorage(current, patch);
    const updated = { ...current, ...nextPatch, updatedTs: Date.now() };
    stored.items[idx] = updated;
    writeYearPlanStorage(stored.items);
    return Promise.resolve(normalizeYearPlanItem(updated, updated.year));
  },
  remove(id) {
    if (getYearPlanDataMode() === STORAGE_MODES.SERVER) {
      return apiRequest(`/yearplan/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(() => undefined);
    }
    const stored = readYearPlanStorage();
    const nextItems = stored.items.filter(entry => entry && String(entry.id) !== String(id));
    writeYearPlanStorage(nextItems);
    return Promise.resolve();
  }
};

// --- Управление кэшем ---

export function getYearPlanItems(year = yearPlanYear) {
  return yearPlanCache.get(year) || [];
}

export function findYearPlanItem(id, year = yearPlanYear) {
  const list = getYearPlanItems(year);
  return list.find(item => item && item.id === id) || null;
}

export function upsertYearPlanItem(item) {
  if (!item || !item.id) return;
  const year = item.year || yearPlanYear;
  const list = getYearPlanItems(year);
  const idx = list.findIndex(entry => entry && entry.id === item.id);
  if (idx === -1) list.push(item);
  else list[idx] = { ...list[idx], ...item };
  sortYearPlanItems(list);
  yearPlanCache.set(year, list);
}

export function updateYearPlanItemTitle(id, title) {
  const list = getYearPlanItems(yearPlanYear);
  const item = list.find(entry => entry && entry.id === id);
  if (!item) return;
  item.title = title;
  sortYearPlanItems(list);
  yearPlanCache.set(yearPlanYear, list);
}

export function updateYearPlanItemRange(id, { startMonth, startDay, endMonth, endDay }) {
  const list = getYearPlanItems(yearPlanYear);
  const item = list.find(entry => entry && entry.id === id);
  if (!item) return;
  item.startMonth = startMonth;
  item.startDay = startDay;
  item.endMonth = endMonth;
  item.endDay = endDay;
  sortYearPlanItems(list);
  yearPlanCache.set(yearPlanYear, list);
}

export function removeYearPlanItem(id) {
  const list = getYearPlanItems(yearPlanYear);
  const idx = list.findIndex(entry => entry && entry.id === id);
  if (idx === -1) return false;
  list.splice(idx, 1);
  yearPlanCache.set(yearPlanYear, list);
  return true;
}

export function removeYearPlanItemFromCache(id, year) {
  const list = getYearPlanItems(year);
  const idx = list.findIndex(entry => entry && entry.id === id);
  if (idx === -1) return false;
  list.splice(idx, 1);
  yearPlanCache.set(year, list);
  return true;
}

export function updateYearPlanItemInCache(id, year, patch) {
  const list = getYearPlanItems(year);
  const item = list.find(entry => entry && entry.id === id);
  if (!item) return false;
  Object.assign(item, patch);
  sortYearPlanItems(list);
  yearPlanCache.set(year, list);
  return true;
}

// --- Загрузка данных ---

export async function ensureYearPlanData(year, { force = false } = {}) {
  if (!force && yearPlanCache.has(year)) return;
  if (yearPlanLoadingYears.has(year)) return;
  if (force) yearPlanCache.delete(year);
  yearPlanErrors.delete(year);
  yearPlanLoadingYears.add(year);
  renderIfVisible();
  try {
    const items = await yearPlanProvider.list(year);
    yearPlanCache.set(year, normalizeYearPlanList(items, year));
  } catch (err) {
    yearPlanErrors.set(year, err && err.message ? err.message : 'Не удалось загрузить план');
  } finally {
    yearPlanLoadingYears.delete(year);
    renderIfVisible();
  }
}

// --- Удаление ---

export async function deleteYearPlanItem(id) {
  if (!id || yearPlanPendingDeletes.has(id)) return;
  yearPlanPendingDeletes.add(id);
  try {
    await yearPlanProvider.remove(id);
    removeYearPlanItem(id);
    if (yearPlanSelectedId === id) yearPlanSelectedId = null;
    renderIfVisible();
  } catch (err) {
    doToast('Не удалось удалить активность');
  } finally {
    yearPlanPendingDeletes.delete(id);
  }
}

// --- Форма создания ---

export function getDefaultYearPlanFormState() {
  const now = new Date();
  const defaultMonth = now.getFullYear() === yearPlanYear ? now.getMonth() + 1 : 1;
  return { month: defaultMonth, startDay: 1, endDay: 1, title: '' };
}

export function clampYearPlanFormBounds() {
  if (!yearPlanFormState) yearPlanFormState = getDefaultYearPlanFormState();
  const monthIndex = Math.min(11, Math.max(0, Math.trunc((yearPlanFormState.month || 1) - 1)));
  const daysInMonth = getDaysInMonth(yearPlanYear, monthIndex);
  const normalizedStart = Math.max(1, Math.min(daysInMonth, Math.trunc(yearPlanFormState.startDay) || 1));
  const normalizedEndRaw = Math.max(normalizedStart, Math.trunc(yearPlanFormState.endDay) || normalizedStart);
  const normalizedEnd = Math.min(daysInMonth, normalizedEndRaw);
  yearPlanFormState.startDay = normalizedStart;
  yearPlanFormState.endDay = normalizedEnd;
  yearPlanFormState.month = monthIndex + 1;
  return daysInMonth;
}

export function validateYearPlanFormState() {
  const daysInMonth = clampYearPlanFormBounds();
  if (yearPlanFormState.startDay < 1) return 'День начала должен быть не меньше 1';
  if (yearPlanFormState.endDay < yearPlanFormState.startDay) return 'День окончания не может быть раньше начала';
  if (yearPlanFormState.endDay > daysInMonth) return `В ${MONTH_NAMES[yearPlanFormState.month - 1]} только ${daysInMonth} дней`;
  return '';
}

export function closeYearPlanForm() {
  yearPlanFormOpen = false;
  yearPlanFormSubmitting = false;
  yearPlanFormError = '';
  yearPlanFormState = getDefaultYearPlanFormState();
  renderIfVisible();
}

export function openYearPlanForm() {
  yearPlanFormOpen = true;
  yearPlanFormError = '';
  yearPlanFormSubmitting = false;
  yearPlanFormState = getDefaultYearPlanFormState();
  renderIfVisible();
}

export async function submitYearPlanForm(event) {
  event && event.preventDefault();
  if (yearPlanFormSubmitting) return;
  const validationError = validateYearPlanFormState();
  if (validationError) {
    yearPlanFormError = validationError;
    renderIfVisible();
    return;
  }
  yearPlanFormSubmitting = true;
  yearPlanFormError = '';
  renderIfVisible();
  const payload = {
    year: yearPlanYear,
    startMonth: yearPlanFormState.month,
    startDay: yearPlanFormState.startDay,
    endMonth: yearPlanFormState.month,
    endDay: yearPlanFormState.endDay,
    title: yearPlanFormState.title || '',
    color: normalizeYearPlanColor(yearPlanFormState.color)
  };
  try {
    const created = await yearPlanProvider.create(payload);
    if (created) upsertYearPlanItem(created);
    yearPlanFormOpen = false;
    yearPlanFormState = getDefaultYearPlanFormState();
  } catch (err) {
    yearPlanFormError = `Не удалось создать активность${err && err.message ? `: ${err.message}` : ''}`;
  } finally {
    yearPlanFormSubmitting = false;
    renderIfVisible();
  }
}

// --- Получение активностей по проекту ---

export function getYearPlanItemsForProject(projectId) {
  if (!projectId) return [];
  if (!isServerMode()) {
    const stored = readYearPlanStorage();
    const items = [];
    for (const entry of stored.items) {
      const item = normalizeStoredYearPlanItem(entry);
      if (item && item.projectId === projectId) items.push(item);
    }
    sortYearPlanItems(items);
    return items;
  }
  const items = [];
  for (const list of yearPlanCache.values()) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (item && item.projectId === projectId) items.push(item);
    }
  }
  sortYearPlanItems(items);
  return items;
}
