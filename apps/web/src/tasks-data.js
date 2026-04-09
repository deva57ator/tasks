import { MIN_TASK_MINUTES, MAX_TASK_MINUTES, MAX_TASK_TIME_MS, MAX_TASK_DEPTH, TIME_UPDATE_INTERVAL } from './config.js';
import { uid, clampTimeSpentMs } from './utils.js';
import { Store, ActiveTimersStore, isServerMode, storageMode } from './storage.js';
import { queueTaskCreate, queueTaskUpdate, queueTaskDelete } from './api.js';
import {
  workdayState,
  updateWorkdayCompletionState, syncWorkdayTaskSnapshot,
  updateWorkdayUI, updateWorkdayRecIndicator,
} from './workday.js';

// ── Коллбэки ───────────────────────────────────────────────────────────────
const _cb = {};
export function registerTasksDataCallbacks(cbs) { Object.assign(_cb, cbs); }

// ── Состояние ──────────────────────────────────────────────────────────────
export let tasks = [];
export function setTasks(v) { tasks = v; }
export const pendingServerCreates = new Set();

let activeTimersState = {};
let timerInterval = null;

// ── Таймерный стейт ────────────────────────────────────────────────────────
function ensureActiveTimersState() { if (!activeTimersState || typeof activeTimersState !== 'object') activeTimersState = {} }
function persistActiveTimersState() { ensureActiveTimersState(); ActiveTimersStore.write(activeTimersState, { mode: storageMode }) }
function setActiveTimerState(taskId, { start, base } = {}) {
  if (typeof taskId !== 'string' || !taskId) return;
  const normalizedStart = Number(start);
  if (!Number.isFinite(normalizedStart)) return;
  const normalizedBase = Number(base);
  ensureActiveTimersState();
  activeTimersState[taskId] = {
    start: Math.max(0, normalizedStart),
    base: Number.isFinite(normalizedBase) && normalizedBase >= 0 ? clampTimeSpentMs(normalizedBase) : 0,
  };
  persistActiveTimersState();
}
export function removeActiveTimerState(taskId) {
  if (!activeTimersState || typeof activeTimersState !== 'object') return;
  if (!(taskId in activeTimersState)) return;
  delete activeTimersState[taskId];
  persistActiveTimersState();
}

// ── Нормализация и миграция ────────────────────────────────────────────────
export function normalizeTaskTree(list, parentId = null) {
  if (!Array.isArray(list)) return [];
  const normalized = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const node = {
      id: typeof item.id === 'string' ? item.id : uid(),
      title: typeof item.title === 'string' ? item.title : '',
      done: item.done === true,
      due: typeof item.due === 'string' && item.due ? item.due : null,
      project: typeof item.project === 'string' && item.project ? item.project : null,
      notes: typeof item.notes === 'string' ? item.notes : '',
      timeSpent: clampTimeSpentMs(item.timeSpent),
      parentId,
      children: normalizeTaskTree(item.children || [], typeof item.id === 'string' ? item.id : null),
      collapsed: item.collapsed === true,
      timerActive: false,
      timerStart: null,
    };
    normalized.push(node);
  }
  return normalized;
}

export function ensureTaskParentIds(list, parentId = null) {
  if (!Array.isArray(list)) return;
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    item.parentId = parentId;
    if (Array.isArray(item.children)) ensureTaskParentIds(item.children, item.id);
  }
}

export function migrate(list, depth = 0) {
  const extras = [];
  for (const t of list) {
    if (!Array.isArray(t.children)) t.children = [];
    if (typeof t.collapsed !== 'boolean') t.collapsed = false;
    if (typeof t.done !== 'boolean') t.done = false;
    if (!('due' in t)) t.due = null;
    if (!('project' in t)) t.project = null;
    if (typeof t.notes !== 'string') t.notes = '';
    if (typeof t.timeSpent !== 'number' || !isFinite(t.timeSpent) || t.timeSpent < 0) t.timeSpent = 0;
    t.timeSpent = clampTimeSpentMs(t.timeSpent);
    if (typeof t.timerActive !== 'boolean') t.timerActive = false;
    if (typeof t.timerStart !== 'number' || !isFinite(t.timerStart)) t.timerStart = null;
    if (t.children.length) {
      migrate(t.children, depth + 1);
      if (depth >= MAX_TASK_DEPTH) { extras.push(...t.children); t.children = [] }
    }
  }
  if (extras.length) list.push(...extras);
  return list;
}

