// DOM-хелперы
export const $ = s => document.querySelector(s);
export const $$ = s => Array.from(document.querySelectorAll(s));

// Экранирование для использования в HTML-атрибутах
export function escapeAttributeValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// Поиск DOM-строки задачи по id
export function getTaskRowById(id) {
  if (!id) return null;
  const safe = escapeAttributeValue(id);
  return document.querySelector(`.task[data-id="${safe}"]`);
}

// Типы input, не являющиеся текстовыми
export const NON_TEXT_INPUT_TYPES = new Set(['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file']);

// Находится ли фокус в редактируемом элементе (для блокировки горячих клавиш)
export function isEditableShortcutTarget(target) {
  if (!target) return false;
  const element = target instanceof Element ? target : target.parentElement;
  if (!element) return false;
  if (element.isContentEditable) return true;
  const el = element.closest('input, textarea, select');
  if (!el) return false;
  if (el.tagName === 'INPUT') {
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    return !NON_TEXT_INPUT_TYPES.has(type);
  }
  return true;
}

// Генератор уникальных id
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

// Проверки дедлайнов
export function isDueToday(iso) {
  if (!iso) return false;
  const d = new Date(iso);
  if (isNaN(d)) return false;
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

export function isDuePast(iso) {
  if (!iso) return false;
  const d = new Date(iso);
  if (isNaN(d)) return false;
  if (isDueToday(iso)) return false;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  return d.getTime() < todayStart.getTime();
}

// Рекурсивная фильтрация дерева задач
export function filterTree(list, pred) {
  const out = [];
  for (const t of list) {
    const kids = t.children || [];
    const fk = filterTree(kids, pred);
    if (pred(t) || fk.length) { out.push({ ...t, children: fk }); }
  }
  return out;
}

// Ограничение времени задачи в допустимый диапазон [0, MAX_TASK_TIME_MS]
import { MAX_TASK_TIME_MS } from './config.js';
export function clampTimeSpentMs(value) {
  const ms = Number(value);
  if (!Number.isFinite(ms)) return 0;
  return Math.min(MAX_TASK_TIME_MS, Math.max(0, ms));
}

// Количество дней в месяце (monthIndex: 0=январь)
export function getDaysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

// Форматирование дедлайна в формат DD.MM
export function formatDue(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}`;
}

// Нормализация даты (сброс времени до 00:00:00)
export function normalizeDate(value) {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Одинаковый ли день у двух дат
export function sameDay(a, b) {
  return !!(a && b) && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// Номер ISO-недели по дате (только число, без года)
export function isoWeekNumber(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const diff = date - firstThursday;
  return 1 + Math.round(diff / (7 * 24 * 3600 * 1000));
}

// Матрица дней для месяца (недели × дни)
export function buildMonthMatrix(y, m, { minVisibleDays = 1, maxWeeks = 6 } = {}) {
  const first = new Date(y, m, 1);
  const startDay = (first.getDay() + 6) % 7;
  const weeks = [];
  let day = 1 - startDay;
  const today = normalizeDate(new Date());
  while (true) {
    const week = { weekNum: null, days: [] };
    for (let i = 0; i < 7; i++) {
      const d = new Date(y, m, day);
      const inMonth = d.getMonth() === m;
      const isToday = sameDay(d, today);
      week.days.push({ d, inMonth, isToday });
      day++;
    }
    const thursday = new Date(week.days[3].d);
    week.weekNum = isoWeekNumber(thursday);
    weeks.push(week);
    const lastDay = week.days[6].d;
    if (lastDay.getMonth() > m || (y < lastDay.getFullYear() && lastDay.getMonth() === 0)) break;
    if (weeks.length > 6) break;
  }
  const countInMonth = week => week.days.reduce((acc, cell) => acc + (cell.inMonth ? 1 : 0), 0);
  while (weeks.length && countInMonth(weeks[0]) < minVisibleDays) weeks.shift();
  while (weeks.length && countInMonth(weeks[weeks.length - 1]) < minVisibleDays) weeks.pop();
  if (maxWeeks && weeks.length > maxWeeks) {
    while (weeks.length > maxWeeks) {
      const firstCount = countInMonth(weeks[0]);
      const lastCount = countInMonth(weeks[weeks.length - 1]);
      if (firstCount <= lastCount) { weeks.shift(); } else { weeks.pop(); }
    }
  }
  return weeks;
}

// Рендер сетки месяца в контейнер, возвращает недели
export function renderMonthInto(container, y, m, options) {
  const weeks = buildMonthMatrix(y, m, options);
  const wrap = document.createElement('div');
  wrap.className = 'cal-grid';
  weeks.forEach(week => {
    const row = document.createElement('div');
    row.className = 'cal-week';
    const wn = document.createElement('div');
    wn.className = 'cal-weeknum';
    wn.textContent = String(week.weekNum).padStart(2, '0');
    row.appendChild(wn);
    for (const cell of week.days) {
      const el = document.createElement('div');
      el.className = 'cal-day';
      if (!cell.inMonth) el.classList.add('is-out');
      if (cell.isToday) el.classList.add('is-today');
      el.textContent = cell.d.getDate();
      row.appendChild(el);
    }
    wrap.appendChild(row);
  });
  container.innerHTML = '';
  container.appendChild(wrap);
  return weeks;
}

// Дата начала ISO-недели (понедельник)
export function isoWeekStartDate(year, week) {
  const simple = new Date(year, 0, 4);
  const day = (simple.getDay() + 6) % 7;
  const monday = new Date(simple);
  monday.setDate(simple.getDate() - day + (week - 1) * 7);
  return normalizeDate(monday);
}

// ISO-неделя по дате (ISO 8601)
export function isoWeekInfo(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const weekYear = date.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(weekYear, 0, 4));
  const diff = date - firstThursday;
  const week = 1 + Math.round(diff / (7 * 24 * 3600 * 1000));
  return { week, year: weekYear };
}
