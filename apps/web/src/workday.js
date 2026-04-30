import { WORKDAY_REFRESH_INTERVAL, WORKDAY_TIMEZONE_OFFSET_MINUTES } from './config.js';
import { WorkdayStore, Store, normalizeWorkdayState, persistLocalWorkdayState, isServerMode } from './storage.js';
import { apiRequest, handleApiError, runServerAction, queueTaskUpdate } from './api.js';

const _cb = {};
export function registerWorkdayCallbacks(cbs) { Object.assign(_cb, cbs); }
// Callbacks: toast, render, getTasks,
//            findTask, walkTasks, totalTimeMs, hasActiveTimer,
//            stopAllTimersExcept, syncTimerLoop, getProjectMeta,
//            isMotionReduced, formatDuration, formatTimeHM, formatDateDMY,
//            refreshDataForCurrentMode, closeNotesPanel,
//            getNotesTaskId, getSelectedTaskId, setSelectedTaskId

export const WorkdayUI = {
  bar: document.getElementById('workdayBar'),
  done: document.getElementById('workdayDone'),
  time: document.getElementById('workdayTime'),
  rec: document.getElementById('workdayRec'),
  button: document.getElementById('workdayFinishBtn'),
  overlay: document.getElementById('workdayOverlay'),
  dialog: document.querySelector('.workday-dialog'),
  fireworksCanvas: document.getElementById('workdayFireworks'),
  range: document.getElementById('workdayDialogRange'),
  summaryTime: document.getElementById('workdaySummaryTime'),
  summaryDone: document.getElementById('workdaySummaryDone'),
  completedSection: document.getElementById('workdayCompletedSection'),
  completedList: document.getElementById('workdayCompletedList'),
  completedEmpty: document.getElementById('workdayDialogCompletedEmpty'),
  pendingList: document.getElementById('workdayPendingList'),
  emptyState: document.getElementById('workdayDialogEmpty'),
  postponeBtn: document.getElementById('workdayPostponeBtn'),
  closeBtn: document.getElementById('workdayDialogClose'),
  closeAction: document.getElementById('workdayDialogDone'),
  title: document.getElementById('workdayDialogTitle'),
};

export let workdayState = null;
export function setWorkdayState(v) { workdayState = v; }

function cloneWorkdayStateForTransport(state) {
  if (!state || typeof state !== 'object') return null;
  try { return JSON.parse(JSON.stringify(state)); } catch { return { ...state }; }
}

export function buildWorkdayPayloadForServer(state) {
  if (!state || !state.id) return null;
  const summary = computeAggregatedWorkdayStats(Date.now(), { persist: false, allowBaselineUpdate: false }) || { timeMs: 0, doneCount: 0 };
  const payloadState = cloneWorkdayStateForTransport(state);
  if (!payloadState) return null;
  return {
    id: state.id,
    startTs: typeof state.start === 'number' && isFinite(state.start) ? state.start : null,
    endTs: typeof state.end === 'number' && isFinite(state.end) ? state.end : null,
    summaryTimeMs: Math.max(0, Number(summary.timeMs) || 0),
    summaryDone: Math.max(0, Number(summary.doneCount) || 0),
    payload: payloadState,
    closedAt: typeof state.closedAt === 'number' && isFinite(state.closedAt) ? state.closedAt : null,
  };
}

export function hydrateWorkdayStateFromServer(record) {
  if (!record) {
    const fallback = WorkdayStore.read();
    return fallback ? normalizeWorkdayState(cloneWorkdayStateForTransport(fallback)) : null;
  }
  const payloadHasLocked = record.payload && Object.prototype.hasOwnProperty.call(record.payload, 'locked');
  const payloadHasReopenedAt = record.payload && Object.prototype.hasOwnProperty.call(record.payload, 'reopenedAt');
  const payloadState = normalizeWorkdayState(record.payload);
  const summaryTimeMs = Math.max(0, Number(record.summaryTimeMs) || 0);
  const summaryDone = Math.max(0, Math.round(Number(record.summaryDone) || 0));
  const closedAt = typeof record.closedAt === 'number' && isFinite(record.closedAt) ? record.closedAt : null;
  const startTs = Number.isFinite(Number(record.startTs)) ? Number(record.startTs) : null;
  const endTs = Number.isFinite(Number(record.endTs)) ? Number(record.endTs) : null;
  const payloadLocked = payloadState && payloadHasLocked ? payloadState.locked === true : null;
  const payloadReopenedAt = payloadState && payloadHasReopenedAt && typeof payloadState.reopenedAt === 'number' && isFinite(payloadState.reopenedAt) ? payloadState.reopenedAt : null;
  let state = payloadState;
  if (!state) {
    const localSnapshot = WorkdayStore.read();
    if (localSnapshot && (!record.id || localSnapshot.id === record.id)) {
      state = normalizeWorkdayState(cloneWorkdayStateForTransport(localSnapshot));
    }
  }
  if (!state) {
    if (!record.id) return null;
    state = { id: record.id, start: startTs, end: endTs, baseline: {}, completed: {}, closedAt, finalTimeMs: summaryTimeMs, finalDoneCount: summaryDone, locked: closedAt !== null, closedManually: false, manualClosedStats: { timeMs: 0, doneCount: 0 }, reopenedAt: payloadHasReopenedAt ? payloadReopenedAt : null };
  } else {
    if (record.id && typeof state.id !== 'string') state.id = String(record.id);
    if (startTs !== null) state.start = startTs; else if (state.start === undefined) state.start = null;
    if (endTs !== null) state.end = endTs; else if (state.end === undefined) state.end = null;
    if (closedAt !== null) state.closedAt = closedAt; else state.closedAt = null;
    if (payloadHasLocked && payloadLocked !== null) state.locked = payloadLocked; else if (state.locked === undefined) state.locked = closedAt !== null;
    if (!state.manualClosedStats) state.manualClosedStats = { timeMs: summaryTimeMs, doneCount: summaryDone };
    if (payloadHasReopenedAt) state.reopenedAt = payloadReopenedAt;
    if (state.closedAt === null && state.locked && !state.closedManually) { state.locked = false; }
    if (state.closedManually !== true) state.closedManually = false;
  }
  if (!state.baseline) state.baseline = {};
  if (!state.completed) state.completed = {};
  if (typeof state.finalTimeMs !== 'number') state.finalTimeMs = summaryTimeMs;
  if (typeof state.finalDoneCount !== 'number') state.finalDoneCount = summaryDone;
  return state;
}

