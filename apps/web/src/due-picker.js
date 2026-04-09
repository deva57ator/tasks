import { MONTH_NAMES } from './config.js';
import { renderMonthInto } from './utils.js';
import { tasks, findTask } from './tasks-data.js';
import { Store, isServerMode } from './storage.js';
import { queueTaskUpdate } from './api.js';
import { closeContextMenu } from './tasks-render.js';

// ── Коллбэки ───────────────────────────────────────────────────────────────
const _cb = {};
export function registerDuePickerCallbacks(cbs) { Object.assign(_cb, cbs); }

// ── Состояние ──────────────────────────────────────────────────────────────
const Due = { el: document.getElementById('dueMenu'), taskId: null, y: null, m: null, anchor: null };
if (Due.el) {
  Due.el.dataset.fromContext = 'false';
  Due.el.addEventListener('mouseleave', () => {
    if (Due.el.dataset.fromContext === 'true') {
      setTimeout(() => {
        const anchor = Due.anchor;
        if (anchor && anchor.matches(':hover')) return;
        if (Due.el.matches(':hover')) return;
        closeDuePicker();
      }, 80);
    }
  });
}

export function getDueEl() { return Due.el; }
export function getDueAnchor() { return Due.anchor; }

let duePickerMinWidth = null;

function monthTitle(y, m) { return `${MONTH_NAMES[m]} ${y}`; }

// ── Ширина виджета ─────────────────────────────────────────────────────────
export function ensureDuePickerWidth(container) {
  if (!container) return;
  if (duePickerMinWidth !== null) { container.style.width = `${duePickerMinWidth}px`; return; }
  const title = container.querySelector('.cal-title');
  if (!title) return;
  const original = title.textContent;
  const prevVisibility = container.style.visibility;
  container.style.visibility = 'hidden';
  const sampleYear = '8888';
  let maxWidth = Math.ceil(container.offsetWidth);
  for (const monthName of MONTH_NAMES) {
    title.textContent = `${monthName} ${sampleYear}`;
    const width = Math.ceil(container.offsetWidth);
    if (width > maxWidth) maxWidth = width;
  }
  title.textContent = original;
  if (prevVisibility) container.style.visibility = prevVisibility;
  else container.style.removeProperty('visibility');
  duePickerMinWidth = maxWidth;
  container.style.width = `${duePickerMinWidth}px`;
}

// ── Построение виджета ─────────────────────────────────────────────────────
function buildDuePicker(y, m) {
  const cont = document.createElement('div');
  cont.className = 'due-picker';
  const header = document.createElement('div');
  header.className = 'cal-header';
  const todayBtn = document.createElement('button');
  todayBtn.className = 'cal-today';
  todayBtn.title = 'К текущему месяцу';
  const title = document.createElement('div');
  title.className = 'cal-title';
  title.textContent = monthTitle(y, m);
  const ctrls = document.createElement('div');
  ctrls.className = 'cal-ctrls';
  const prev = document.createElement('button');
  prev.className = 'cal-arrow';
  prev.textContent = '‹';
  const next = document.createElement('button');
  next.className = 'cal-arrow';
  next.textContent = '›';
  header.append(todayBtn, title, ctrls);
  ctrls.append(prev, next);
  const legend = document.createElement('div');
  legend.className = 'cal-legend';
  legend.innerHTML = '<div>n</div><div>Пн</div><div>Вт</div><div>Ср</div><div>Чт</div><div>Пт</div><div>Сб</div><div>Вс</div>';
  const viewport = document.createElement('div');
  viewport.className = 'cal-viewport';
  const monthEl = document.createElement('div');
  monthEl.className = 'cal-month';
  const track = document.createElement('div');
  track.className = 'cal-track';
  track.appendChild(monthEl);
  viewport.appendChild(track);
  cont.append(header, legend, viewport);
  function renderLocal() {
    renderMonthInto(monthEl, Due.y, Due.m);
    title.textContent = monthTitle(Due.y, Due.m);
  }
  prev.onclick = () => { let ny = Due.y, nm = Due.m - 1; if (nm < 0) { nm = 11; ny--; } Due.y = ny; Due.m = nm; renderLocal(); };
  next.onclick = () => { let ny = Due.y, nm = Due.m + 1; if (nm > 11) { nm = 0; ny++; } Due.y = ny; Due.m = nm; renderLocal(); };
  todayBtn.onclick = () => { const now = new Date(); Due.y = now.getFullYear(); Due.m = now.getMonth(); renderLocal(); };
  renderLocal();
  cont.addEventListener('click', e => {
    const dayEl = e.target.closest('.cal-day');
    if (!dayEl) return;
    const day = Number(dayEl.textContent);
    if (!Number.isFinite(day)) return;
    const d = new Date(Due.y, Due.m, day);
    if (isNaN(d)) return;
    d.setHours(0, 0, 0, 0);
    const iso = d.toISOString();
    const t = findTask(Due.taskId);
    if (!t) return;
    t.due = iso;
    Store.write(tasks);
    if (isServerMode()) queueTaskUpdate(t.id, { due: iso });
    if (Due.el && Due.el.dataset.fromContext === 'true') closeContextMenu();
    closeDuePicker();
    _cb.render?.();
  });
  return cont;
}