// ── Дерево задач ───────────────────────────────────────────────────────────
export function findTask(id, list = tasks) { for (const t of list) { if (t.id === id) return t; const r = findTask(id, t.children || []); if (r) return r } return null }
export function walkTasks(list, cb) { if (!Array.isArray(list)) return; for (const item of list) { if (!item) continue; cb(item); if (Array.isArray(item.children) && item.children.length) walkTasks(item.children, cb) } }
export function getTaskDepth(id, list = tasks, depth = 0) { for (const t of list) { if (t.id === id) return depth; const childDepth = getTaskDepth(id, t.children || [], depth + 1); if (childDepth !== -1) return childDepth } return -1 }
export function getSubtreeDepth(task) { if (!task || !Array.isArray(task.children) || !task.children.length) return 0; let max = 0; for (const child of task.children) { const d = 1 + getSubtreeDepth(child); if (d > max) max = d } return max }
export function containsTask(root, targetId) { if (!root || !targetId) return false; if (root.id === targetId) return true; if (!Array.isArray(root.children)) return false; for (const child of root.children) { if (containsTask(child, targetId)) return true } return false }
export function detachTaskFromTree(id, list = tasks) { if (!Array.isArray(list)) return null; for (let i = 0; i < list.length; i++) { const item = list[i]; if (item.id === id) { const pulled = list.splice(i, 1)[0]; if (pulled) pulled.parentId = null; return pulled } const pulled = detachTaskFromTree(id, item.children || []); if (pulled) { if (item.children && item.children.length === 0) item.collapsed = false; return pulled } } return null }

// ── Таймеры ────────────────────────────────────────────────────────────────
export function totalTimeMs(task, now = Date.now()) {
  if (!task) return 0;
  const base = clampTimeSpentMs(task.timeSpent);
  if (task.timerActive && typeof task.timerStart === 'number' && isFinite(task.timerStart)) {
    return clampTimeSpentMs(base + Math.max(0, now - task.timerStart));
  }
  return base;
}
export function hasActiveTimer(list = tasks) { if (!Array.isArray(list)) return false; for (const item of list) { if (item && item.timerActive) return true; if (item && Array.isArray(item.children) && item.children.length && hasActiveTimer(item.children)) return true } return false }
function ensureTimerLoop() { if (timerInterval) return; timerInterval = setInterval(() => _cb.syncDisplays?.(), TIME_UPDATE_INTERVAL) }
function stopTimerLoop() { if (timerInterval) { clearInterval(timerInterval); timerInterval = null } }
export function syncTimerLoop() { if (hasActiveTimer()) ensureTimerLoop(); else stopTimerLoop(); _cb.syncDisplays?.() }

export function stopTaskTimer(task, { silent = false, skipServer = false } = {}) {
  if (!task || !task.timerActive) return;
  const now = Date.now();
  if (typeof task.timerStart === 'number' && isFinite(task.timerStart)) { task.timeSpent = totalTimeMs(task, now) }
  if (typeof task.timeSpent !== 'number' || !isFinite(task.timeSpent)) task.timeSpent = 0;
  task.timeSpent = clampTimeSpentMs(task.timeSpent);
  task.timerActive = false; task.timerStart = null;
  removeActiveTimerState(task.id);
  if (!silent) { Store.write(tasks); if (isServerMode() && !skipServer) queueTaskUpdate(task.id, { timeSpent: task.timeSpent }) }
}
export function stopAllTimersExcept(activeId, list = tasks) { if (!Array.isArray(list)) return; for (const item of list) { if (!item) continue; if (item.timerActive && item.id !== activeId) { stopTaskTimer(item, { silent: true }) } if (Array.isArray(item.children) && item.children.length) { stopAllTimersExcept(activeId, item.children) } } }
export function startTaskTimer(task) {
  if (!task || task.timerActive) return;
  if (_cb.getTaskMinutes?.(task) >= MAX_TASK_MINUTES) { _cb.toast?.('Достигнут лимит времени задачи'); return }
  stopAllTimersExcept(task.id);
  const now = Date.now(); const base = clampTimeSpentMs(task.timeSpent);
  task.timerActive = true; task.timerStart = now;
  setActiveTimerState(task.id, { start: now, base });
  Store.write(tasks); syncTimerLoop();
}
export function toggleTaskTimer(id) {
  const task = findTask(id); if (!task) return;
  if (_cb.isTimeUpdatePending?.(id) || (_cb.getTimeDialogTaskId?.() === id && _cb.isTimeDialogOpen?.())) return;
  if (task.timerActive) {
    stopTaskTimer(task, { silent: true }); Store.write(tasks);
    if (isServerMode()) queueTaskUpdate(task.id, { timeSpent: task.timeSpent });
    syncTimerLoop();
  } else { startTaskTimer(task) }
}