export function isWorkdayClosedForEditing() {
  if (!workdayState) return false;
  if (workdayState.locked === true) return true;
  const hasClosedAt = workdayState.closedAt !== null && workdayState.closedAt !== undefined;
  return hasClosedAt;
}

let workdayReopenPromptActive = false;
let workdayReopenPromise = null;

async function reopenWorkdayOnServer() {
  if (!workdayState) return false;
  const payload = buildWorkdayPayloadForServer(workdayState);
  if (payload && payload.payload) {
    payload.payload.locked = false;
    payload.payload.closedAt = null;
    payload.payload.closedManually = false;
    payload.payload.baseline = {};
    payload.payload.completed = {};
    payload.payload.reopenedAt = Date.now();
  }
  if (!isServerMode()) {
    const reopenTs = Date.now();
    workdayState.closedAt = null;
    workdayState.locked = false;
    workdayState.closedManually = false;
    workdayState.reopenedAt = reopenTs;
    resetWorkdaySnapshotAfterReopen(reopenTs);
    WorkdayStore.write(workdayState);
    syncWorkdayTaskSnapshot();
    updateWorkdayUI();
    return true;
  }
  if (!payload) return false;
  try {
    const response = await apiRequest('/workday/reopen', { method: 'POST', body: { workday: payload } });
    const serverWorkday = response && response.workday ? response.workday : null;
    workdayState = hydrateWorkdayStateFromServer(serverWorkday);
    persistLocalWorkdayState(workdayState);
    syncWorkdayTaskSnapshot();
    updateWorkdayUI();
    return true;
  } catch (err) {
    handleApiError(err, 'Не удалось открыть день');
    return false;
  }
}

export async function promptToReopenWorkday() {
  if (!isWorkdayClosedForEditing()) return true;
  if (workdayReopenPromptActive) return false;
  if (workdayReopenPromise) return workdayReopenPromise;
  workdayReopenPromptActive = true;
  const confirmed = window.confirm('День уже завершён. Открыть его для редактирования?');
  workdayReopenPromptActive = false;
  if (!confirmed) {
    _cb.toast?.('Изменения не применены — день закрыт');
    return false;
  }
  workdayReopenPromise = reopenWorkdayOnServer();
  const result = await workdayReopenPromise;
  workdayReopenPromise = null;
  if (result) { _cb.toast?.('Рабочий день снова открыт'); }
  return result;
}

const WORKDAY_MUTATION_SCOPES = ['#tasks', '.composer', '#notesSidebar', '#notesOverlay', '#timeOverlay', '.context-menu', '#ctxSub', '#dueMenu', '.workday-dialog'];
const WORKDAY_INTERACTIVE_SELECTOR = 'button, input, textarea, [contenteditable="true"], .task, .proj-input, .timer-btn, .note-btn, .workday-dialog-action, .workday-dialog-secondary';

function isWorkMutationTarget(node) {
  if (!node) return false;
  if (!WORKDAY_MUTATION_SCOPES.some(selector => node.closest(selector))) return false;
  if (node.closest('[data-allow-closed-day="true"]')) return false;
  return !!node.closest(WORKDAY_INTERACTIVE_SELECTOR);
}

function handleClosedWorkdayPointer(event) {
  if (!isWorkdayClosedForEditing()) return;
  if (!isWorkMutationTarget(event.target)) return;
  event.preventDefault();
  event.stopPropagation();
  promptToReopenWorkday();
}

function handleClosedWorkdayClick(event) {
  if (!isWorkdayClosedForEditing()) return;
  if (!isWorkMutationTarget(event.target)) return;
  event.preventDefault();
  event.stopPropagation();
}

