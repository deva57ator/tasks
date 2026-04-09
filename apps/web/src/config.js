// Storage modes
export const STORAGE_MODES = { LOCAL: 'local', SERVER: 'server' };

// API routing — определяется по URL страницы
export const API_PREFIX = location.pathname.startsWith('/tasks-stg') ? '/tasks-stg' : '/tasks';
export const API_BASE = `${API_PREFIX}/api`;
export const api = path => `${API_BASE}${path}`;
export const API_ENV_LABEL = API_PREFIX === '/tasks-stg' ? 'STG' : 'PROD';

// Ограничения времени задачи
export const MIN_TASK_MINUTES = 0;
export const MAX_TASK_MINUTES = 1440;
export const MAX_TASK_TIME_MS = MAX_TASK_MINUTES * 60000;
export const TIME_PRESETS = [5, 15, 30, 45, 60, 120];

// Интервалы обновления
export const WORKDAY_REFRESH_INTERVAL = 60000;
export const TIME_UPDATE_INTERVAL = 1000;

// Рабочий день считается в фиксированной зоне GMT+3.
export const WORKDAY_TIMEZONE_OFFSET_MINUTES = 180;

// Задачи
export const MAX_TASK_DEPTH = 2;

// Локализация
export const MONTH_NAMES = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

// Проекты
export const DEFAULT_PROJECT_EMOJI = '📁';

// Спринт
export const SPRINT_UNASSIGNED_KEY = '__none__';

// Year Plan
export const YEAR_PLAN_MAX_DAYS = 31;
export const YEAR_PLAN_DAY_HEIGHT = 14;
export const YEAR_PLAN_DEFAULT_TITLE = 'активность';
export const YEAR_PLAN_COLUMN_GAP = 4;
export const YEAR_PLAN_ROW_GAP = 4;
export const YEAR_PLAN_MOVE_THRESHOLD = 4;
export const YEAR_PLAN_STORAGE_KEY = 'mini-task-tracker:yearplan:v1';
export const YEAR_PLAN_COLORS = [
  '#3A82F6',
  '#6C5CE7',
  '#00B894',
  '#0984E3',
  '#E17055',
  '#D63031',
  '#FDCB6E',
  '#00CEC9',
  '#E84393',
  '#636E72',
  '#2D3436',
  '#FAB1A0'
];
