import { STORAGE_MODES, API_PREFIX } from './config.js';

// Реестр коллбэков из main.js / api.js — регистрируются после инициализации.
// Позволяет storage.js не зависеть от api.js напрямую (избегаем цикл).
const _cb = {};
export function registerStorageCallbacks(cbs) { Object.assign(_cb, cbs); }

// ---------------------------------------------------------------------------
// Режим хранилища
// ---------------------------------------------------------------------------

export const StorageModeStore = {
  key: 'mini-task-tracker:storage-mode',
  read() { return localStorage.getItem(this.key) || 'local'; },
  write(mode) { localStorage.setItem(this.key, mode); }
};

// Live binding: другие модули читают актуальное значение напрямую через импорт.
// Мутировать извне — только через setStorageMode().
export let storageMode = StorageModeStore.read();
if (storageMode !== STORAGE_MODES.SERVER) storageMode = STORAGE_MODES.LOCAL;

export function setStorageMode(mode) { storageMode = mode; }
export function isServerMode() { return storageMode === STORAGE_MODES.SERVER; }

// ---------------------------------------------------------------------------
// API-ключ
// ---------------------------------------------------------------------------

export const ApiKeyStore = {
  keyPrefix: 'tasks_api_key:',
  storageKey() { return `${this.keyPrefix}${API_PREFIX}`; },
  read() { return localStorage.getItem(this.storageKey()) || ''; },
  write(value) {
    if (!value) { localStorage.removeItem(this.storageKey()); return; }
    localStorage.setItem(this.storageKey(), value);
  },
  clear() { localStorage.removeItem(this.storageKey()); }
};

// ---------------------------------------------------------------------------
// Задачи
// ---------------------------------------------------------------------------

export const Store = {
  key: 'mini-task-tracker:text:min:v14',
  read() {
    try { return JSON.parse(localStorage.getItem(this.key)) || []; } catch { return []; }
  },
  write(d) {
    if (isServerMode()) { _cb.onServerTaskWrite?.(d); return; }
    localStorage.setItem(this.key, JSON.stringify(d));
    _cb.afterTasksPersisted?.();
  }
};

// ---------------------------------------------------------------------------
// Тема
// ---------------------------------------------------------------------------

export const ThemeStore = {
  key: 'mini-task-tracker:theme',
  read() { return localStorage.getItem(this.key) || 'light'; },
  write(v) { localStorage.setItem(this.key, v); }
};

export const ThemePaletteStore = {
  key: 'mini-task-tracker:theme-palette',
  read() { return localStorage.getItem(this.key) || ''; },
  write(v) { localStorage.setItem(this.key, v); }
};

export const FontStore = {
  key: 'mini-task-tracker:font',
  read() { return localStorage.getItem(this.key) || 'plex'; },
  write(v) { localStorage.setItem(this.key, v); }
};

// ---------------------------------------------------------------------------
// Проекты
// ---------------------------------------------------------------------------

export const ProjectsStore = {
  key: 'mini-task-tracker:projects',
  read() {
    try { return JSON.parse(localStorage.getItem(this.key)) || []; } catch { return []; }
  },
  write(d) {
    if (isServerMode()) { _cb.onServerProjectsWrite?.(d); return; }
    localStorage.setItem(this.key, JSON.stringify(d));
  }
};

// ---------------------------------------------------------------------------
// Рабочий день
// ---------------------------------------------------------------------------

export function normalizeWorkdayState(raw) {
  if (!raw || typeof raw !== 'object' || !raw.id) return null;
  const normalized = { ...raw };
  if (typeof normalized.start !== 'number' || !isFinite(normalized.start)) normalized.start = null;
  if (typeof normalized.end !== 'number' || !isFinite(normalized.end)) normalized.end = null;
  if (typeof normalized.closedAt !== 'number' || !isFinite(normalized.closedAt)) normalized.closedAt = null;
  if (typeof normalized.finalTimeMs !== 'number' || !isFinite(normalized.finalTimeMs)) normalized.finalTimeMs = 0;
  if (typeof normalized.finalDoneCount !== 'number' || !isFinite(normalized.finalDoneCount)) normalized.finalDoneCount = 0;
  if (!normalized.baseline || typeof normalized.baseline !== 'object') normalized.baseline = {};
  if (!normalized.completed || typeof normalized.completed !== 'object') normalized.completed = {};
  normalized.locked = normalized.locked === true;
  const manualStats = normalized.manualClosedStats;
  const manualTime = manualStats && typeof manualStats.timeMs === 'number' && isFinite(manualStats.timeMs) ? Math.max(0, manualStats.timeMs) : 0;
  const manualDone = manualStats && typeof manualStats.doneCount === 'number' && isFinite(manualStats.doneCount) ? Math.max(0, Math.round(manualStats.doneCount)) : 0;
  normalized.manualClosedStats = { timeMs: manualTime, doneCount: manualDone };
  normalized.closedManually = normalized.closedManually === true;
  if (typeof normalized.reopenedAt !== 'number' || !isFinite(normalized.reopenedAt)) normalized.reopenedAt = null;
  return normalized;
}

