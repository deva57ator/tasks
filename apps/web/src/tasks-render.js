import { MAX_TASK_DEPTH } from './config.js';
import { $, $$, getTaskRowById, isDueToday, isDuePast, formatDue } from './utils.js';
import {
  tasks, findTask, findArchivedTask,
  detachTaskFromTree, containsTask, getSubtreeDepth,
  totalTimeMs, toggleTask, toggleTaskTimer, handleDelete, renameTask,
  removeActiveTimerState,
} from './tasks-data.js';
import { Store, isServerMode } from './storage.js';
import { queueTaskUpdate } from './api.js';
import { projects, getProjectEmoji, getProjectTitle } from './projects.js';

// ── Коллбэки ───────────────────────────────────────────────────────────────
const _cb = {};
export function registerTasksRenderCallbacks(cbs) { Object.assign(_cb, cbs); }

// ── Состояние ──────────────────────────────────────────────────────────────
export let hoveredParentTaskId = null;
let draggingTaskId = null;
let dropTargetId = null;
export let activeEditId = null;
export let activeInputEl = null;

// ── DOM-объекты панелей ─────────────────────────────────────────────────────
export const Ctx = {
  el: document.getElementById('ctxMenu'),
  taskId: null,
  sub: document.getElementById('ctxSub'),
  submenuAnchor: null,
};

const TimePresetMenu = { el: document.createElement('div'), taskId: null, anchor: null };
TimePresetMenu.el.className = 'context-menu time-preset-menu';
TimePresetMenu.el.setAttribute('role', 'menu');
TimePresetMenu.el.setAttribute('aria-hidden', 'true');
document.body.appendChild(TimePresetMenu.el);

export const NotesPanel = {
  panel: document.getElementById('notesSidebar'),
  overlay: document.getElementById('notesOverlay'),
  close: document.getElementById('notesClose'),
  title: document.getElementById('notesTaskTitle'),
  input: document.getElementById('notesInput'),
  taskId: null,
  mode: 'tasks',
};

// ── Вспомогательные функции ─────────────────────────────────────────────────
export function rowClass(t) {
  return 'task' +
    (_cb.getSelectedTaskId?.() === t.id ? ' is-selected' : '') +
    (t.done ? ' done' : '') +
    (t.timerActive ? ' is-timer-active' : '');
}

export function getVisibleTaskIds() { return $$('#tasks .task[data-id]').map(el => el.dataset.id); }

function collectVisibleTaskMeta(list, visibleTaskIds, visibleTaskMap) {
  if (!Array.isArray(list)) return;
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    visibleTaskIds.add(item.id);
    visibleTaskMap.set(item.id, item);
    if (Array.isArray(item.children) && item.children.length) collectVisibleTaskMeta(item.children, visibleTaskIds, visibleTaskMap);
  }
}
export function collectVisibleAncestorIds(task, visibleTaskMap) {
  const ids = [];
  if (!task || !visibleTaskMap) return ids;
  let parentId = task.parentId || null;
  while (parentId && visibleTaskMap.has(parentId)) {
    ids.push(parentId);
    const parentTask = visibleTaskMap.get(parentId);
    parentId = parentTask && parentTask.parentId ? parentTask.parentId : null;
  }
  return ids;
}
function collectVisibleAncestorLevels(task, visibleTaskMap) {
  const levels = [];
  if (!task || !visibleTaskMap) return levels;
  let level = 1;
  let parentId = task.parentId || null;
  while (parentId && visibleTaskMap.has(parentId)) {
    levels.push(level);
    const parentTask = visibleTaskMap.get(parentId);
    parentId = parentTask && parentTask.parentId ? parentTask.parentId : null;
    level++;
  }
  return levels;
}

function setDropTarget(id) {
  if (dropTargetId === id || (dropTargetId === null && id === null)) return;
  if (dropTargetId) {
    const prev = document.querySelector(`.task[data-id="${dropTargetId}"]`);
    prev && prev.classList.remove('is-drop-target');
  }
  dropTargetId = id || null;
  if (dropTargetId) {
    const el = document.querySelector(`.task[data-id="${dropTargetId}"]`);
    el && el.classList.add('is-drop-target');
  }
}

