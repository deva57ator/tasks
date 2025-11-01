const STORAGE_MODE_KEY = 'mini-task-tracker:storage-mode';
const API_SETTINGS_KEY = 'mini-task-tracker:api-settings';
const TASKS_KEY = 'mini-task-tracker:text:min:v14';
const PROJECTS_KEY = 'mini-task-tracker:projects';
const ARCHIVE_KEY = 'mini-task-tracker:archive:v1';
const THEME_KEY = 'mini-task-tracker:theme';
const WORKDAY_KEY = 'mini-task-tracker:workday';
const WORKDAY_SERVER_KEY = `${WORKDAY_KEY}:server`;

export const STORAGE_MODES = {
  LOCAL: 'local',
  SERVER: 'server'
};

const isStaging = window.location.pathname.startsWith('/tasks-stg/');
export const DEFAULT_API_BASE = isStaging ? '/tasks-stg/api' : '/tasks/api';

const StorageModeStore = {
  read() {
    return localStorage.getItem(STORAGE_MODE_KEY) || STORAGE_MODES.LOCAL;
  },
  write(mode) {
    localStorage.setItem(STORAGE_MODE_KEY, mode);
  }
};

const ApiSettingsStore = {
  read() {
    try {
      const raw = JSON.parse(localStorage.getItem(API_SETTINGS_KEY) || '{}');
      return raw && typeof raw === 'object' ? raw : {};
    } catch (err) {
      return {};
    }
  },
  write(settings) {
    try {
      localStorage.setItem(API_SETTINGS_KEY, JSON.stringify(settings || {}));
    } catch (err) {
      console.warn('Failed to persist API settings', err);
    }
  }
};

let storageMode = StorageModeStore.read();
if (storageMode !== STORAGE_MODES.SERVER) {
  storageMode = STORAGE_MODES.LOCAL;
}

let apiSettings = { baseUrl: DEFAULT_API_BASE, ...ApiSettingsStore.read() };
if (typeof apiSettings.baseUrl !== 'string' || !apiSettings.baseUrl.trim()) {
  apiSettings.baseUrl = DEFAULT_API_BASE;
}
ApiSettingsStore.write(apiSettings);

export function getStorageMode() {
  return storageMode;
}

export function setStorageMode(nextMode) {
  storageMode = nextMode === STORAGE_MODES.SERVER ? STORAGE_MODES.SERVER : STORAGE_MODES.LOCAL;
  StorageModeStore.write(storageMode);
  if (typeof storageModeChangeHandler === 'function') {
    storageModeChangeHandler(storageMode);
  }
}

export function isServerMode() {
  return storageMode === STORAGE_MODES.SERVER;
}

export function getApiSettings() {
  return { ...apiSettings };
}

export function updateApiSettings(next) {
  apiSettings = { ...apiSettings, ...(next || {}) };
  if (typeof apiSettings.baseUrl !== 'string' || !apiSettings.baseUrl.trim()) {
    apiSettings.baseUrl = DEFAULT_API_BASE;
  }
  ApiSettingsStore.write(apiSettings);
  if (typeof apiSettingsChangeHandler === 'function') {
    apiSettingsChangeHandler({ ...apiSettings });
  }
}

let storageModeChangeHandler = null;
let apiSettingsChangeHandler = null;
let taskWriteHandler = null;
let projectWriteHandler = null;
let archiveWriteHandler = null;
let workdayWriteHandler = null;

export function onStorageModeChange(callback) {
  storageModeChangeHandler = callback;
}

export function onApiSettingsChange(callback) {
  apiSettingsChangeHandler = callback;
}

export function registerTaskWriteHandler(callback) {
  taskWriteHandler = callback;
}

export function registerProjectWriteHandler(callback) {
  projectWriteHandler = callback;
}

export function registerArchiveWriteHandler(callback) {
  archiveWriteHandler = callback;
}

export function registerWorkdayWriteHandler(callback) {
  workdayWriteHandler = callback;
}

export const TaskStore = {
  read() {
    try {
      return JSON.parse(localStorage.getItem(TASKS_KEY)) || [];
    } catch (err) {
      return [];
    }
  },
  write(value) {
    try {
      localStorage.setItem(TASKS_KEY, JSON.stringify(value));
    } catch (err) {
      console.warn('Failed to persist tasks', err);
    }
    if (typeof taskWriteHandler === 'function') {
      taskWriteHandler(value);
    }
  }
};

