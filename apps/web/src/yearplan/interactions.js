import { YEAR_PLAN_COLORS } from '../config.js';
import { normalizeYearPlanColor } from './normalize.js';
import {
  yearPlanSelectedId,
  findYearPlanItem, upsertYearPlanItem, updateYearPlanItemInCache, deleteYearPlanItem,
  yearPlanProvider,
} from './data.js';

const _cb = {};
export function registerYearPlanInteractionsCallbacks(cbs) { Object.assign(_cb, cbs); }
function toast(msg) { _cb.toast?.(msg); }
function closeContextMenu() { _cb.closeContextMenu?.(); }
function openProjectAssignSubmenu(opts) { _cb.openProjectAssignSubmenu?.(opts); }
function closeAssignSubmenu() { _cb.closeAssignSubmenu?.(); }
function maybeCloseSubmenu() { _cb.maybeCloseSubmenu?.(); }
function setYearPlanSelected(id) { _cb.setYearPlanSelected?.(id); }
function clearYearPlanSelection() { _cb.clearYearPlanSelection?.(); }
function startYearPlanRename(id) { _cb.startYearPlanRename?.(id); }
function setYearPlanHover(id) { _cb.setYearPlanHover?.(id); }
function clearYearPlanHover(id) { _cb.clearYearPlanHover?.(id); }
function navigateToProject(projectId) { _cb.navigateToProject?.(projectId); }

export const YearPlanCtx = { el: document.createElement('div'), activityId: null };
YearPlanCtx.el.className = 'context-menu year-plan-context-menu';
YearPlanCtx.el.setAttribute('role', 'menu');
YearPlanCtx.el.setAttribute('aria-hidden', 'true');
document.body.appendChild(YearPlanCtx.el);

export function closeYearPlanContextMenu() {
  YearPlanCtx.activityId = null;
  YearPlanCtx.el.style.display = 'none';
  YearPlanCtx.el.setAttribute('aria-hidden', 'true');
  closeAssignSubmenu();
}

export async function setYearPlanProject(id, projectId) {
  const item = findYearPlanItem(id);
  if (!item) return;
  const year = item.year;
  const previous = item.projectId ?? null;
  updateYearPlanItemInCache(id, year, { projectId });
  _cb.renderIfVisible?.();
  try {
    const updated = await yearPlanProvider.update(id, { projectId });
    if (updated) upsertYearPlanItem(updated);
  } catch (err) {
    toast('Не удалось назначить проект');
    updateYearPlanItemInCache(id, year, { projectId: previous });
    _cb.renderIfVisible?.();
  }
}

export async function setYearPlanColor(id, color) {
  const item = findYearPlanItem(id);
  if (!item) return;
  const year = item.year;
  const nextColor = normalizeYearPlanColor(color);
  const previous = normalizeYearPlanColor(item.color);
  if (nextColor === previous) return;
  updateYearPlanItemInCache(id, year, { color: nextColor });
  _cb.renderIfVisible?.();
  try {
    const updated = await yearPlanProvider.update(id, { color: nextColor });
    if (updated) upsertYearPlanItem(updated);
  } catch (err) {
    toast('Не удалось изменить цвет');
    updateYearPlanItemInCache(id, year, { color: previous });
    _cb.renderIfVisible?.();
  }
}

function openYearPlanAssignSubmenu(id, anchorItem) {
  const item = findYearPlanItem(id);
  const currentProjectId = item ? item.projectId ?? null : null;
  openProjectAssignSubmenu({
    anchorItem,
    currentProjectId,
    onAssign: async projId => { await setYearPlanProject(id, projId); closeYearPlanContextMenu(); },
    onClear: async () => { await setYearPlanProject(id, null); closeYearPlanContextMenu(); }
  });
}

export function openYearPlanContextMenu(id, x, y) {
  setYearPlanSelected(id);
  closeAssignSubmenu();
  YearPlanCtx.activityId = id;
  YearPlanCtx.el.innerHTML = '';
  const item = findYearPlanItem(id);
  if (item && item.projectId) {
    const goToProject = document.createElement('div');
    goToProject.className = 'context-item';
    goToProject.textContent = 'К проекту';
    goToProject.onclick = () => {
      const targetProjectId = item.projectId;
      closeYearPlanContextMenu();
      if (targetProjectId) navigateToProject(targetProjectId);
    };
    YearPlanCtx.el.appendChild(goToProject);
  }
  const assign = document.createElement('div');
  assign.className = 'context-item has-submenu';
  assign.textContent = 'Проект';
  assign.addEventListener('mouseenter', () => { openYearPlanAssignSubmenu(id, assign); });
  assign.addEventListener('mouseleave', () => maybeCloseSubmenu());
  YearPlanCtx.el.appendChild(assign);
  const rename = document.createElement('div');
  rename.className = 'context-item';
  rename.textContent = 'Переименовать';
  rename.onclick = () => { closeYearPlanContextMenu(); startYearPlanRename(id); };
  YearPlanCtx.el.appendChild(rename);
  const remove = document.createElement('div');
  remove.className = 'context-item';
  remove.textContent = 'Удалить';
  remove.onclick = () => { closeYearPlanContextMenu(); deleteYearPlanItem(id); };
  YearPlanCtx.el.appendChild(remove);
  const palette = document.createElement('div');
  palette.className = 'year-plan-color-palette';
  const currentColor = normalizeYearPlanColor(item ? item.color : null);
  for (const color of YEAR_PLAN_COLORS) {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'year-plan-color-swatch';
    if (color.toLowerCase() === currentColor.toLowerCase()) swatch.classList.add('is-active');
    swatch.style.background = color;
    swatch.title = 'Изменить цвет';
    swatch.setAttribute('aria-label', 'Изменить цвет');
    const handleColorSelect = async () => {
      await setYearPlanColor(id, color);
      closeYearPlanContextMenu();
      clearYearPlanSelection();
    };
    swatch.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      handleColorSelect();
    });
    swatch.addEventListener('click', e => {
      if (e.detail !== 0) return;
      e.stopPropagation();
      handleColorSelect();
    });
    palette.appendChild(swatch);
  }
  YearPlanCtx.el.appendChild(palette);
  YearPlanCtx.el.style.display = 'block';
  const mw = YearPlanCtx.el.offsetWidth;
  const mh = YearPlanCtx.el.offsetHeight;
  const px = Math.min(x, window.innerWidth - mw - 8);
  const py = Math.min(y, window.innerHeight - mh - 8);
  YearPlanCtx.el.style.left = px + 'px';
  YearPlanCtx.el.style.top = py + 'px';
  YearPlanCtx.el.setAttribute('aria-hidden', 'false');
}

export function bindYearPlanActivityHover(el, id) {
  el.dataset.yearActivityId = String(id);
  el.addEventListener('mouseenter', () => setYearPlanHover(id));
  el.addEventListener('mouseleave', event => {
    if (!event || !event.relatedTarget || typeof event.relatedTarget.closest !== 'function') { clearYearPlanHover(id); return; }
    const related = event.relatedTarget.closest('[data-year-activity-id]');
    if (related && related.dataset.yearActivityId === String(id)) return;
    clearYearPlanHover(id);
  });
}

export function bindYearPlanActivitySelect(el, id) {
  el.dataset.yearActivityId = String(id);
  el.addEventListener('click', e => { e.stopPropagation(); setYearPlanSelected(id); });
}

export function bindYearPlanActivityContext(el, id) {
  el.dataset.yearActivityId = String(id);
  el.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); closeContextMenu(); openYearPlanContextMenu(id, e.clientX, e.clientY); });
}
