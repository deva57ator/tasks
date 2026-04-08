import { SPRINT_UNASSIGNED_KEY } from './config.js';
import { normalizeDate, sameDay, isoWeekInfo, isoWeekStartDate } from './utils.js';
import { tasks, findTask } from './tasks-data.js';
import { Store, isServerMode } from './storage.js';
import { queueTaskUpdate } from './api.js';
import { getProjectMeta } from './projects.js';
import { openContextMenu, closeContextMenu } from './tasks-render.js';
import { closeDuePicker } from './due-picker.js';

// ── Коллбэки ───────────────────────────────────────────────────────────────
const _cb = {};
export function registerSprintCallbacks(cbs) { Object.assign(_cb, cbs); }

// ── Состояние ──────────────────────────────────────────────────────────────
let sprintDraggingId = null;
let sprintDropColumn = null;
export const sprintVisibleProjects = new Map();

// ── Вспомогательные функции ────────────────────────────────────────────────
export function sprintProjectKey(id) { return id == null ? SPRINT_UNASSIGNED_KEY : id; }

function isSprintProjectVisible(projectId) {
  const key = sprintProjectKey(projectId);
  return !sprintVisibleProjects.has(key) || sprintVisibleProjects.get(key) !== false;
}

function syncSprintFilterState(keys) {
  const set = new Set(keys);
  for (const key of keys) { if (!sprintVisibleProjects.has(key)) sprintVisibleProjects.set(key, true); }
  for (const key of Array.from(sprintVisibleProjects.keys())) { if (!set.has(key)) sprintVisibleProjects.delete(key); }
}

function setSprintDropColumn(col) {
  if (sprintDropColumn === col) return;
  if (sprintDropColumn) { sprintDropColumn.classList.remove('is-drop-target'); }
  sprintDropColumn = col || null;
  if (sprintDropColumn) { sprintDropColumn.classList.add('is-drop-target'); }
}

function clearSprintDragState() {
  const prev = document.querySelector('.sprint-task.is-dragging');
  if (prev) prev.classList.remove('is-dragging');
  setSprintDropColumn(null);
  sprintDraggingId = null;
}

function applySprintDrop(targetDate) {
  if (!sprintDraggingId) return;
  const task = findTask(sprintDraggingId);
  if (!task) return;
  const d = new Date(targetDate);
  if (isNaN(d)) return;
  d.setHours(0, 0, 0, 0);
  const iso = d.toISOString();
  if (task.due !== iso) {
    task.due = iso;
    Store.write(tasks);
    if (isServerMode()) queueTaskUpdate(task.id, { due: iso });
  }
  clearSprintDragState();
  _cb.render?.();
}

// ── Фильтры ────────────────────────────────────────────────────────────────
export function clearSprintFiltersUI() {
  const bar = document.getElementById('sprintFilters');
  if (!bar) return;
  bar.innerHTML = '';
  bar.classList.remove('is-active');
  bar.setAttribute('aria-hidden', 'true');
}

function renderSprintFiltersBar(entries) {
  const bar = document.getElementById('sprintFilters');
  if (!bar) return;
  bar.innerHTML = '';
  if (!entries.length) {
    bar.classList.remove('is-active');
    bar.setAttribute('aria-hidden', 'true');
    return;
  }
  bar.classList.add('is-active');
  bar.setAttribute('aria-hidden', 'false');
  for (const entry of entries) {
    const active = isSprintProjectVisible(entry.projectId);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sprint-filter-btn' + (active ? ' is-active' : '');
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    btn.dataset.projectKey = entry.key;
    btn.title = active ? 'Скрыть задачи проекта в спринте' : 'Показать задачи проекта в спринте';
    const emoji = document.createElement('span');
    emoji.className = 'sprint-filter-emoji';
    emoji.textContent = entry.emoji;
    const title = document.createElement('span');
    title.className = 'sprint-filter-title';
    title.textContent = entry.title;
    btn.append(emoji, title);
    btn.onclick = () => {
      const key = entry.key;
      const next = !isSprintProjectVisible(entry.projectId);
      sprintVisibleProjects.set(key, next);
      _cb.render?.();
    };
    bar.appendChild(btn);
  }
}

// ── Данные спринта ─────────────────────────────────────────────────────────
export function buildSprintData(list) {
  const map = new Map();
  function visit(t) {
    if (t.due) {
      const d = new Date(t.due);
      if (!isNaN(d)) {
        const wd = d.getDay();
        if (wd >= 1 && wd <= 5) {
          const { week, year } = isoWeekInfo(d);
          const key = year + ':' + week;
          if (!map.has(key)) map.set(key, { week, year, startDate: isoWeekStartDate(year, week), days: { 1: [], 2: [], 3: [], 4: [], 5: [] } });
          map.get(key).days[wd].push(t);
        }
      }
    }
    for (const c of t.children || []) visit(c);
  }
  for (const t of list) visit(t);
  return Array.from(map.values()).sort((a, b) => a.year === b.year ? a.week - b.week : a.year - b.year);
}