function handleClosedWorkdayKey(event) {
  if (!isWorkdayClosedForEditing()) return;
  if (!isWorkMutationTarget(event.target)) return;
  if (event.key === 'Tab' || event.key === 'Escape' || event.key === 'Shift' || event.key === 'Control' || event.key === 'Alt' || event.key === 'Meta') return;
  event.preventDefault();
  event.stopPropagation();
  promptToReopenWorkday();
}

let workdayGuardsAttached = false;
export function ensureWorkdayInteractionGuards() {
  if (workdayGuardsAttached) return;
  workdayGuardsAttached = true;
  document.addEventListener('pointerdown', handleClosedWorkdayPointer, true);
  document.addEventListener('click', handleClosedWorkdayClick, true);
  document.addEventListener('keydown', handleClosedWorkdayKey, true);
}

// --- Fireworks ---

let workdayFireworksController = null;

function createWorkdayFireworks(canvas) {
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const particles = [];
  const palette = ['#ff4d00', '#ffb400', '#ffe45e', '#ff61b6', '#7cffcb', '#5ce1ff', '#9c42ff', '#ff355e'];
  const spawnInterval = 420;
  const gravity = 72;
  let width = 0, height = 0, dpr = window.devicePixelRatio || 1;
  let rafId = 0, running = false, lastSpawn = 0, lastTime = 0;
  function resize() {
    const overlay = WorkdayUI.overlay || canvas.parentElement;
    const rect = overlay ? overlay.getBoundingClientRect() : canvas.getBoundingClientRect();
    width = rect.width; height = rect.height; dpr = window.devicePixelRatio || 1;
    const scaledWidth = Math.max(1, Math.round(width * dpr));
    const scaledHeight = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== scaledWidth || canvas.height !== scaledHeight) { canvas.width = scaledWidth; canvas.height = scaledHeight; }
    canvas.style.width = `${Math.max(0, width)}px`;
    canvas.style.height = `${Math.max(0, height)}px`;
  }
  function clearCanvas() {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over'; ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  function pickSideSpawnX() {
    const overlay = WorkdayUI.overlay || canvas.parentElement;
    const dialog = WorkdayUI.dialog;
    if (!overlay || !dialog) return null;
    const overlayRect = overlay.getBoundingClientRect();
    const dialogRect = dialog.getBoundingClientRect();
    if (!overlayRect.width || !dialogRect.width) return null;
    const padding = 24;
    const leftLimit = Math.max(0, dialogRect.left - overlayRect.left - padding);
    const rightStart = Math.min(overlayRect.width, dialogRect.right - overlayRect.left + padding);
    const minBand = 40;
    const ranges = [];
    if (leftLimit > minBand) ranges.push([0, leftLimit]);
    if (overlayRect.width - rightStart > minBand) ranges.push([rightStart, overlayRect.width]);
    if (!ranges.length) return null;
    const [minX, maxX] = ranges[Math.floor(Math.random() * ranges.length)];
    return minX + Math.random() * Math.max(1, maxX - minX);
  }
  function spawnFirework() {
    if (width <= 0 || height <= 0) return;
    const sideX = pickSideSpawnX();
    const x = typeof sideX === 'number' ? sideX : (Math.random() < 0.5 ? Math.random() * width * 0.3 : width * (0.7 + Math.random() * 0.3));
    const y = height * (0.18 + Math.random() * 0.46);
    const color = palette[Math.floor(Math.random() * palette.length)];
    const count = 24 + Math.floor(Math.random() * 18);
    const baseSpeed = 140 + Math.random() * 160;
    const ttl = 0.95 + Math.random() * 0.35;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = baseSpeed * (0.65 + Math.random() * 0.35);
      const sparkle = Math.random() > 0.45;
      particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 0, ttl, size: 1.5 + Math.random() * 1.6, color, sparkle, sparkleScale: sparkle ? 0.72 + Math.random() * 0.22 : 1 });
    }
  }
  function step(now) {
    if (!running) return;
    if (!lastTime) lastTime = now;
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;
    if (now - lastSpawn > spawnInterval) { spawnFirework(); lastSpawn = now; }
    const overlay = WorkdayUI.overlay || canvas.parentElement;
    if (overlay) { const rect = overlay.getBoundingClientRect(); if (rect.width !== width || rect.height !== height) resize(); }
    clearCanvas();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    const next = [];
    for (const particle of particles) {
      const life = particle.life + dt;
      if (life >= particle.ttl) continue;
      particle.life = life; particle.vy += gravity * dt; particle.x += particle.vx * dt; particle.y += particle.vy * dt;
      const progress = particle.life / particle.ttl;
      const fadeStart = 0.65;
      const alpha = progress < fadeStart ? 1 : Math.max(0, 1 - (progress - fadeStart) / (1 - fadeStart));
      const size = particle.size * (1 - progress * 0.45);
      ctx.globalAlpha = alpha * (particle.sparkleScale || 1);
      ctx.shadowColor = particle.color; ctx.shadowBlur = particle.sparkle ? 18 : 10;
      ctx.fillStyle = particle.color; ctx.beginPath(); ctx.arc(particle.x, particle.y, Math.max(0.4, size), 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0; next.push(particle);
    }
    particles.length = 0; particles.push(...next);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    rafId = requestAnimationFrame(step);
  }
  return {
    start() {
      if (running) return;
      if (!canvas.isConnected) { canvas.classList.remove('is-active'); return; }
      if (_cb.isMotionReduced?.()) { canvas.classList.remove('is-active'); clearCanvas(); return; }
      running = true; particles.length = 0; lastSpawn = 0; lastTime = 0;
      resize(); clearCanvas(); canvas.classList.add('is-active');
      window.addEventListener('resize', resize);
      rafId = requestAnimationFrame(step);
    },
    stop() {
      if (running) {
        running = false; window.removeEventListener('resize', resize);
        if (rafId) cancelAnimationFrame(rafId); rafId = 0; lastSpawn = 0; lastTime = 0; particles.length = 0;
      }
      clearCanvas(); canvas.classList.remove('is-active');
    },
  };
}