const WORKDAY_STORAGE_KEY = 'mini-task-tracker:workday';
const WORKDAY_SERVER_STORAGE_KEY = `${WORKDAY_STORAGE_KEY}:server`;

export const WorkdayStore = {
  key: WORKDAY_STORAGE_KEY,
  serverKey: WORKDAY_SERVER_STORAGE_KEY,
  getKey(mode = storageMode) { return mode === STORAGE_MODES.SERVER ? this.serverKey : this.key; },
  read({ mode, allowLegacyFallback = true } = {}) {
    const targetMode = mode === STORAGE_MODES.SERVER ? STORAGE_MODES.SERVER : mode === STORAGE_MODES.LOCAL ? STORAGE_MODES.LOCAL : storageMode;
    const key = this.getKey(targetMode);
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = normalizeWorkdayState(JSON.parse(raw));
        if (parsed) return parsed;
      }
    } catch {}
    if (targetMode === STORAGE_MODES.SERVER && allowLegacyFallback) {
      try {
        const legacyRaw = localStorage.getItem(this.key);
        if (legacyRaw) {
          const legacyState = normalizeWorkdayState(JSON.parse(legacyRaw));
          if (legacyState) {
            this.write(legacyState, { mode: STORAGE_MODES.SERVER, skipServerSync: true });
            return legacyState;
          }
        }
      } catch {}
    }
    return null;
  },
  write(state, { mode, skipServerSync = false } = {}) {
    const targetMode = mode === STORAGE_MODES.SERVER ? STORAGE_MODES.SERVER : mode === STORAGE_MODES.LOCAL ? STORAGE_MODES.LOCAL : storageMode;
    const key = this.getKey(targetMode);
    if (!state) {
      localStorage.removeItem(key);
      if (targetMode === STORAGE_MODES.SERVER && !skipServerSync && storageMode === STORAGE_MODES.SERVER) {
        _cb.onServerWorkdayWrite?.(null);
      }
      return;
    }
    try { localStorage.setItem(key, JSON.stringify(state)); } catch {}
    if (targetMode === STORAGE_MODES.SERVER && !skipServerSync && storageMode === STORAGE_MODES.SERVER) {
      _cb.onServerWorkdayWrite?.(state);
    }
  }
};

export function persistLocalWorkdayState(state, { mode } = {}) {
  const targetMode = mode === STORAGE_MODES.SERVER ? STORAGE_MODES.SERVER : mode === STORAGE_MODES.LOCAL ? STORAGE_MODES.LOCAL : storageMode;
  try {
    const normalized = normalizeWorkdayState(state);
    if (!normalized) {
      WorkdayStore.write(null, { mode: targetMode, skipServerSync: true });
    } else {
      WorkdayStore.write(normalized, { mode: targetMode, skipServerSync: true });
    }
  } catch {
    WorkdayStore.write(null, { mode: targetMode, skipServerSync: true });
  }
}

// ---------------------------------------------------------------------------
// Архив
// ---------------------------------------------------------------------------

export const ArchiveStore = {
  key: 'mini-task-tracker:archive:v1',
  read() {
    try {
      const raw = JSON.parse(localStorage.getItem(this.key));
      if (!Array.isArray(raw)) return [];
      return raw.filter(item => item && typeof item === 'object');
    } catch { return []; }
  },
  write(d) {
    if (isServerMode()) { _cb.onServerArchiveWrite?.(d); return; }
    localStorage.setItem(this.key, JSON.stringify(d));
  }
};

// ---------------------------------------------------------------------------
// Активные таймеры
// ---------------------------------------------------------------------------

export const ActiveTimersStore = {
  key: 'mini-task-tracker:active-timers:v1',
  serverKey: 'mini-task-tracker:active-timers:v1:server',
  getKey(mode = storageMode) { return mode === STORAGE_MODES.SERVER ? this.serverKey : this.key; },
  read({ mode } = {}) {
    const targetMode = mode === STORAGE_MODES.SERVER ? STORAGE_MODES.SERVER : STORAGE_MODES.LOCAL;
    const key = this.getKey(targetMode);
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return {};
      const normalized = {};
      for (const [taskId, entry] of Object.entries(parsed)) {
        if (typeof taskId !== 'string' || !taskId) continue;
        const start = Number(entry && entry.start);
        if (!Number.isFinite(start)) continue;
        const base = Number(entry && entry.base);
        normalized[taskId] = { start: Math.max(0, start), base: Number.isFinite(base) && base >= 0 ? Math.max(0, base) : 0 };
      }
      return normalized;
    } catch { return {}; }
  },
  write(data, { mode } = {}) {
    const targetMode = mode === STORAGE_MODES.SERVER ? STORAGE_MODES.SERVER : STORAGE_MODES.LOCAL;
    const key = this.getKey(targetMode);
    try {
      if (!data || typeof data !== 'object' || !Object.keys(data).length) {
        localStorage.removeItem(key);
        return;
      }
      localStorage.setItem(key, JSON.stringify(data));
    } catch {}
  }
};
