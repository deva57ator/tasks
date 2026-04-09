import { uid, clampTimeSpentMs, isDueToday, isDuePast } from './utils.js';
import { ArchiveStore, isServerMode } from './storage.js';
import { queueArchiveDelete } from './api.js';
import { getProjectMeta } from './projects.js';

// ── Коллбэки ───────────────────────────────────────────────────────────────
const _cb = {};
export function registerArchiveCallbacks(cbs) { Object.assign(_cb, cbs); }

// ── Нормализация ───────────────────────────────────────────────────────────
export function normalizeArchivedNode(node) {
  if (!node || typeof node !== 'object') return null;
  const normalized = {
    id: typeof node.id === 'string' && node.id.trim() ? node.id.trim() : uid(),
    title: typeof node.title === 'string' ? node.title : '',
    done: true,
    due: typeof node.due === 'string' && node.due ? node.due : null,
    project: typeof node.project === 'string' && node.project ? node.project : null,
    notes: typeof node.notes === 'string' ? node.notes : '',
    timeSpent: clampTimeSpentMs(node.timeSpent),
    archivedAt: typeof node.archivedAt === 'number' && isFinite(node.archivedAt) ? node.archivedAt : 0,
    completedAt: typeof node.completedAt === 'number' && isFinite(node.completedAt) ? node.completedAt : null,
    children: [],
  };
  if (Array.isArray(node.children)) {
    const kids = [];
    for (const child of node.children) {
      const normalizedChild = normalizeArchivedNode(child);
      if (normalizedChild) kids.push(normalizedChild);
    }
    normalized.children = kids;
  }
  return normalized;
}

export function normalizeArchiveList(list, { persist = false } = {}) {
  if (!Array.isArray(list)) return [];
  const normalizedArchive = [];
  let patched = false;
  for (const entry of list) {
    const normalized = normalizeArchivedNode(entry);
    if (normalized) { normalizedArchive.push(normalized); if (normalized !== entry) patched = true }
    else patched = true;
  }
  if ((patched || normalizedArchive.length !== list.length) && persist) { ArchiveStore.write(normalizedArchive) }
  return normalizedArchive;
}

export function normalizeArchivePayload(items) {
  if (!Array.isArray(items)) return [];
  return items.map(entry => entry && entry.payload ? entry.payload : entry).filter(Boolean);
}

// ── CRUD ───────────────────────────────────────────────────────────────────
export function removeArchivedTask(id, list) {
  if (!list) list = _cb.getArchivedTasks?.() ?? [];
  if (!Array.isArray(list)) return null;
  const index = list.findIndex(item => item && item.id === id);
  if (index !== -1) { const [removed] = list.splice(index, 1); return removed || null }
  for (const item of list) {
    if (item && Array.isArray(item.children) && item.children.length) {
      const removed = removeArchivedTask(id, item.children);
      if (removed) { return removed }
    }
  }
  return null;
}

// ── Рендер ─────────────────────────────────────────────────────────────────
function formatArchiveDateTime(ms) {
  if (typeof ms !== 'number' || !isFinite(ms) || ms <= 0) return null;
  const date = new Date(ms);
  if (isNaN(date)) return null;
  const timestamp = date.getTime();
  return `${_cb.formatDateDMY?.(timestamp)} ${_cb.formatTimeHM?.(timestamp)}`;
}

export function renderArchivedNode(node, depth, container) {
  if (!node) return;
  const row = document.createElement('div');
  row.className = 'archive-task'; row.dataset.id = node.id; row.dataset.depth = String(depth);
  if (depth > 0) row.style.marginLeft = `${depth * 18}px`;
  const status = document.createElement('div'); status.className = 'archive-status'; status.textContent = '✔';
  const main = document.createElement('div'); main.className = 'archive-main';
  const title = document.createElement('div'); title.className = 'archive-title'; title.textContent = node.title || 'Без названия';
  main.appendChild(title);
  const tags = document.createElement('div'); tags.className = 'archive-tags';
  if (node.due) {
    const dueTag = document.createElement('span'); dueTag.className = 'due-tag';
    if (isDueToday(node.due)) dueTag.classList.add('is-today');
    else if (isDuePast(node.due)) dueTag.classList.add('is-overdue');
    dueTag.textContent = _cb.formatDue?.(node.due);
    if (dueTag.textContent) tags.appendChild(dueTag);
  }
  if (node.project) {
    const projectMeta = getProjectMeta(node.project);
    const projTag = document.createElement('span'); projTag.className = 'proj-tag';
    const emoji = projectMeta.emoji ? `${projectMeta.emoji} ` : '';
    projTag.textContent = `${emoji}${projectMeta.title}`.trim();
    tags.appendChild(projTag);
  }
  if (tags.childElementCount) main.appendChild(tags);
  const meta = document.createElement('div'); meta.className = 'archive-meta';
  const completedText = formatArchiveDateTime(node.completedAt);
  if (completedText) meta.appendChild(document.createTextNode(`Завершено: ${completedText}`));
  const archivedText = formatArchiveDateTime(node.archivedAt);
  if (archivedText) {
    if (meta.textContent) meta.appendChild(document.createTextNode(' • '));
    meta.appendChild(document.createTextNode(`В архиве: ${archivedText}`));
  }
  if (meta.textContent) main.appendChild(meta);
  const actions = document.createElement('div'); actions.className = 'archive-actions';
  const time = document.createElement('div'); time.className = 'archive-time';
  time.textContent = _cb.formatDuration?.(node.timeSpent);
  actions.appendChild(time);
  const noteBtn = document.createElement('button'); noteBtn.className = 'note-btn'; noteBtn.type = 'button';
  noteBtn.textContent = '📝'; noteBtn.title = 'Заметки';
  noteBtn.setAttribute('aria-label', 'Заметки');
  noteBtn.dataset.hasNotes = node.notes && node.notes.trim() ? 'true' : 'false';
  noteBtn.onclick = e => { e.stopPropagation(); _cb.openNotesPanel?.(node.id, { source: 'archive' }) };
  actions.appendChild(noteBtn);
  const deleteBtn = document.createElement('button'); deleteBtn.className = 'archive-delete'; deleteBtn.type = 'button';
  deleteBtn.textContent = '✕'; deleteBtn.title = 'Удалить из архива';
  deleteBtn.setAttribute('aria-label', 'Удалить из архива');
  deleteBtn.onclick = e => {
    e.stopPropagation();
    const archivedTasks = _cb.getArchivedTasks?.() ?? [];
    const removed = removeArchivedTask(node.id, archivedTasks);
    if (removed) {
      ArchiveStore.write(archivedTasks);
      if (isServerMode()) queueArchiveDelete(node.id);
      if (_cb.getCurrentView?.() === 'archive') _cb.render?.();
    }
  };
  actions.appendChild(deleteBtn);
  row.append(status, main, actions);
  container.appendChild(row);
  if (Array.isArray(node.children) && node.children.length) {
    for (const child of node.children) { renderArchivedNode(child, depth + 1, container) }
  }
}

export function renderArchive(container) {
  const wrap = document.createElement('div'); wrap.className = 'archive-container';
  const archivedTasks = _cb.getArchivedTasks?.() ?? [];
  const items = [...archivedTasks];
  items.sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0) || (b.completedAt || 0) - (a.completedAt || 0));
  if (!items.length) {
    const empty = document.createElement('div'); empty.className = 'archive-empty'; empty.textContent = 'Архив пуст';
    container.appendChild(empty); return;
  }
  for (const item of items) { renderArchivedNode(item, 0, wrap) }
  container.appendChild(wrap);
}
