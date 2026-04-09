import { DEFAULT_PROJECT_EMOJI, YEAR_PLAN_DEFAULT_TITLE } from './config.js';
import { uid, $ } from './utils.js';
import { ProjectsStore, isServerMode } from './storage.js';
import { queueProjectCreate, queueProjectUpdate, queueProjectDelete } from './api.js';
import {
  yearPlanProvider, yearPlanCache, yearPlanYear,
  removeYearPlanItemFromCache, upsertYearPlanItem, updateYearPlanItemInCache,
  getYearPlanItemsForProject, ensureYearPlanData,
} from './yearplan/data.js';
import { formatYearPlanRangeLabel } from './yearplan/normalize.js';

// ── Состояние ──────────────────────────────────────────────────────────────
export let projects = [];
export function setProjects(list) { projects = list; }

// ── Коллбэки ───────────────────────────────────────────────────────────────
const _cb = {};
export function registerProjectsCallbacks(cbs) { Object.assign(_cb, cbs); }

// ── DOM-ссылки ─────────────────────────────────────────────────────────────
const projList = $('#projList');
const projAdd = $('#projAdd');
const ProjCtx = { el: document.getElementById('projCtxMenu'), id: null, anchor: null };
const emojiPickerHost = document.getElementById('emojiMenu');
const EmojiPicker = { projectId: null, anchor: null, element: null };
const ProjectDeleteDialog = {
  overlay: document.getElementById('projectDeleteOverlay'),
  dialog: document.getElementById('projectDeleteDialog'),
  list: document.getElementById('projectDeleteList'),
  confirm: document.getElementById('projectDeleteConfirm'),
  detach: document.getElementById('projectDeleteDetach'),
  projectId: null,
  items: [],
};

// ── Нормализация ───────────────────────────────────────────────────────────
export function normalizeProjectsList(list, { persist = false } = {}) {
  if (!Array.isArray(list)) return [];
  let patched = false;
  for (const proj of list) {
    if (!proj || typeof proj !== 'object') continue;
    if (!('emoji' in proj) || proj.emoji === undefined) { proj.emoji = null; patched = true; continue }
    if (proj.emoji !== null && typeof proj.emoji !== 'string') { proj.emoji = null; patched = true; continue }
    if (typeof proj.emoji === 'string') {
      const trimmed = proj.emoji.trim();
      if (!trimmed) { proj.emoji = null; patched = true }
      else if (trimmed !== proj.emoji) { proj.emoji = trimmed; patched = true }
    }
  }
  if (patched && persist) { ProjectsStore.write(list) }
  return list
}

// ── Геттеры проекта ────────────────────────────────────────────────────────
export function getProjectTitle(id) { if (!id) return 'Без проекта'; const p = projects.find(x => x.id === id); return p ? p.title : 'Проект' }
export function getProjectEmoji(id) { const p = projects.find(x => x.id === id); if (!p) return DEFAULT_PROJECT_EMOJI; if (typeof p.emoji === 'string') { const trimmed = p.emoji.trim(); if (trimmed) return trimmed } return DEFAULT_PROJECT_EMOJI }
export function getProjectMeta(id) { return { emoji: getProjectEmoji(id), title: getProjectTitle(id) } }

// ── Диалог удаления проекта ────────────────────────────────────────────────
export function openProjectDeleteDialog(projectId, items) {
  if (!ProjectDeleteDialog.overlay || !ProjectDeleteDialog.list) return;
  ProjectDeleteDialog.projectId = projectId;
  ProjectDeleteDialog.items = Array.isArray(items) ? items : [];
  ProjectDeleteDialog.list.innerHTML = '';
  for (const item of ProjectDeleteDialog.items) {
    const row = document.createElement('div');
    row.className = 'project-delete-item';
    const title = document.createElement('div');
    title.className = 'project-delete-item-title';
    title.textContent = item.title || YEAR_PLAN_DEFAULT_TITLE;
    const dates = document.createElement('div');
    dates.className = 'project-delete-item-dates';
    dates.textContent = formatYearPlanRangeLabel(item);
    row.append(title, dates);
    ProjectDeleteDialog.list.appendChild(row);
  }
  ProjectDeleteDialog.overlay.classList.add('is-open');
  ProjectDeleteDialog.overlay.setAttribute('aria-hidden', 'false');
}