export function clearDragIndicators() {
  if (draggingTaskId) {
    const dragEl = document.querySelector(`.task[data-id="${draggingTaskId}"]`);
    dragEl && dragEl.classList.remove('is-dragging');
  }
  setDropTarget(null);
  draggingTaskId = null;
}

export function setInheritedHover(parentId) {
  hoveredParentTaskId = parentId || null;
  const rows = $$('#tasks .task-row[data-id]');
  for (const row of rows) {
    const ancestors = (row.dataset.ancestorIds || '').split(',').filter(Boolean);
    row.classList.toggle('is-inherited-hover', !!(hoveredParentTaskId && ancestors.includes(hoveredParentTaskId)));
  }
}

export function updateNoteIndicator(taskId) {
  const btn = document.querySelector(`.task[data-id="${taskId}"] .note-btn`);
  if (btn) {
    const t = findTask(taskId);
    btn.dataset.hasNotes = t && t.notes && t.notes.trim() ? 'true' : 'false';
  }
}

// ── Отображение инлайн-таймера ─────────────────────────────────────────────
export function applyInlineTimeControls(container, task) {
  if (!container || !task) return;
  const disabled = !!task.timerActive || !!_cb.isTimeUpdatePending?.(task.id);
  container.classList.toggle('is-disabled', disabled);
  const trigger = container.querySelector('.time-preset-trigger');
  if (trigger) { trigger.disabled = disabled; trigger.setAttribute('aria-disabled', disabled ? 'true' : 'false'); }
  const loader = container.querySelector('.time-loading');
  if (loader) loader.classList.toggle('is-visible', !!_cb.isTimeUpdatePending?.(task.id));
}

export function updateTimeControlsState(taskId) {
  const row = getTaskRowById(taskId);
  const task = findTask(taskId);
  if (!row || !task) return;
  const inline = row.querySelector('.time-inline-controls');
  if (inline) applyInlineTimeControls(inline, task);
  const timerBtn = row.querySelector('.timer-btn');
  if (timerBtn) {
    const disabled = !!_cb.isTimeUpdatePending?.(taskId) || (_cb.getTimeDialogTaskId?.() === taskId && _cb.isTimeDialogOpen?.());
    timerBtn.disabled = disabled;
  }
}

// Обновление отображений таймеров без полного ре-рендера
export function updateTimerDisplays() {
  const now = Date.now();
  for (const row of $$('#tasks .task[data-id]')) {
    const id = row.dataset.id;
    const task = findTask(id);
    if (!task) continue;
    const badge = row.querySelector('.time-spent');
    if (badge) {
      const ms = totalTimeMs(task, now);
      if (ms > 0) { badge.textContent = _cb.formatDuration?.(ms) ?? ''; badge.hidden = false; }
      else { badge.textContent = ''; badge.hidden = true; }
    }
    const timerBtn = row.querySelector('.timer-btn');
    if (timerBtn) {
      timerBtn.dataset.active = task.timerActive ? 'true' : 'false';
      timerBtn.title = task.timerActive ? 'Остановить таймер' : 'Запустить таймер';
      timerBtn.setAttribute('aria-pressed', task.timerActive ? 'true' : 'false');
    }
    const inline = row.querySelector('.time-inline-controls');
    if (inline) applyInlineTimeControls(inline, task);
  }
}

// ── Назначение проекта ─────────────────────────────────────────────────────
function assignProject(taskId, projId) {
  const t = findTask(taskId); if (!t) return;
  t.project = projId;
  Store.write(tasks);
  if (isServerMode()) queueTaskUpdate(taskId, { project: projId });
  _cb.render?.();
  _cb.toast?.('Назначено в проект: ' + getProjectTitle(projId));
}

function clearTaskProject(taskId) {
  const t = findTask(taskId); if (!t) return;
  t.project = null;
  Store.write(tasks);
  if (isServerMode()) queueTaskUpdate(taskId, { project: null });
  _cb.render?.();
}