// ── Рендер ─────────────────────────────────────────────────────────────────
export function renderSprint(container) {
  const sprints = buildSprintData(tasks);
  if (!sprints.length) {
    renderSprintFiltersBar([]);
    sprintVisibleProjects.clear();
    const hint = document.createElement('div');
    hint.className = 'sprint-empty';
    hint.textContent = 'Нет задач с дедлайном — спринты появятся автоматически.';
    container.appendChild(hint);
    return;
  }
  const projectMap = new Map();
  for (const sp of sprints) {
    for (let i = 1; i <= 5; i++) {
      for (const task of sp.days[i] || []) {
        const key = sprintProjectKey(task.project);
        if (!projectMap.has(key)) {
          const meta = getProjectMeta(task.project);
          projectMap.set(key, { key, projectId: task.project ?? null, emoji: meta.emoji, title: meta.title });
        }
      }
    }
  }
  const projectEntries = Array.from(projectMap.values());
  syncSprintFilterState(projectEntries.map(entry => entry.key));
  renderSprintFiltersBar(projectEntries);
  const todayDate = normalizeDate(new Date());
  const wrap = document.createElement('div');
  wrap.className = 'sprint';
  const dayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт'];
  let renderedWeeks = 0;
  for (const sp of sprints) {
    const hasVisibleTasks = [1, 2, 3, 4, 5].some(idx => (sp.days[idx] || []).some(task => isSprintProjectVisible(task.project)));
    if (!hasVisibleTasks) continue;
    renderedWeeks++;
    const row = document.createElement('div');
    row.className = 'sprint-row';
    const label = document.createElement('div');
    label.className = 'sprint-week';
    label.textContent = 'Неделя ' + String(sp.week).padStart(2, '0');
    const grid = document.createElement('div');
    grid.className = 'sprint-grid';
    const startDate = sp.startDate ? new Date(sp.startDate) : isoWeekStartDate(sp.year, sp.week);
    for (let i = 1; i <= 5; i++) {
      const col = document.createElement('div');
      col.className = 'sprint-col';
      const title = document.createElement('div');
      title.className = 'col-title';
      const dayDate = new Date(startDate);
      dayDate.setDate(dayDate.getDate() + i - 1);
      dayDate.setHours(0, 0, 0, 0);
      const dd = String(dayDate.getDate()).padStart(2, '0');
      const mm = String(dayDate.getMonth() + 1).padStart(2, '0');
      title.textContent = `${dayNames[i - 1]} ${dd}.${mm}`;
      col.dataset.date = dayDate.toISOString();
      if (sameDay(dayDate, todayDate)) col.classList.add('is-today');
      col.appendChild(title);
      col.addEventListener('dragenter', e => { if (!sprintDraggingId) return; const rel = e.relatedTarget; if (rel && col.contains(rel)) return; setSprintDropColumn(col); });
      col.addEventListener('dragover', e => { if (!sprintDraggingId) return; e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; setSprintDropColumn(col); });
      col.addEventListener('dragleave', e => { if (!sprintDraggingId) return; const rel = e.relatedTarget; if (rel && col.contains(rel)) return; setSprintDropColumn(null); });
      col.addEventListener('drop', e => { if (!sprintDraggingId) return; e.preventDefault(); const targetDate = col.dataset.date; if (targetDate) applySprintDrop(targetDate); else clearSprintDragState(); });
      const items = sp.days[i] || [];
      const visibleItems = items.filter(task => isSprintProjectVisible(task.project));
      if (!visibleItems.length) {
        const empty = document.createElement('div');
        empty.className = 'sprint-empty';
        empty.textContent = '—';
        col.appendChild(empty);
        grid.appendChild(col);
        continue;
      }
      const groups = []; const groupMap = new Map();
      for (const t of visibleItems) {
        const key = sprintProjectKey(t.project);
        if (!groupMap.has(key)) {
          const meta = getProjectMeta(t.project);
          const group = { id: key, emoji: meta.emoji, title: meta.title, tasks: [] };
          groupMap.set(key, group);
          groups.push(group);
        }
        groupMap.get(key).tasks.push(t);
      }
      for (const grp of groups) {
        const groupEl = document.createElement('div');
        groupEl.className = 'sprint-project-group';
        const tag = document.createElement('div');
        tag.className = 'sprint-project-tag';
        const emoji = document.createElement('span');
        emoji.className = 'sprint-project-emoji';
        emoji.textContent = grp.emoji;
        const name = document.createElement('span');
        name.className = 'sprint-project-name';
        name.textContent = grp.title;
        tag.append(emoji, name);
        groupEl.appendChild(tag);
        for (const t of grp.tasks) {
          const it = document.createElement('div');
          it.className = 'sprint-task';
          it.setAttribute('draggable', 'true');
          if (t.done) it.classList.add('is-done');
          it.addEventListener('dragstart', e => { sprintDraggingId = t.id; it.classList.add('is-dragging'); setSprintDropColumn(null); try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', t.id); } catch {} closeContextMenu(); closeDuePicker(); });
          it.addEventListener('dragend', () => { clearSprintDragState(); });
          it.addEventListener('contextmenu', e => { e.preventDefault(); openContextMenu(t.id, e.clientX, e.clientY); });
          const taskTitle = document.createElement('div');
          taskTitle.className = 'sprint-task-title';
          taskTitle.textContent = t.title;
          it.append(taskTitle);
          groupEl.appendChild(it);
        }
        col.appendChild(groupEl);
      }
      grid.appendChild(col);
    }
    row.append(label, grid);
    wrap.appendChild(row);
  }
  if (renderedWeeks === 0) {
    const empty = document.createElement('div');
    empty.className = 'sprint-empty';
    empty.textContent = 'Нет задач для выбранных проектов.';
    container.appendChild(empty);
    return;
  }
  container.appendChild(wrap);
}