export function closeProjectDeleteDialog() {
  if (!ProjectDeleteDialog.overlay) return;
  ProjectDeleteDialog.projectId = null;
  ProjectDeleteDialog.items = [];
  ProjectDeleteDialog.overlay.classList.remove('is-open');
  ProjectDeleteDialog.overlay.setAttribute('aria-hidden', 'true');
}

// ── Emoji picker ───────────────────────────────────────────────────────────
function ensureEmojiPicker() {
  if (EmojiPicker.element || !emojiPickerHost) return EmojiPicker.element;
  const picker = document.createElement('emoji-picker');
  picker.classList.add('emoji-picker-element');
  try { picker.setAttribute('locale', 'ru') } catch {}
  picker.addEventListener('emoji-click', event => {
    const unicode = event?.detail?.unicode;
    if (!unicode || !EmojiPicker.projectId) return;
    setProjectEmoji(EmojiPicker.projectId, unicode);
    closeEmojiPicker();
  });
  emojiPickerHost.appendChild(picker);
  EmojiPicker.element = picker;
  return picker;
}

export function closeEmojiPicker() {
  if (!emojiPickerHost) return;
  EmojiPicker.projectId = null;
  EmojiPicker.anchor = null;
  emojiPickerHost.style.display = 'none';
  emojiPickerHost.style.visibility = '';
  emojiPickerHost.setAttribute('aria-hidden', 'true');
}

export function openEmojiPicker(projectId, anchor) {
  if (!emojiPickerHost) return;
  if (EmojiPicker.projectId === projectId && emojiPickerHost.style.display === 'block') { closeEmojiPicker(); return }
  closeEmojiPicker();
  const picker = ensureEmojiPicker();
  EmojiPicker.projectId = projectId;
  EmojiPicker.anchor = anchor;
  if (picker) {
    const proj = projects.find(p => p.id === projectId);
    picker.value = proj && proj.emoji ? proj.emoji : '';
  }
  emojiPickerHost.style.display = 'block';
  emojiPickerHost.style.visibility = 'hidden';
  emojiPickerHost.setAttribute('aria-hidden', 'false');
  const rect = anchor.getBoundingClientRect();
  const hostRect = emojiPickerHost.getBoundingClientRect();
  const padding = 8;
  const availableWidth = Math.max(160, window.innerWidth - padding * 2);
  const width = hostRect.width || Math.min(availableWidth, 360);
  const height = hostRect.height || 360;
  const maxLeft = Math.max(padding, window.innerWidth - width - padding);
  const preferredLeft = Math.max(padding, rect.left);
  const left = Math.min(preferredLeft, maxLeft);
  const maxTop = Math.max(padding, window.innerHeight - height - padding);
  const preferredTop = Math.max(padding, rect.bottom + 6);
  const top = Math.min(preferredTop, maxTop);
  emojiPickerHost.style.left = left + 'px';
  emojiPickerHost.style.top = top + 'px';
  emojiPickerHost.style.visibility = 'visible';
}

export function setProjectEmoji(projectId, emoji) {
  const proj = projects.find(p => p.id === projectId);
  if (!proj) return;
  const normalized = typeof emoji === 'string' && emoji.trim() ? emoji.trim() : null;
  proj.emoji = normalized;
  ProjectsStore.write(projects);
  if (isServerMode()) queueProjectUpdate(projectId, { emoji: normalized });
  renderProjects();
  _cb.render?.();
}