// ── Сабменю назначения проекта ─────────────────────────────────────────────
export function openProjectAssignSubmenu({ anchorItem, currentProjectId, onAssign, onClear } = {}) {
  _cb.closeDuePicker?.();
  if (!anchorItem) return;
  const sub = Ctx.sub;
  if (!sub) return;
  sub.innerHTML = '';
  if (!projects.length) {
    const it = document.createElement('div');
    it.className = 'ctx-submenu-item';
    it.textContent = 'Нет проектов';
    sub.appendChild(it);
  } else {
    for (const p of projects) {
      const it = document.createElement('div');
      it.className = 'ctx-submenu-item';
      it.textContent = `${getProjectEmoji(p.id)} ${p.title}`;
      const handleAssign = () => { if (typeof onAssign === 'function') onAssign(p.id); };
      it.addEventListener('mousedown', e => { if (e.button !== 0) return; e.preventDefault(); e.stopPropagation(); handleAssign(); });
      it.addEventListener('click', e => { if (e.detail !== 0) return; e.stopPropagation(); handleAssign(); });
      sub.appendChild(it);
    }
  }
  if (currentProjectId) {
    const sep = document.createElement('div'); sep.style.height = '6px'; sub.appendChild(sep);
    const clr = document.createElement('div'); clr.className = 'ctx-submenu-item'; clr.textContent = 'Снять проект';
    const handleClear = () => { if (typeof onClear === 'function') onClear(); };
    clr.addEventListener('mousedown', e => { if (e.button !== 0) return; e.preventDefault(); e.stopPropagation(); handleClear(); });
    clr.addEventListener('click', e => { if (e.detail !== 0) return; e.stopPropagation(); handleClear(); });
    sub.appendChild(clr);
  }
  if (Ctx.submenuAnchor && Ctx.submenuAnchor !== anchorItem) Ctx.submenuAnchor.classList.remove('is-submenu-open');
  Ctx.submenuAnchor = anchorItem;
  anchorItem.classList.add('is-submenu-open');
  const r = anchorItem.getBoundingClientRect();
  sub.style.display = 'block';
  const sw = sub.offsetWidth || 0; const sh = sub.offsetHeight || 0;
  let left = r.right + 6; let top = r.top;
  if (left + sw > window.innerWidth - 8) left = Math.max(8, window.innerWidth - sw - 8);
  if (top + sh > window.innerHeight - 8) top = Math.max(8, window.innerHeight - sh - 8);
  sub.style.left = left + 'px'; sub.style.top = top + 'px';
  sub.setAttribute('aria-hidden', 'false');
}

export function openAssignSubmenu(taskId, anchorItem) {
  const t = findTask(taskId);
  const currentProjectId = t ? t.project : null;
  openProjectAssignSubmenu({
    anchorItem,
    currentProjectId,
    onAssign: projId => { assignProject(taskId, projId); closeContextMenu(); },
    onClear: () => { clearTaskProject(taskId); closeContextMenu(); },
  });
}

export function closeAssignSubmenu() {
  if (Ctx.submenuAnchor) { Ctx.submenuAnchor.classList.remove('is-submenu-open'); Ctx.submenuAnchor = null; }
  if (!Ctx.sub) return;
  Ctx.sub.style.display = 'none';
  Ctx.sub.setAttribute('aria-hidden', 'true');
}

export function maybeCloseSubmenu() {
  setTimeout(() => {
    const anchor = Ctx.submenuAnchor;
    if (anchor && anchor.matches(':hover')) return;
    if (Ctx.sub && Ctx.sub.matches(':hover')) return;
    closeAssignSubmenu();
  }, 120);
}