function ensureWorkdayFireworks() {
  if (!WorkdayUI.fireworksCanvas) return null;
  if (!workdayFireworksController) workdayFireworksController = createWorkdayFireworks(WorkdayUI.fireworksCanvas);
  return workdayFireworksController;
}
function startWorkdayFireworks() { const c = ensureWorkdayFireworks(); if (c) c.start(); }
function stopWorkdayFireworks() { const c = ensureWorkdayFireworks(); if (c) c.stop(); }

// --- Core workday logic ---

const WORKDAY_START_HOUR = 6;
const WORKDAY_END_HOUR = 3;
const WORKDAY_TIMEZONE_OFFSET_MS = WORKDAY_TIMEZONE_OFFSET_MINUTES * 60 * 1000;

function getWorkdayZonedDate(value) {
  const ts = value instanceof Date ? value.getTime() : Number(value);
  if (!Number.isFinite(ts)) return null;
  return new Date(ts + WORKDAY_TIMEZONE_OFFSET_MS);
}

function getWorkdayZonedParts(value) {
  const shifted = getWorkdayZonedDate(value);
  if (!shifted || Number.isNaN(shifted.getTime())) return null;
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
  };
}

function zonedWorkdayTimeToTimestamp(year, month, day, hour) {
  return Date.UTC(year, month, day, hour, 0, 0, 0) - WORKDAY_TIMEZONE_OFFSET_MS;
}

function zonedDayStartIsoForWorkdayDate(value, dayOffset = 0) {
  const parts = getWorkdayZonedParts(value);
  if (!parts) return null;
  return new Date(zonedWorkdayTimeToTimestamp(parts.year, parts.month, parts.day + dayOffset, 0)).toISOString();
}