// ── Рендер проектов ────────────────────────────────────────────────────────
export function renderProjects() {
  if (!projList) return;
  projList.innerHTML = '';
  if (!projects.length) { const hint = document.createElement('div'); hint.className = 'proj-item is-empty'; hint.textContent = 'Проектов нет'; projList.appendChild(hint); return }
  for (const p of projects) {
    const row = document.createElement('div'); row.className = 'proj-item'; row.dataset.id = p.id;
    const emojiBtn = document.createElement('button'); emojiBtn.type = 'button'; emojiBtn.className = 'emoji-btn'; emojiBtn.textContent = getProjectEmoji(p.id); emojiBtn.title = 'Эмодзи'; emojiBtn.onclick = e => { e.stopPropagation(); openEmojiPicker(p.id, emojiBtn) }; row.appendChild(emojiBtn);
    const name = document.createElement('div'); name.className = 'name'; name.textContent = p.title; row.appendChild(name);
    row.addEventListener('click', () => { closeEmojiPicker(); _cb.setCurrentView?.('project'); _cb.setCurrentProjectId?.(p.id); _cb.render?.() });
    row.addEventListener('contextmenu', e => { e.preventDefault(); closeEmojiPicker(); openProjMenu(p.id, e.clientX, e.clientY, row) });
    projList.appendChild(row)
  }
}

// ── Контекстное меню проекта ───────────────────────────────────────────────
export function openProjMenu(id, x, y, anchor) {
  ProjCtx.id = id; ProjCtx.anchor = anchor;
  const menu = ProjCtx.el; menu.innerHTML = '';
  const edit = document.createElement('div'); edit.className = 'context-item'; edit.textContent = 'Переименовать'; edit.onclick = () => { closeProjMenu(); startProjectRename(id, anchor) };
  const del = document.createElement('div'); del.className = 'context-item'; del.textContent = 'Удалить'; del.onclick = () => { closeProjMenu(); deleteProject(id) };
  menu.append(edit, del); menu.style.display = 'block';
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  const px = Math.min(x, window.innerWidth - mw - 8), py = Math.min(y, window.innerHeight - mh - 8);
  menu.style.left = px + 'px'; menu.style.top = py + 'px'; menu.setAttribute('aria-hidden', 'false');
}
export function closeProjMenu() { ProjCtx.id = null; ProjCtx.anchor = null; ProjCtx.el.style.display = 'none'; ProjCtx.el.setAttribute('aria-hidden', 'true') }

// ── CRUD проектов ──────────────────────────────────────────────────────────
export function startProjectRename(id, row) {
  closeEmojiPicker();
  if (!projList) return;
  const p = projects.find(pr => pr.id === id);
  if (!p) return;
  const target = row?.querySelector('.name') || [...projList.children].find(n => n.dataset.id === id)?.querySelector('.name');
  if (!target) return;
  const input = document.createElement('input'); input.className = 'proj-input'; input.value = p.title;
  target.replaceWith(input); input.focus(); input.select();
  let finished = false;
  const save = () => { if (finished) return; finished = true; const v = (input.value || '').trim(); if (!v) { _cb.toast?.('Назови проект'); input.focus(); finished = false; return } p.title = v; ProjectsStore.write(projects); if (isServerMode()) queueProjectUpdate(id, { title: v }); renderProjects() };
  const cancel = () => { if (finished) return; finished = true; renderProjects() };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save() } else if (e.key === 'Escape') { e.preventDefault(); cancel() } });
  input.addEventListener('blur', () => { if (!finished) save() });
}

export function removeProjectById(id) {
  const idx = projects.findIndex(p => p.id === id);
  if (idx === -1) return;
  projects.splice(idx, 1);
  ProjectsStore.write(projects);
  if (isServerMode()) queueProjectDelete(id);
  renderProjects();
  if (_cb.getCurrentProjectId?.() === id) {
    _cb.setCurrentProjectId?.(null);
    if (_cb.getCurrentView?.() === 'project') _cb.setCurrentView?.('all');
  }
  _cb.render?.();
  _cb.toast?.('Проект удалён');
}