// ── Контекстное меню задачи ────────────────────────────────────────────────
export function openContextMenu(taskId, x, y) {
  Ctx.taskId = taskId;
  const menu = Ctx.el;
  menu.innerHTML = '';
  closeAssignSubmenu();
  _cb.closeDuePicker?.();
  closeTimePresetMenu();

  const btnEdit = document.createElement('div'); btnEdit.className = 'context-item'; btnEdit.textContent = 'Редактировать';
  btnEdit.onclick = () => {
    closeContextMenu();
    const row = document.querySelector(`.task[data-id="${taskId}"]`);
    const t = findTask(taskId);
    if (!t) return;
    if (row) startEdit(row, t);
    else { const next = prompt('Название задачи', t.title || ''); if (next !== null) renameTask(taskId, next); }
  };
  const btnComplete = document.createElement('div'); btnComplete.className = 'context-item'; btnComplete.textContent = 'Отметить выполненной';
  btnComplete.onclick = () => { closeContextMenu(); _cb.markTaskDone?.(taskId); };
  const btnAssign = document.createElement('div'); btnAssign.className = 'context-item'; btnAssign.textContent = 'Проект ▸';
  btnAssign.addEventListener('mouseenter', () => { openAssignSubmenu(taskId, btnAssign); _cb.closeDuePicker?.(); });
  btnAssign.addEventListener('mouseleave', () => maybeCloseSubmenu());
  const btnTime = document.createElement('div'); btnTime.className = 'context-item'; btnTime.textContent = 'Время…';
  btnTime.onclick = () => { closeContextMenu(); _cb.openTimeEditDialog?.(taskId); };
  const btnDue = document.createElement('div'); btnDue.className = 'context-item'; btnDue.textContent = 'Дата ▸'; btnDue.dataset.menuAnchor = 'true';
  btnDue.addEventListener('mouseenter', () => { closeAssignSubmenu(); _cb.openDuePicker?.(taskId, btnDue, { fromContext: true }); });
  btnDue.addEventListener('mouseleave', () => {
    setTimeout(() => {
      if (_cb.getDueEl?.()?.dataset.fromContext === 'true') {
        const anchor = _cb.getDueAnchor?.();
        if (anchor && anchor.matches(':hover')) return;
        if (_cb.getDueEl?.()?.matches(':hover')) return;
        _cb.closeDuePicker?.();
      }
    }, 80);
  });
  menu.append(btnEdit, btnComplete, btnAssign, btnTime, btnDue);
  menu.style.display = 'block';
  const mw = menu.offsetWidth; const mh = menu.offsetHeight;
  const px = Math.min(x, window.innerWidth - mw - 8); const py = Math.min(y, window.innerHeight - mh - 8);
  menu.style.left = px + 'px'; menu.style.top = py + 'px';
  menu.setAttribute('aria-hidden', 'false');
}

export function closeContextMenu() {
  Ctx.taskId = null;
  Ctx.el.style.display = 'none';
  Ctx.el.setAttribute('aria-hidden', 'true');
  closeAssignSubmenu();
  if (_cb.getDueEl?.()?.dataset.fromContext === 'true') _cb.closeDuePicker?.();
}

// ── Меню пресетов времени ──────────────────────────────────────────────────
export function openTimePresetMenu(taskId, anchor) {
  const task = findTask(taskId);
  if (!task) return;
  if (task.timerActive || _cb.isTimeUpdatePending?.(taskId)) return;
  const menu = TimePresetMenu.el;
  if (!menu) return;
  if (TimePresetMenu.taskId === taskId && menu.style.display === 'block') { closeTimePresetMenu(); return; }
  closeContextMenu();
  _cb.closeDuePicker?.();
  TimePresetMenu.taskId = taskId;
  TimePresetMenu.anchor = anchor || null;
  menu.innerHTML = '';
  for (const delta of (_cb.getTimePresets?.() ?? [])) {
    const item = document.createElement('div');
    item.className = 'context-item';
    item.textContent = _cb.formatPresetLabel?.(delta) ?? `+${delta} мин`;
    item.title = `Добавить ${_cb.formatDuration?.(_cb.minutesToMs?.(delta) ?? delta * 60000) ?? ''}`;
    item.onclick = () => { closeTimePresetMenu(); _cb.handleInlinePreset?.(taskId, delta); };
    menu.appendChild(item);
  }
  menu.style.display = 'block';
  menu.setAttribute('aria-hidden', 'false');
  const r = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: 0, right: 0, top: 0, bottom: 0 };
  const mw = menu.offsetWidth || 160; const mh = menu.offsetHeight || 120;
  let px = Math.min(r.left, window.innerWidth - mw - 8);
  let py = r.bottom + 6;
  if (py + mh > window.innerHeight - 8) py = Math.max(8, r.top - mh - 6);
  menu.style.left = px + 'px'; menu.style.top = py + 'px';
}

