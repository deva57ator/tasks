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