// ── Открытие/закрытие ──────────────────────────────────────────────────────
export function openDuePicker(taskId, anchor, options = {}) {
  Due.taskId = taskId;
  if (Due.anchor && Due.anchor !== anchor && Due.anchor.classList) { Due.anchor.classList.remove('is-submenu-open'); }
  Due.anchor = anchor || null;
  const existing = findTask(taskId);
  if (existing && existing.due) {
    const dueDate = new Date(existing.due);
    if (!isNaN(dueDate)) {
      Due.y = dueDate.getFullYear();
      Due.m = dueDate.getMonth();
    } else {
      const now = new Date();
      Due.y = now.getFullYear();
      Due.m = now.getMonth();
    }
  } else {
    const now = new Date();
    Due.y = now.getFullYear();
    Due.m = now.getMonth();
  }
  const menu = Due.el;
  if (!menu) return;
  menu.innerHTML = '';
  const content = buildDuePicker(Due.y, Due.m);
  menu.appendChild(content);
  menu.style.display = 'block';
  menu.setAttribute('aria-hidden', 'false');
  ensureDuePickerWidth(content);
  if (content.style.width) {
    menu.style.minWidth = content.style.width;
    menu.style.width = content.style.width;
  } else {
    menu.style.removeProperty('min-width');
    menu.style.removeProperty('width');
  }
  const fromContext = !!options.fromContext;
  menu.dataset.fromContext = fromContext ? 'true' : 'false';
  if (fromContext && anchor && anchor.classList) { anchor.classList.add('is-submenu-open'); }
  const r = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: 0, right: 0, top: 0, bottom: 0 };
  menu.style.position = 'fixed';
  const mw = menu.offsetWidth || (duePickerMinWidth || 300);
  const mh = menu.offsetHeight || 320;
  if (fromContext) {
    let px = r.right + 8;
    let py = r.top;
    if (px + mw > window.innerWidth - 8) px = Math.max(8, window.innerWidth - mw - 8);
    if (py + mh > window.innerHeight - 8) py = Math.max(8, window.innerHeight - mh - 8);
    menu.style.left = px + 'px';
    menu.style.top = py + 'px';
  } else {
    const px = Math.min(r.left, window.innerWidth - mw - 8);
    let py = r.bottom + 6;
    if (py + mh > window.innerHeight - 8) py = Math.max(8, window.innerHeight - mh - 8);
    menu.style.left = px + 'px';
    menu.style.top = py + 'px';
  }
}

export function closeDuePicker() {
  if (Due.anchor && Due.anchor.classList) { Due.anchor.classList.remove('is-submenu-open'); }
  Due.taskId = null;
  Due.anchor = null;
  if (Due.el) { Due.el.style.display = 'none'; Due.el.setAttribute('aria-hidden', 'true'); Due.el.dataset.fromContext = 'false'; }
}

window.addEventListener('click', e => {
  if (Due.el && Due.el.style.display === 'block' && !Due.el.contains(e.target) && !(Due.anchor && Due.anchor.contains(e.target)) && !e.target.closest('.due-btn')) closeDuePicker();
}, true);