export function closeTimePresetMenu() {
  TimePresetMenu.taskId = null;
  TimePresetMenu.anchor = null;
  if (TimePresetMenu.el) { TimePresetMenu.el.style.display = 'none'; TimePresetMenu.el.setAttribute('aria-hidden', 'true'); }
}

export function getTimePresetMenuEl() { return TimePresetMenu.el; }
export function getTimePresetMenuAnchor() { return TimePresetMenu.anchor; }

// ── Заметки ────────────────────────────────────────────────────────────────
export function openNotesPanel(taskId, { source = 'tasks' } = {}) {
  if (!NotesPanel.panel || !NotesPanel.overlay || !NotesPanel.input) return;
  closeContextMenu();
  const isArchive = source === 'archive';
  const task = isArchive ? findArchivedTask(taskId) : findTask(taskId);
  if (!task) return;
  NotesPanel.taskId = taskId;
  NotesPanel.mode = isArchive ? 'archive' : 'tasks';
  if (NotesPanel.title) NotesPanel.title.textContent = task.title || '';
  NotesPanel.input.value = task.notes || '';
  NotesPanel.input.readOnly = isArchive;
  NotesPanel.input.classList.toggle('is-readonly', isArchive);
  if (isArchive) { NotesPanel.input.setAttribute('aria-readonly', 'true'); } else { NotesPanel.input.removeAttribute('aria-readonly'); }
  NotesPanel.overlay.classList.add('is-visible'); NotesPanel.overlay.setAttribute('aria-hidden', 'false');
  NotesPanel.panel.classList.add('is-open'); NotesPanel.panel.setAttribute('aria-hidden', 'false');
  document.body.classList.add('notes-open');
  if (!isArchive) {
    setTimeout(() => { try { NotesPanel.input.focus({ preventScroll: true }); } catch { NotesPanel.input.focus(); } }, 60);
    updateNoteIndicator(taskId);
  }
}

export function closeNotesPanel() {
  if (!NotesPanel.panel || !NotesPanel.overlay) return;
  NotesPanel.taskId = null;
  NotesPanel.mode = 'tasks';
  NotesPanel.overlay.classList.remove('is-visible'); NotesPanel.overlay.setAttribute('aria-hidden', 'true');
  NotesPanel.panel.classList.remove('is-open'); NotesPanel.panel.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('notes-open');
  if (NotesPanel.title) NotesPanel.title.textContent = '';
  if (NotesPanel.input) { NotesPanel.input.value = ''; NotesPanel.input.readOnly = false; NotesPanel.input.classList.remove('is-readonly'); NotesPanel.input.removeAttribute('aria-readonly'); }
}