export const ProjectsStore = {
  read() {
    try {
      return JSON.parse(localStorage.getItem(PROJECTS_KEY)) || [];
    } catch (err) {
      return [];
    }
  },
  write(value) {
    try {
      localStorage.setItem(PROJECTS_KEY, JSON.stringify(value));
    } catch (err) {
      console.warn('Failed to persist projects', err);
    }
    if (typeof projectWriteHandler === 'function') {
      projectWriteHandler(value);
    }
  }
};

export const ArchiveStore = {
  read() {
    try {
      const raw = JSON.parse(localStorage.getItem(ARCHIVE_KEY));
      return Array.isArray(raw) ? raw : [];
    } catch (err) {
      return [];
    }
  },
  write(value) {
    try {
      localStorage.setItem(ARCHIVE_KEY, JSON.stringify(value));
    } catch (err) {
      console.warn('Failed to persist archive', err);
    }
    if (typeof archiveWriteHandler === 'function') {
      archiveWriteHandler(value);
    }
  }
};

export const ThemeStore = {
  read() {
    return localStorage.getItem(THEME_KEY) || 'light';
  },
  write(value) {
    localStorage.setItem(THEME_KEY, value);
  }
};

function normalizeWorkdayState(raw) {
  if (!raw || typeof raw !== 'object' || !raw.id) return null;
  const normalized = { ...raw };
  if (typeof normalized.start !== 'number' || !Number.isFinite(normalized.start)) normalized.start = null;
  if (typeof normalized.end !== 'number' || !Number.isFinite(normalized.end)) normalized.end = null;
  if (typeof normalized.closedAt !== 'number' || !Number.isFinite(normalized.closedAt)) normalized.closedAt = null;
  if (typeof normalized.finalTimeMs !== 'number' || !Number.isFinite(normalized.finalTimeMs)) normalized.finalTimeMs = 0;
  if (typeof normalized.finalDoneCount !== 'number' || !Number.isFinite(normalized.finalDoneCount)) normalized.finalDoneCount = 0;
  if (!normalized.baseline || typeof normalized.baseline !== 'object') normalized.baseline = {};
  if (!normalized.completed || typeof normalized.completed !== 'object') normalized.completed = {};
  const manualStats = normalized.manualClosedStats;
  const manualTime = manualStats && typeof manualStats.timeMs === 'number' && Number.isFinite(manualStats.timeMs)
    ? Math.max(0, manualStats.timeMs)
    : 0;
  const manualDone = manualStats && typeof manualStats.doneCount === 'number' && Number.isFinite(manualStats.doneCount)
    ? Math.max(0, Math.round(manualStats.doneCount))
    : 0;
  normalized.manualClosedStats = { timeMs: manualTime, doneCount: manualDone };
  normalized.closedManually = normalized.closedManually === true;
  return normalized;
}

function getWorkdayKey(mode = storageMode) {
  return mode === STORAGE_MODES.SERVER ? WORKDAY_SERVER_KEY : WORKDAY_KEY;
}

export const WorkdayStore = {
  read({ mode, allowLegacyFallback = true } = {}) {
    const targetMode = mode === STORAGE_MODES.SERVER ? STORAGE_MODES.SERVER : (mode === STORAGE_MODES.LOCAL ? STORAGE_MODES.LOCAL : storageMode);
    const key = getWorkdayKey(targetMode);
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = normalizeWorkdayState(JSON.parse(raw));
        if (parsed) return parsed;
      }
    } catch (err) {
      console.warn('Failed to read workday state', err);
    }
    if (targetMode === STORAGE_MODES.SERVER && allowLegacyFallback) {
      try {
        const legacyRaw = localStorage.getItem(WORKDAY_KEY);
        if (legacyRaw) {
          const legacyState = normalizeWorkdayState(JSON.parse(legacyRaw));
          if (legacyState) {
            this.write(legacyState, { mode: STORAGE_MODES.SERVER, skipHandler: true });
            return legacyState;
          }
        }
      } catch (err) {
        console.warn('Failed to read legacy workday state', err);
      }
    }
    return null;
  },
  write(state, { mode, skipHandler = false } = {}) {
    const targetMode = mode === STORAGE_MODES.SERVER ? STORAGE_MODES.SERVER : (mode === STORAGE_MODES.LOCAL ? STORAGE_MODES.LOCAL : storageMode);
    const key = getWorkdayKey(targetMode);
    if (!state) {
      localStorage.removeItem(key);
      if (!skipHandler && typeof workdayWriteHandler === 'function') {
        workdayWriteHandler(null, targetMode);
      }
      return;
    }
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch (err) {
      console.warn('Failed to persist workday state', err);
    }
    if (!skipHandler && typeof workdayWriteHandler === 'function') {
      workdayWriteHandler(state, targetMode);
    }
  }
};

export { StorageModeStore, ApiSettingsStore };