export function restoreActiveTimersFromStore() {
  activeTimersState = ActiveTimersStore.read({ mode: storageMode });
  ensureActiveTimersState();
  let changed = false;
  if (!Object.keys(activeTimersState).length) { return }
  for (const [taskId, entry] of Object.entries(activeTimersState)) {
    const task = findTask(taskId);
    const start = Number(entry && entry.start);
    if (!task || !Number.isFinite(start)) { delete activeTimersState[taskId]; changed = true; continue }
    const normalizedStart = Math.max(0, start);
    const storedBase = Number(entry && entry.base);
    const normalizedStoredBase = Number.isFinite(storedBase) && storedBase >= 0 ? clampTimeSpentMs(storedBase) : 0;
    const currentBase = clampTimeSpentMs(task.timeSpent);
    const finalBase = Math.min(MAX_TASK_TIME_MS, Math.max(currentBase, normalizedStoredBase));
    const baseDelta = finalBase - normalizedStoredBase;
    let nextStart = normalizedStart;
    if (baseDelta > 0) { const now = Date.now(); const candidate = normalizedStart + baseDelta; nextStart = Number.isFinite(candidate) && candidate >= 0 ? Math.min(candidate, now) : now }
    if (task.timerActive !== true || typeof task.timerStart !== 'number' || task.timerStart !== nextStart) { task.timerActive = true; task.timerStart = nextStart; changed = true }
    if (currentBase !== finalBase) { task.timeSpent = finalBase; changed = true }
    if (finalBase !== normalizedStoredBase || nextStart !== normalizedStart) { activeTimersState[taskId] = { start: nextStart, base: finalBase }; changed = true }
  }
  if (changed) persistActiveTimersState();
}

// ── CRUD задач ─────────────────────────────────────────────────────────────
export function addTask(title) {
  title = String(title || '').trim(); if (!title) return;
  const currentView = _cb.getCurrentView?.();
  const currentProjectId = _cb.getCurrentProjectId?.();
  const projectsList = _cb.getProjects?.() ?? [];
  let assignedProject = null;
  if (currentView === 'project' && currentProjectId) {
    if (projectsList.some(p => p && p.id === currentProjectId)) assignedProject = currentProjectId;
  }
  let dueDate = null;
  if (currentView === 'today') { const today = new Date(); today.setHours(0, 0, 0, 0); dueDate = today.toISOString() }
  const task = { id: uid(), title, done: false, children: [], collapsed: false, due: dueDate, project: assignedProject, notes: '', timeSpent: 0, timerActive: false, timerStart: null, parentId: null };
  tasks.unshift(task); Store.write(tasks);
  if (isServerMode()) queueTaskCreate(task);
  _cb.render?.();
}

export function addSubtask(parentId) {
  const p = findTask(parentId); if (!p) return;
  const depth = getTaskDepth(parentId);
  if (depth === -1 || depth >= MAX_TASK_DEPTH) { _cb.toast?.('Максимальная вложенность — три уровня'); return }
  const inheritedProject = typeof p.project === 'undefined' ? null : p.project;
  const inheritedDue = typeof p.due === 'string' && p.due ? p.due : null;
  const child = { id: uid(), title: '', done: false, children: [], collapsed: false, due: inheritedDue, project: inheritedProject, notes: '', timeSpent: 0, timerActive: false, timerStart: null, parentId };
  p.children.push(child); p.collapsed = false;
  _cb.setSelectedTaskId?.(child.id);
  Store.write(tasks);
  if (isServerMode()) pendingServerCreates.add(child.id);
  _cb.setPendingEditId?.(child.id);
  _cb.render?.();
}