// ── Рендер строки задачи ───────────────────────────────────────────────────
export function renderTaskRow(t, depth, container, renderContext = { visibleTaskIds: new Set(), visibleTaskMap: new Map() }) {
  const canAcceptChildren = depth < MAX_TASK_DEPTH;
  const childList = Array.isArray(t.children) ? t.children : [];
  const hasChildren = canAcceptChildren && childList.length > 0;
  const parentId = t.parentId || null;
  const hasVisibleParent = !!(parentId && renderContext.visibleTaskIds.has(parentId));
  const visibleAncestorLevels = collectVisibleAncestorLevels(t, renderContext.visibleTaskMap);
  const visibleAncestorIds = collectVisibleAncestorIds(t, renderContext.visibleTaskMap);

  const row = document.createElement('div');
  row.className = rowClass(t);
  row.dataset.id = t.id; row.dataset.depth = depth;
  row.classList.add('task-row');
  row.dataset.taskId = t.id;
  row.dataset.level = String(depth);
  row.dataset.ancestorIds = visibleAncestorIds.join(',');
  if (parentId) row.dataset.parentId = parentId;
  if (hasVisibleParent) { row.classList.add('has-visible-parent'); row.dataset.hasVisibleParent = 'true'; }

  if (visibleAncestorLevels.length) {
    const guides = document.createElement('div');
    guides.className = 'task-inheritance-guides';
    for (const level of visibleAncestorLevels) {
      const line = document.createElement('span');
      line.className = 'task-inheritance-line';
      line.style.left = `${-14 - ((level - 1) * 28)}px`;
      guides.appendChild(line);
    }
    row.appendChild(guides);
  }

  if (hoveredParentTaskId && visibleAncestorIds.includes(hoveredParentTaskId)) row.classList.add('is-inherited-hover');
  row.addEventListener('mouseenter', () => { if (hoveredParentTaskId === t.id) return; setInheritedHover(t.id); });
  row.addEventListener('mouseleave', () => { if (hoveredParentTaskId !== t.id) return; setInheritedHover(null); });

  row.setAttribute('draggable', 'true');
  row.addEventListener('dragstart', e => {
    draggingTaskId = t.id; row.classList.add('is-dragging');
    try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', t.id); } catch {}
    closeContextMenu();
  });
  row.addEventListener('dragend', () => { clearDragIndicators(); });
  row.addEventListener('dragenter', e => {
    if (!draggingTaskId || draggingTaskId === t.id) return;
    if (!canAcceptChildren) { setDropTarget(null); return; }
    const dragged = findTask(draggingTaskId); if (!dragged) return;
    if (containsTask(dragged, t.id)) { setDropTarget(null); return; }
    const subtreeDepth = getSubtreeDepth(dragged);
    if (depth + 1 + subtreeDepth > MAX_TASK_DEPTH) { setDropTarget(null); return; }
    e.preventDefault(); setDropTarget(t.id);
  });
  row.addEventListener('dragover', e => {
    if (!draggingTaskId || draggingTaskId === t.id) return;
    const dragged = findTask(draggingTaskId); if (!dragged) return;
    if (!canAcceptChildren) { if (e.dataTransfer) e.dataTransfer.dropEffect = 'none'; return; }
    if (containsTask(dragged, t.id)) return;
    const subtreeDepth = getSubtreeDepth(dragged);
    if (depth + 1 + subtreeDepth > MAX_TASK_DEPTH) { if (e.dataTransfer) e.dataTransfer.dropEffect = 'none'; return; }
    e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  });
  row.addEventListener('dragleave', e => {
    if (dropTargetId !== t.id) return;
    const rel = e.relatedTarget; if (rel && row.contains(rel)) return;
    setDropTarget(null);
  });
  row.addEventListener('drop', e => {
    if (!draggingTaskId) return;
    e.preventDefault();
    const sourceId = draggingTaskId;
    clearDragIndicators();
    if (sourceId === t.id) return;
    const draggedTask = findTask(sourceId); const targetTask = findTask(t.id);
    if (!draggedTask || !targetTask) return;
    if (!canAcceptChildren) { _cb.toast?.('Максимальная вложенность — три уровня'); return; }
    if (containsTask(draggedTask, t.id)) return;
    const subtreeDepth = getSubtreeDepth(draggedTask);
    if (depth + 1 + subtreeDepth > MAX_TASK_DEPTH) { _cb.toast?.('Максимальная вложенность — три уровня'); return; }
    const moved = detachTaskFromTree(sourceId); if (!moved) return;
    if (!Array.isArray(targetTask.children)) targetTask.children = [];
    const inheritedProject = typeof targetTask.project === 'undefined' ? null : targetTask.project;
    targetTask.children.push(moved);
    moved.project = inheritedProject; moved.parentId = targetTask.id;
    targetTask.collapsed = false;
    Store.write(tasks);
    if (isServerMode()) queueTaskUpdate(moved.id, { parentId: targetTask.id, project: moved.project });
    _cb.setSelectedTaskId?.(moved.id);
    _cb.render?.();
  });
  row.addEventListener('contextmenu', e => { e.preventDefault(); openContextMenu(t.id, e.clientX, e.clientY); });

  const cb = document.createElement('div');
  cb.className = 'task-checkbox'; cb.dataset.checked = t.done ? 'true' : 'false';
  cb.title = t.done ? 'Снять отметку выполнения' : 'Отметить как выполненную';
  cb.setAttribute('role', 'button'); cb.setAttribute('aria-label', cb.title);
  cb.setAttribute('aria-pressed', t.done ? 'true' : 'false'); cb.setAttribute('tabindex', '0');
  cb.onclick = e => { e.stopPropagation(); toggleTask(t.id); };
  cb.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); toggleTask(t.id); } });

  const content = document.createElement('div'); content.className = 'task-main';
  const title = document.createElement('div'); title.className = 'task-title';
  const titleText = document.createElement('span'); titleText.className = 'task-title-text'; titleText.textContent = t.title;
  title.appendChild(titleText); content.appendChild(title);

  const tagsWrap = document.createElement('div'); tagsWrap.className = 'task-tags';
  const timeBadge = document.createElement('span'); timeBadge.className = 'time-spent';
  const timeSpentMs = totalTimeMs(t);
  if (timeSpentMs > 0) { timeBadge.textContent = _cb.formatDuration?.(timeSpentMs) ?? ''; timeBadge.hidden = false; }
  else { timeBadge.textContent = ''; timeBadge.hidden = true; }

  const timePresetTrigger = document.createElement('button');
  timePresetTrigger.type = 'button'; timePresetTrigger.className = 'time-preset-trigger';
  timePresetTrigger.textContent = '+'; timePresetTrigger.title = 'Добавить время';
  timePresetTrigger.setAttribute('aria-label', 'Добавить время');
  timePresetTrigger.onclick = e => { e.stopPropagation(); openTimePresetMenu(t.id, timePresetTrigger); };

  const timeLoader = document.createElement('span'); timeLoader.className = 'time-loading'; timeLoader.setAttribute('aria-hidden', 'true');
  const timeBox = document.createElement('div'); timeBox.className = 'time-inline-controls';
  timeBox.append(timeBadge, timePresetTrigger, timeLoader);
  applyInlineTimeControls(timeBox, t);

  const timerBtn = document.createElement('button');
  timerBtn.className = 'timer-btn task-btn--timer'; timerBtn.type = 'button';
  timerBtn.dataset.active = t.timerActive ? 'true' : 'false';
  timerBtn.title = t.timerActive ? 'Остановить таймер' : 'Запустить таймер';
  timerBtn.setAttribute('aria-label', 'Таймер задачи');
  timerBtn.setAttribute('aria-pressed', t.timerActive ? 'true' : 'false');
  timerBtn.onclick = e => { e.stopPropagation(); toggleTaskTimer(t.id); };
  timerBtn.disabled = !!_cb.isTimeUpdatePending?.(t.id) || (_cb.getTimeDialogTaskId?.() === t.id && _cb.isTimeDialogOpen?.());

  const noteBtn = document.createElement('button');
  noteBtn.className = 'note-btn task-btn--note'; noteBtn.type = 'button';
  noteBtn.setAttribute('aria-label', 'Заметки задачи'); noteBtn.title = 'Открыть заметки';
  noteBtn.onclick = e => { e.stopPropagation(); openNotesPanel(t.id); };
  noteBtn.dataset.hasNotes = t.notes && t.notes.trim() ? 'true' : 'false';

  const dueBtn = document.createElement('button');
  dueBtn.className = 'due-btn task-btn--deadline'; dueBtn.title = 'Установить дедлайн';
  dueBtn.setAttribute('aria-label', 'Дедлайн задачи');
  dueBtn.onclick = e => { e.stopPropagation(); _cb.openDuePicker?.(t.id, dueBtn); };

  const del = document.createElement('button');
  del.className = 'delete-btn'; del.type = 'button';
  del.setAttribute('aria-label', 'Удалить задачу'); del.title = 'Удалить задачу';
  del.textContent = '✕'; del.onclick = e => { e.stopPropagation(); handleDelete(t.id); };

  if (t.due) {
    const tag = document.createElement('span'); tag.className = 'due-tag';
    if (isDueToday(t.due)) tag.classList.add('is-today');
    else if (isDuePast(t.due)) tag.classList.add('is-overdue');
    tag.textContent = formatDue(t.due);
    tagsWrap.appendChild(tag);
  }
  if (t.project) {
    const ptag = document.createElement('span'); ptag.className = 'proj-tag';
    ptag.textContent = getProjectEmoji(t.project);
    tagsWrap.appendChild(ptag);
  }
  if (tagsWrap.childElementCount) content.appendChild(tagsWrap);

  const actions = document.createElement('div'); actions.className = 'task-actions';
  actions.append(timeBox, timerBtn, noteBtn, dueBtn);
  row.append(cb, content, actions, del);

  row.addEventListener('click', () => {
    if (activeEditId && activeEditId !== t.id) {
      const v = (activeInputEl?.value || '').trim();
      if (!v) { _cb.toast?.('Напиши, что нужно сделать'); activeInputEl && activeInputEl.focus(); return; }
      const id = activeEditId; activeEditId = null; activeInputEl = null;
      _cb.setSelectedTaskId?.(t.id);
      renameTask(id, v);
      return;
    }
    _cb.setSelectedTaskId?.(t.id);
    _cb.render?.();
  });
  row.addEventListener('dblclick', e => {
    const target = e.target && typeof e.target.closest === 'function' ? e.target : null;
    if (target && (target.closest('.task-checkbox') || target.closest('.task-actions') || target.closest('.delete-btn'))) return;
    e.stopPropagation();
    _cb.setSelectedTaskId?.(t.id);
    startEdit(row, t);
  });

  container.appendChild(row);
  if (hasChildren) {
    row.classList.add('has-children');
    const subWrap = document.createElement('div'); subWrap.className = 'subtasks';
    const inner = document.createElement('div'); inner.className = 'subtasks-inner';
    for (const c of childList) { renderTaskRow(c, depth + 1, inner, renderContext); }
    subWrap.appendChild(inner);
    container.appendChild(subWrap);
  }
}