export function workdayDateKey(value) {
  const parts = getWorkdayZonedParts(value);
  if (!parts) return null;
  return `${parts.year}-${String(parts.month + 1).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function getWorkdayInfo(now = Date.now()) {
  const current = getWorkdayZonedParts(now);
  if (!current) return { state: 'waiting', start: null, end: null, id: null, nextStart: null };
  const hour = current.hour;
  if (hour < WORKDAY_END_HOUR) {
    const start = zonedWorkdayTimeToTimestamp(current.year, current.month, current.day - 1, WORKDAY_START_HOUR);
    const end = zonedWorkdayTimeToTimestamp(current.year, current.month, current.day, WORKDAY_END_HOUR);
    return { state: 'active', start, end, id: workdayDateKey(start) };
  }
  if (hour >= WORKDAY_START_HOUR) {
    const start = zonedWorkdayTimeToTimestamp(current.year, current.month, current.day, WORKDAY_START_HOUR);
    const end = zonedWorkdayTimeToTimestamp(current.year, current.month, current.day + 1, WORKDAY_END_HOUR);
    return { state: 'active', start, end, id: workdayDateKey(start) };
  }
  const start = zonedWorkdayTimeToTimestamp(current.year, current.month, current.day - 1, WORKDAY_START_HOUR);
  const end = zonedWorkdayTimeToTimestamp(current.year, current.month, current.day, WORKDAY_END_HOUR);
  const nextStart = zonedWorkdayTimeToTimestamp(current.year, current.month, current.day, WORKDAY_START_HOUR);
  return { state: 'waiting', start, end, id: workdayDateKey(start), nextStart };
}

function createWorkdaySnapshot(info) {
  const baseline = {};
  _cb.walkTasks?.(_cb.getTasks?.() || [], item => { baseline[item.id] = _cb.totalTimeMs?.(item, info.start) ?? 0; });
  return { id: info.id, start: info.start, end: info.end, baseline, completed: {}, closedAt: null, finalTimeMs: 0, finalDoneCount: 0, locked: false, closedManually: false, manualClosedStats: { timeMs: 0, doneCount: 0 } };
}

export function syncWorkdayTaskSnapshot() {
  if (!workdayState || workdayState.locked) return;
  let changed = false;
  const baseline = workdayState.baseline || (workdayState.baseline = {});
  const seen = new Set();
  _cb.walkTasks?.(_cb.getTasks?.() || [], item => {
    seen.add(item.id);
    if (!(item.id in baseline)) { baseline[item.id] = _cb.totalTimeMs?.(item, workdayState.start) ?? 0; changed = true; }
    else { const current = _cb.totalTimeMs?.(item) ?? 0; if (current < baseline[item.id]) { baseline[item.id] = current; changed = true; } }
  });
  for (const id of Object.keys(baseline)) { if (!seen.has(id)) { delete baseline[id]; changed = true; } }
  const completed = workdayState.completed || (workdayState.completed = {});
  for (const id of Object.keys(completed)) { const task = _cb.findTask?.(id); if (!task || !task.done) { delete completed[id]; changed = true; } }
  if (changed) WorkdayStore.write(workdayState);
}

function resetWorkdaySnapshotAfterReopen(now = Date.now()) {
  if (!workdayState) return;
  const baseline = {};
  _cb.walkTasks?.(_cb.getTasks?.() || [], item => { baseline[item.id] = _cb.totalTimeMs?.(item, now) ?? 0; });
  workdayState.baseline = baseline;
  workdayState.completed = {};
}

function computeWorkdayProgress(now = Date.now(), { persist = true, allowBaselineUpdate = true } = {}) {
  if (!workdayState) return { timeMs: 0, doneCount: 0 };
  const baseline = workdayState.baseline || (workdayState.baseline = {});
  const seen = new Set();
  let total = 0, changed = false;
  _cb.walkTasks?.(_cb.getTasks?.() || [], item => {
    const id = item.id; seen.add(id);
    let baseValue = baseline[id];
    if (baseValue === undefined) { if (!allowBaselineUpdate) return; baseValue = _cb.totalTimeMs?.(item, workdayState.start) ?? 0; baseline[id] = baseValue; changed = true; }
    let current = _cb.totalTimeMs?.(item, now) ?? 0;
    if (allowBaselineUpdate && current < baseValue) { baseline[id] = current; baseValue = current; changed = true; }
    const diff = current - baseValue; if (diff > 0) total += diff;
  });
  if (allowBaselineUpdate) { for (const id of Object.keys(baseline)) { if (!seen.has(id)) { delete baseline[id]; changed = true; } } }
  const completed = workdayState.completed || (workdayState.completed = {});
  let doneCount = 0;
  for (const id of Object.keys(completed)) {
    const task = _cb.findTask?.(id);
    if (task && task.done) { doneCount++; } else if (allowBaselineUpdate) { delete completed[id]; changed = true; }
  }
  if (persist && changed) WorkdayStore.write(workdayState);
  return { timeMs: total, doneCount };
}

function getManualWorkdayStats() {
  if (!workdayState || !workdayState.manualClosedStats) return { timeMs: 0, doneCount: 0 };
  const timeMs = typeof workdayState.manualClosedStats.timeMs === 'number' && isFinite(workdayState.manualClosedStats.timeMs) ? Math.max(0, workdayState.manualClosedStats.timeMs) : 0;
  const doneCount = typeof workdayState.manualClosedStats.doneCount === 'number' && isFinite(workdayState.manualClosedStats.doneCount) ? Math.max(0, Math.round(workdayState.manualClosedStats.doneCount)) : 0;
  return { timeMs, doneCount };
}

export function computeAggregatedWorkdayStats(now = Date.now(), options) {
  const base = getManualWorkdayStats();
  let delta = { timeMs: 0, doneCount: 0 };
  const endTs = workdayState && typeof workdayState.end === 'number' && isFinite(workdayState.end) ? workdayState.end : null;
  let includeDelta = false;
  if (workdayState) { includeDelta = workdayState.closedManually !== true && workdayState.locked !== true; }
  if (includeDelta && endTs !== null && now > endTs) { includeDelta = false; }
  if (includeDelta) { delta = computeWorkdayProgress(now, options); }
  return { timeMs: base.timeMs + delta.timeMs, doneCount: base.doneCount + delta.doneCount, base, delta };
}

export function updateWorkdayCompletionState(task, done, now = Date.now()) {
  if (!task) return;
  const info = ensureWorkdayState(now);
  if (!workdayState) return;
  const completed = workdayState.completed || (workdayState.completed = {});
  let changed = false;
  if (done) {
    if (info.state === 'active' && workdayState.id === info.id && !completed[task.id]) { completed[task.id] = now; changed = true; }
  } else if (completed[task.id]) { delete completed[task.id]; changed = true; }
  if (changed) WorkdayStore.write(workdayState);
}

export function ensureWorkdayState(now = Date.now()) {
  const info = getWorkdayInfo(now);
  if (isServerMode()) return info;
  if (info.state === 'active') {
    if (!workdayState || workdayState.id !== info.id) {
      workdayState = createWorkdaySnapshot(info); WorkdayStore.write(workdayState);
    } else {
      if (workdayState.start !== info.start || workdayState.end !== info.end) {
        workdayState.start = info.start; workdayState.end = info.end;
        workdayState.locked = false; workdayState.closedManually = false;
        workdayState.manualClosedStats = { timeMs: 0, doneCount: 0 }; WorkdayStore.write(workdayState);
      }
      if (workdayState.closedAt && now < workdayState.end && !workdayState.closedManually) {
        workdayState.closedAt = null; workdayState.finalTimeMs = 0; workdayState.finalDoneCount = 0;
        workdayState.locked = false; workdayState.closedManually = false;
        workdayState.manualClosedStats = { timeMs: 0, doneCount: 0 }; WorkdayStore.write(workdayState);
      }
    }
  } else if (workdayState && now >= workdayState.end && (!workdayState.locked || workdayState.closedManually)) {
    const summary = computeAggregatedWorkdayStats(workdayState.end, { persist: true, allowBaselineUpdate: true });
    workdayState.finalTimeMs = summary.timeMs; workdayState.finalDoneCount = summary.doneCount;
    workdayState.locked = true;
    workdayState.closedAt = typeof workdayState.end === 'number' && isFinite(workdayState.end) ? workdayState.end : now;
    workdayState.closedManually = false;
    workdayState.manualClosedStats = { timeMs: summary.timeMs, doneCount: summary.doneCount };
    WorkdayStore.write(workdayState);
    if (_cb.hasActiveTimer?.()) { _cb.stopAllTimersExcept?.(null); Store.write(_cb.getTasks?.()); _cb.syncTimerLoop?.(); }
  }
  return info;
}

function formatWorkdayRangeShort(start, end) {
  if (typeof start !== 'number' || typeof end !== 'number') return '';
  return `${_cb.formatTimeHM?.(start)} — ${_cb.formatTimeHM?.(end)}`;
}

function formatWorkdayRangeLong(start, end) {
  if (typeof start !== 'number' || typeof end !== 'number') return '';
  const startDate = _cb.formatDateDMY?.(start); const endDate = _cb.formatDateDMY?.(end);
  const startTime = _cb.formatTimeHM?.(start); const endTime = _cb.formatTimeHM?.(end);
  if (startDate === endDate) return `${startDate} ${startTime} — ${endTime}`;
  return `${startDate} ${startTime} — ${endDate} ${endTime}`;
}

function collectWorkdayCompletedTasks(state) {
  if (!state || !state.completed) return [];
  const result = [];
  const start = typeof state.start === 'number' ? state.start : null;
  const end = typeof state.end === 'number' ? state.end : null;
  for (const [id, stamp] of Object.entries(state.completed)) {
    if (typeof stamp !== 'number' || (start !== null && stamp < start) || (end !== null && stamp > end)) continue;
    const task = _cb.findTask?.(id);
    if (!task || !task.done) continue;
    const projectMeta = task.project ? _cb.getProjectMeta?.(task.project) : null;
    result.push({ id, title: task.title || 'Без названия', completedAt: stamp, project: projectMeta });
  }
  result.sort((a, b) => a.completedAt - b.completedAt || a.title.localeCompare(b.title, 'ru', { sensitivity: 'base' }));
  return result;
}

function collectWorkdayPendingTasks(state) {
  if (!state) return [];
  const key = workdayDateKey(state.start);
  const result = [];
  _cb.walkTasks?.(_cb.getTasks?.() || [], item => {
    if (!item || item.done || !item.due) return;
    const dueDate = new Date(item.due); if (isNaN(dueDate)) return;
    const dueKey = workdayDateKey(dueDate);
    if (dueKey && dueKey === key) {
      const projectMeta = item.project ? _cb.getProjectMeta?.(item.project) : null;
      result.push({ id: item.id, title: item.title || 'Без названия', due: dueDate, project: projectMeta });
    }
  });
  result.sort((a, b) => a.due - b.due || a.title.localeCompare(b.title, 'ru', { sensitivity: 'base' }));
  return result;
}

function syncActiveTimersForWorkdayClose() {
  const updatedIds = [];
  _cb.walkTasks?.(_cb.getTasks?.() || [], item => {
    if (item && item.timerActive && item.id) updatedIds.push(item.id);
  });
  if (!updatedIds.length) return;
  _cb.stopAllTimersExcept?.(null);
  Store.write(_cb.getTasks?.());
  _cb.syncTimerLoop?.();
  if (isServerMode()) {
    for (const id of updatedIds) {
      const task = _cb.findTask?.(id);
      if (task) queueTaskUpdate(id, { timeSpent: task.timeSpent });
    }
  }
}

export function updateWorkdayDialogContent() {
  if (!WorkdayUI.overlay) return;
  const now = Date.now();
  const info = ensureWorkdayState(now);
  const hasState = !!workdayState;
  let stats = { timeMs: 0, doneCount: 0 };
  if (hasState) {
    if (info.state === 'active' && workdayState.id === info.id) {
      const aggregated = computeAggregatedWorkdayStats(now, { persist: true, allowBaselineUpdate: true });
      stats = { timeMs: aggregated.timeMs, doneCount: aggregated.doneCount };
    } else { stats = { timeMs: workdayState.finalTimeMs || 0, doneCount: workdayState.finalDoneCount || 0 }; }
    if (workdayState.closedManually) {
      const manual = getManualWorkdayStats();
      stats.timeMs = Math.max(stats.timeMs, manual.timeMs);
      stats.doneCount = Math.max(stats.doneCount, manual.doneCount);
    }
  }
  if (WorkdayUI.summaryTime) WorkdayUI.summaryTime.textContent = _cb.formatDuration?.(stats.timeMs) ?? '';
  if (WorkdayUI.summaryDone) WorkdayUI.summaryDone.textContent = String(stats.doneCount);
  if (WorkdayUI.range) WorkdayUI.range.textContent = hasState ? formatWorkdayRangeLong(workdayState.start, workdayState.end) : '';
  const pending = hasState && !isWorkdayClosedForEditing() ? collectWorkdayPendingTasks(workdayState) : [];
  const manuallyClosed = hasState && workdayState.closedManually;
  const activeNow = hasState && info.state === 'active' && workdayState.id === info.id && !manuallyClosed;
  const showCompleted = hasState;
  const completed = showCompleted ? collectWorkdayCompletedTasks(workdayState) : [];
  if (WorkdayUI.title) { WorkdayUI.title.textContent = 'Итоги дня'; }
  if (WorkdayUI.completedSection) WorkdayUI.completedSection.style.display = showCompleted ? 'block' : 'none';
  if (WorkdayUI.completedList) {
    WorkdayUI.completedList.innerHTML = '';
    if (showCompleted && completed.length) {
      for (const item of completed) {
        const li = document.createElement('li');
        const title = document.createElement('div'); title.className = 'workday-dialog-task-title'; title.textContent = item.title; li.appendChild(title);
        const meta = document.createElement('div'); meta.className = 'workday-dialog-task-meta';
        const parts = [];
        const completedDate = new Date(item.completedAt);
        parts.push(`Завершено в ${_cb.formatTimeHM?.(completedDate)}`);
        if (item.project && item.project.title) { const emoji = item.project.emoji ? `${item.project.emoji} ` : ''; parts.push(`Проект: ${emoji}${item.project.title}`.trim()); }
        meta.textContent = parts.join(' • '); li.appendChild(meta); WorkdayUI.completedList.appendChild(li);
      }
    }
    if (WorkdayUI.completedEmpty) WorkdayUI.completedEmpty.style.display = showCompleted && !completed.length ? 'block' : 'none';
    WorkdayUI.completedList.style.display = showCompleted && completed.length ? 'flex' : 'none';
  }
  if (WorkdayUI.pendingList) {
    WorkdayUI.pendingList.innerHTML = '';
    if (pending.length) {
      for (const item of pending) {
        const li = document.createElement('li');
        const title = document.createElement('div'); title.className = 'workday-dialog-task-title'; title.textContent = item.title; li.appendChild(title);
        const meta = document.createElement('div'); meta.className = 'workday-dialog-task-meta';
        const parts = [];
        parts.push(`Дедлайн: ${_cb.formatDateDMY?.(item.due)}`);
        if (item.project && item.project.title) { const emoji = item.project.emoji ? `${item.project.emoji} ` : ''; parts.push(`Проект: ${emoji}${item.project.title}`.trim()); }
        meta.textContent = parts.join(' • '); li.appendChild(meta); WorkdayUI.pendingList.appendChild(li);
      }
    }
    if (WorkdayUI.emptyState) WorkdayUI.emptyState.style.display = pending.length ? 'none' : 'block';
    WorkdayUI.pendingList.style.display = pending.length ? 'flex' : 'none';
  }
  if (WorkdayUI.postponeBtn) WorkdayUI.postponeBtn.disabled = !pending.length;
  return { pending, activeNow, manuallyClosed };
}

export function openWorkdayDialog() {
  if (!WorkdayUI.overlay) return;
  const state = updateWorkdayDialogContent() || {};
  const pending = Array.isArray(state.pending) ? state.pending : [];
  WorkdayUI.overlay.classList.add('is-open');
  WorkdayUI.overlay.setAttribute('aria-hidden', 'false');
  document.body.classList.add('workday-dialog-open');
  if (WorkdayUI.postponeBtn) WorkdayUI.postponeBtn.disabled = !pending.length;
  if (state.activeNow) { requestAnimationFrame(() => startWorkdayFireworks()); } else { stopWorkdayFireworks(); }
  let focusTarget = null;
  if (WorkdayUI.postponeBtn && !WorkdayUI.postponeBtn.disabled) { focusTarget = WorkdayUI.postponeBtn; }
  else if (WorkdayUI.closeAction) { focusTarget = WorkdayUI.closeAction; }
  setTimeout(() => { if (!focusTarget) return; try { focusTarget.focus({ preventScroll: true }); } catch { focusTarget.focus(); } }, 80);
}

export function closeWorkdayDialog() {
  if (!WorkdayUI.overlay) return;
  WorkdayUI.overlay.classList.remove('is-open');
  WorkdayUI.overlay.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('workday-dialog-open');
  stopWorkdayFireworks();
}

export function postponePendingTasks() {
  if (!workdayState) return;
  if (isWorkdayClosedForEditing()) { promptToReopenWorkday(); return; }
  const pending = collectWorkdayPendingTasks(workdayState);
  if (!pending.length) { _cb.toast?.('Все задачи уже перенесены'); return; }
  const nextIso = zonedDayStartIsoForWorkdayDate(workdayState.start, 1);
  if (!nextIso) { _cb.toast?.('Не удалось определить завтрашний день'); return; }
  let changed = false;
  const updatedIds = [];
  for (const item of pending) {
    const task = _cb.findTask?.(item.id); if (!task) continue;
    task.due = nextIso; changed = true;
    if (isServerMode()) updatedIds.push(task.id);
  }
  if (changed) {
    Store.write(_cb.getTasks?.());
    if (updatedIds.length) { updatedIds.forEach(id => queueTaskUpdate(id, { due: nextIso })); }
    _cb.render?.();
    _cb.toast?.('Перенесено на завтра');
    updateWorkdayDialogContent();
  }
}

export function finishWorkday() {
  if (!workdayState) { closeWorkdayDialog(); return; }
  if (isWorkdayClosedForEditing()) { _cb.toast?.('Рабочий день уже закрыт'); closeWorkdayDialog(); return; }
  const now = Date.now();
  ensureWorkdayState(now);
  const aggregated = computeAggregatedWorkdayStats(now, { persist: true, allowBaselineUpdate: true });
  workdayState.manualClosedStats = { timeMs: aggregated.timeMs, doneCount: aggregated.doneCount };
  workdayState.finalTimeMs = Math.max(workdayState.finalTimeMs || 0, aggregated.timeMs);
  workdayState.finalDoneCount = Math.max(workdayState.finalDoneCount || 0, aggregated.doneCount);
  workdayState.closedAt = now; workdayState.closedManually = true; workdayState.locked = true;
  WorkdayStore.write(workdayState, { skipServerSync: isServerMode() });
  syncActiveTimersForWorkdayClose();
  Store.write(_cb.getTasks?.());
  if (isServerMode()) {
    const workdayPayload = { id: workdayState.id, startTs: workdayState.start || null, endTs: workdayState.end || null, summaryTimeMs: aggregated.timeMs, summaryDone: aggregated.doneCount, payload: { ...workdayState }, closedAt: now };
    runServerAction(() => apiRequest('/workday/close', { method: 'POST', body: { workday: workdayPayload } }), {
      onSuccess: () => _cb.refreshDataForCurrentMode?.({ silent: true }),
      onError: () => _cb.refreshDataForCurrentMode?.({ silent: true }),
    });
  }
  closeWorkdayDialog();
  _cb.render?.();
  updateWorkdayUI();
  _cb.toast?.('Рабочий день закрыт');
}

let workdayRefreshTimer = null;

export function updateWorkdayUI() {
  if (!WorkdayUI.bar) return;
  const now = Date.now();
  const info = ensureWorkdayState(now);
  let datasetState = 'inactive';
  let stats = { timeMs: 0, doneCount: 0 };
  const hasState = !!workdayState;
  const isCurrent = hasState && info.state === 'active' && workdayState.id === info.id;
  const isLocked = hasState && workdayState.locked;
  const manuallyClosed = hasState && workdayState.closedManually;
  const closedForEditing = isWorkdayClosedForEditing();
  if (isCurrent) {
    const aggregated = computeAggregatedWorkdayStats(now, { persist: true, allowBaselineUpdate: true });
    stats = { timeMs: aggregated.timeMs, doneCount: aggregated.doneCount };
    datasetState = closedForEditing ? 'closed' : 'active';
  } else if (hasState) {
    if (!isLocked && now < workdayState.end && !closedForEditing) {
      const aggregated = computeAggregatedWorkdayStats(now, { persist: true, allowBaselineUpdate: true });
      stats = { timeMs: aggregated.timeMs, doneCount: aggregated.doneCount };
    } else { stats = { timeMs: workdayState.finalTimeMs || 0, doneCount: workdayState.finalDoneCount || 0 }; }
    if (closedForEditing) { datasetState = 'closed'; } else if (info.state === 'waiting') { datasetState = 'waiting'; } else { datasetState = 'inactive'; }
  }
  if (manuallyClosed) {
    const manual = getManualWorkdayStats();
    stats.timeMs = Math.max(stats.timeMs, manual.timeMs);
    stats.doneCount = Math.max(stats.doneCount, manual.doneCount);
  }
  if (WorkdayUI.done) WorkdayUI.done.textContent = String(stats.doneCount);
  if (WorkdayUI.time) WorkdayUI.time.textContent = _cb.formatDuration?.(stats.timeMs) ?? '';
  WorkdayUI.bar.dataset.state = datasetState;
  if (WorkdayUI.button) {
    const canInteract = !!workdayState && !closedForEditing;
    WorkdayUI.button.disabled = !canInteract;
    WorkdayUI.button.setAttribute('aria-disabled', canInteract ? 'false' : 'true');
    WorkdayUI.button.classList.toggle('is-hidden', !!workdayState && closedForEditing);
  }
  updateWorkdayRecIndicator();
}

export function ensureWorkdayRefreshLoop() {
  if (workdayRefreshTimer) return;
  workdayRefreshTimer = setInterval(() => updateWorkdayUI(), WORKDAY_REFRESH_INTERVAL);
}

export function updateWorkdayRecIndicator() {
  if (!WorkdayUI.rec) return;
  const active = _cb.hasActiveTimer?.() ?? false;
  WorkdayUI.rec.classList.toggle('is-active', active);
  WorkdayUI.rec.setAttribute('aria-hidden', active ? 'false' : 'true');
}