export function toggleTask(id) {
  const t = findTask(id); if (!t) return;
  const now = Date.now(); const wasDone = t.done; const nextDone = !wasDone;
  t.done = nextDone;
  updateWorkdayCompletionState(t, nextDone, now);
  if (nextDone) stopTaskTimer(t, { silent: true });
  if (nextDone) _cb.markRecentlyCompleted?.(id);
  else _cb.unmarkRecentlyCompleted?.(id);
  Store.write(tasks);
  if (isServerMode()) { const payload = { done: nextDone }; if (nextDone && typeof t.timeSpent === 'number') payload.timeSpent = t.timeSpent; queueTaskUpdate(id, payload) }
  syncTimerLoop(); _cb.render?.();
  _cb.handleTaskCompletionEffects?.(id, { completed: !wasDone && nextDone, undone: wasDone && !nextDone });
  _cb.toast?.(nextDone ? 'Отмечено как выполнено' : 'Снята отметка выполнения');
}

export function markTaskDone(id) {
  const t = findTask(id); if (!t) return;
  if (t.done) { _cb.toast?.('Задача уже выполнена'); return }
  const now = Date.now(); t.done = true;
  updateWorkdayCompletionState(t, true, now);
  stopTaskTimer(t, { silent: true });
  _cb.markRecentlyCompleted?.(id);
  Store.write(tasks);
  if (isServerMode()) { const payload = { done: true }; if (typeof t.timeSpent === 'number') payload.timeSpent = t.timeSpent; queueTaskUpdate(id, payload) }
  syncTimerLoop(); _cb.render?.();
  _cb.handleTaskCompletionEffects?.(id, { completed: true });
  _cb.toast?.('Отмечено как выполнено');
}

export function deleteTask(id, list = tasks) { if (!Array.isArray(list)) return null; for (let i = 0; i < list.length; i++) { const item = list[i]; if (item.id === id) { const removed = list.splice(i, 1)[0]; return removed || null } const childRemoved = deleteTask(id, item.children || []); if (childRemoved) return childRemoved } return null }

export function handleDelete(id, { visibleOrder = null } = {}) {
  if (!Array.isArray(visibleOrder)) visibleOrder = _cb.getVisibleTaskIds?.() ?? [];
  const target = findTask(id);
  if (target) stopTaskTimer(target, { silent: true });
  const removed = deleteTask(id, tasks); if (!removed) return;
  const wasPendingCreate = pendingServerCreates.delete(id);
  if (_cb.getNotesTaskId?.() === id) _cb.closeNotesPanel?.();
  let nextId = null;
  if (visibleOrder) {
    const idx = visibleOrder.indexOf(id);
    if (idx !== -1) {
      for (let i = idx + 1; i < visibleOrder.length; i++) { const cand = visibleOrder[i]; if (cand && cand !== id && findTask(cand)) { nextId = cand; break } }
      if (!nextId) { for (let i = idx - 1; i >= 0; i--) { const cand = visibleOrder[i]; if (cand && cand !== id && findTask(cand)) { nextId = cand; break } } }
    }
  }
  if (nextId) { _cb.setSelectedTaskId?.(nextId) } else if (_cb.getSelectedTaskId?.() === id) { _cb.setSelectedTaskId?.(null) }
  Store.write(tasks);
  if (isServerMode() && !wasPendingCreate) queueTaskDelete(id);
  syncTimerLoop(); _cb.render?.();
}

export function renameTask(id, title) {
  const t = findTask(id); if (!t) return;
  const v = String(title || '').trim();
  if (v && v !== t.title) {
    t.title = v;
    _cb.updateNotePanelTitle?.(id, v);
    Store.write(tasks);
    if (isServerMode()) {
      if (pendingServerCreates.has(id)) { queueTaskCreate(t); pendingServerCreates.delete(id) }
      else queueTaskUpdate(id, { title: v });
    }
  }
  _cb.render?.();
}

export function toggleCollapse(id) { const t = findTask(id); if (!t) return; t.collapsed = !t.collapsed; Store.write(tasks); _cb.render?.() }

// ── После сохранения задач ─────────────────────────────────────────────────
export function afterTasksPersisted() { syncWorkdayTaskSnapshot(); updateWorkdayUI() }