// ── Инлайн-редактирование ──────────────────────────────────────────────────
export function startEdit(row, t) {
  const titleEl = row.querySelector('.task-title');
  const input = document.createElement('input');
  input.className = 'input';
  const originalTitle = typeof t.title === 'string' ? t.title : '';
  const isNewTask = !originalTitle.trim();
  input.value = originalTitle;
  input.placeholder = 'Название задачи…';
  input.addEventListener('mousedown', e => e.stopPropagation());
  input.addEventListener('click', e => e.stopPropagation());
  titleEl.replaceWith(input);
  input.focus();
  activeEditId = t.id; activeInputEl = input;
  let finished = false;
  const finish = () => { finished = true; activeEditId = null; activeInputEl = null; };
  const trySave = () => {
    if (finished || !input) return false;
    const v = (input.value || '').trim();
    if (!v) { _cb.toast?.('Напиши, что нужно сделать'); input.focus(); return false; }
    const id = t.id;
    finish();
    renameTask(id, v);
    return true;
  };
  const cancelEdit = () => {
    if (finished) return;
    finish();
    if (isNewTask) { handleDelete(t.id, { visibleOrder: getVisibleTaskIds() }); return; }
    _cb.setSelectedTaskId?.(t.id);
    _cb.render?.();
  };
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); trySave(); }
    else if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); cancelEdit(); }
  });
  input.addEventListener('blur', () => {
    if (finished) return;
    setTimeout(() => {
      if (finished) return;
      try { input.focus({ preventScroll: true }); } catch { input.focus(); }
    }, 0);
  });
}

// ── Сборка renderContext ────────────────────────────────────────────────────
export function buildRenderContext(dataList) {
  const visibleTaskIds = new Set();
  const visibleTaskMap = new Map();
  collectVisibleTaskMeta(dataList, visibleTaskIds, visibleTaskMap);
  return { visibleTaskIds, visibleTaskMap };
}