export async function finalizeProjectDelete(projectId, { items, mode } = {}) {
  const initiatives = Array.isArray(items) ? items : [];
  removeProjectById(projectId);
  if (!initiatives.length) return;
  if (mode === 'delete') {
    for (const item of initiatives) {
      try {
        await yearPlanProvider.remove(item.id);
        removeYearPlanItemFromCache(item.id, item.year);
      } catch (err) {
        _cb.toast?.('Не удалось удалить инициативу');
      }
    }
  } else if (mode === 'detach') {
    for (const item of initiatives) {
      try {
        const updated = await yearPlanProvider.update(item.id, { projectId: null });
        if (updated) upsertYearPlanItem(updated);
        else updateYearPlanItemInCache(item.id, item.year, { projectId: null });
      } catch (err) {
        _cb.toast?.('Не удалось отвязать инициативу');
      }
    }
  }
  _cb.renderYearPlanIfVisible?.();
  _cb.render?.();
}

export async function deleteProject(id) {
  closeEmojiPicker();
  if (isServerMode() && !yearPlanCache.has(yearPlanYear)) {
    await ensureYearPlanData(yearPlanYear);
  }
  const initiatives = getYearPlanItemsForProject(id);
  if (initiatives.length) {
    openProjectDeleteDialog(id, initiatives);
    return;
  }
  removeProjectById(id);
}

// ── Инициализация ──────────────────────────────────────────────────────────
export function initProjects() {
  // Закрытие меню и picker по внешним событиям
  window.addEventListener('click', e => { if (!ProjCtx.el.contains(e.target)) closeProjMenu() });
  window.addEventListener('keydown', e => { if (e.key === 'Escape') closeProjMenu() });
  window.addEventListener('resize', closeProjMenu);
  window.addEventListener('scroll', closeProjMenu, true);
  window.addEventListener('click', e => { if (emojiPickerHost && emojiPickerHost.style.display === 'block' && !emojiPickerHost.contains(e.target) && !(EmojiPicker.anchor && EmojiPicker.anchor.contains(e.target))) closeEmojiPicker() });
  window.addEventListener('keydown', e => { if (e.key === 'Escape') closeEmojiPicker() });
  window.addEventListener('resize', closeEmojiPicker);
  window.addEventListener('scroll', closeEmojiPicker, true);

  // Кнопка добавления проекта
  if (projAdd && projList) {
    projAdd.addEventListener('click', () => {
      closeEmojiPicker();
      const placeholder = projList.firstElementChild;
      if (placeholder && placeholder.classList.contains('is-empty')) { placeholder.remove() }
      const row = document.createElement('div'); row.className = 'proj-item';
      const input = document.createElement('input'); input.className = 'proj-input'; input.placeholder = 'Название';
      row.appendChild(input);
      if (projList.firstChild) { projList.prepend(row) } else { projList.appendChild(row) }
      input.focus();
      let saved = false;
      const finish = save => {
        if (saved) return; saved = true;
        const v = (input.value || '').trim();
        if (save) {
          if (!v) { _cb.toast?.('Назови проект'); input.focus(); saved = false; return }
          const project = { id: uid(), title: v, emoji: null };
          projects.unshift(project);
          ProjectsStore.write(projects);
          if (isServerMode()) queueProjectCreate(project);
        }
        renderProjects();
      };
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); finish(true) } else if (e.key === 'Escape') { e.preventDefault(); finish(false) } });
      input.addEventListener('blur', () => { if (!saved) finish(true) });
    });
  }

  // Диалог подтверждения удаления проекта
  ProjectDeleteDialog.overlay && ProjectDeleteDialog.overlay.addEventListener('click', e => { if (e.target === ProjectDeleteDialog.overlay) closeProjectDeleteDialog() });
  ProjectDeleteDialog.confirm && ProjectDeleteDialog.confirm.addEventListener('click', async () => {
    const projectId = ProjectDeleteDialog.projectId;
    const items = ProjectDeleteDialog.items.slice();
    closeProjectDeleteDialog();
    if (!projectId) return;
    await finalizeProjectDelete(projectId, { items, mode: 'delete' });
  });
  ProjectDeleteDialog.detach && ProjectDeleteDialog.detach.addEventListener('click', async () => {
    const projectId = ProjectDeleteDialog.projectId;
    const items = ProjectDeleteDialog.items.slice();
    closeProjectDeleteDialog();
    if (!projectId) return;
    await finalizeProjectDelete(projectId, { items, mode: 'detach' });
  });
}
