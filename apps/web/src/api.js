import { api, API_ENV_LABEL, STORAGE_MODES } from './config.js';
import { ApiKeyStore, isServerMode, storageMode } from './storage.js';
import { clampTimeSpentMs } from './utils.js';

// Коллбэки из main.js — регистрируются после определения всех зависимостей.
// Позволяет api.js не зависеть от main.js напрямую.
const _cb = {};
export function registerApiCallbacks(cbs) { Object.assign(_cb, cbs); }

// ---------------------------------------------------------------------------
// Состояние авторизации
// ---------------------------------------------------------------------------

export let apiAuthLocked = false;
export let apiAuthMessage = '';
export let apiAuthReason = null;

export function resetApiAuthLock() {
  apiAuthLocked = false;
  apiAuthReason = null;
  apiAuthMessage = '';
}

export function lockApiAuth(reason, message) {
  apiAuthLocked = true;
  apiAuthReason = reason || null;
  apiAuthMessage = message || '';
  openApiSettings({ blocking: true, reason, message });
}

function ensureApiKeyAvailable(reason) {
  if (!isServerMode()) return null;
  if (apiAuthLocked && apiAuthReason) {
    lockApiAuth(apiAuthReason, apiAuthMessage);
    throw apiError(apiAuthMessage || 'Требуется API key', 'auth-locked');
  }
  const key = ApiKeyStore.read();
  if (!key) {
    lockApiAuth(reason || 'missing', 'Нужен API key для доступа к API');
    throw apiError('API key не указан', 'missing-key');
  }
  return key;
}

// ---------------------------------------------------------------------------
// HTTP-клиент
// ---------------------------------------------------------------------------

export function apiError(message, code) {
  const err = new Error(message);
  if (code) err.code = code;
  return err;
}

export async function apiRequest(path, { method = 'GET', body } = {}) {
  const url = api(path);
  const init = { method, headers: {} };
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
    init.headers['Content-Type'] = 'application/json';
  }
  if (isServerMode()) {
    const key = ensureApiKeyAvailable('missing');
    if (key) init.headers['X-API-Key'] = key;
  }
  if (!Object.keys(init.headers).length) delete init.headers;
  let response;
  try {
    response = await fetch(url, init);
  } catch (err) {
    lockApiAuth('network', 'API недоступен');
    throw apiError('Нет соединения с API', 'network');
  }
  if (response.status === 401) {
    lockApiAuth('unauthorized', 'Ключ неверный или не подходит для этого окружения');
    throw apiError('Требуется корректный API key', 'unauthorized');
  }
  if (!response.ok) {
    let message = `Ошибка API (${response.status})`;
    try {
      const errBody = await response.json();
      if (errBody && errBody.error && errBody.error.message) message = errBody.error.message;
    } catch {}
    throw apiError(message, 'api');
  }
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

export function handleApiError(err, fallback) {
  const message = err && err.message ? err.message : fallback || 'Ошибка при работе с API';
  console.error(err);
  _cb.toast?.(message);
}

export function runServerAction(fn, { onSuccess, onError, silent = false } = {}) {
  const promise = Promise.resolve().then(fn);
  promise
    .then(result => { if (typeof onSuccess === 'function') onSuccess(result); })
    .catch(err => { if (!silent) handleApiError(err); if (typeof onError === 'function') onError(err); });
  return promise;
}

// ---------------------------------------------------------------------------
// Нормализация данных для сервера
// ---------------------------------------------------------------------------

export function mapTaskForServer(task) {
  return {
    id: task.id,
    title: task.title || '',
    done: task.done === true,
    due: task.due || null,
    project: task.project || null,
    notes: task.notes || '',
    timeSpent: clampTimeSpentMs(task.timeSpent),
    parentId: task.parentId || null
  };
}

export function normalizeTaskPatch(patch) {
  const payload = {};
  if (patch.title !== undefined) payload.title = String(patch.title);
  if (patch.done !== undefined) payload.done = !!patch.done;
  if (patch.due !== undefined) payload.due = patch.due || null;
  if (patch.project !== undefined) payload.project = patch.project || null;
  if (patch.notes !== undefined) payload.notes = patch.notes || '';
  if (patch.timeSpent !== undefined) payload.timeSpent = clampTimeSpentMs(patch.timeSpent);
  if (patch.parentId !== undefined) payload.parentId = patch.parentId || null;
  if (patch.completedAt !== undefined) payload.completedAt = patch.completedAt;
  return payload;
}

export function normalizeProjectPayload(project) {
  return {
    id: project.id,
    title: project.title || '',
    emoji: typeof project.emoji === 'string' && project.emoji.trim() ? project.emoji.trim() : null
  };
}

// ---------------------------------------------------------------------------
// Очередь задач
// ---------------------------------------------------------------------------

export const pendingTaskUpdates = new Map();

export function queueTaskCreate(task) {
  if (!isServerMode()) return;
  const payload = mapTaskForServer(task);
  runServerAction(() => apiRequest('/tasks', { method: 'POST', body: payload }), { onError: () => _cb.refreshData?.({ silent: true }) });
}

export function queueTaskUpdate(id, patch, { debounce = false } = {}) {
  if (!isServerMode() || !id) return;
  const payload = normalizeTaskPatch(patch || {});
  if (debounce) {
    const entry = pendingTaskUpdates.get(id) || { patch: {}, timer: null };
    entry.patch = { ...entry.patch, ...payload };
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      pendingTaskUpdates.delete(id);
      runServerAction(() => apiRequest(`/tasks/${encodeURIComponent(id)}`, { method: 'PUT', body: entry.patch }), { silent: true, onError: () => _cb.refreshData?.({ silent: true }) });
    }, 320);
    pendingTaskUpdates.set(id, entry);
    return;
  }
  runServerAction(() => apiRequest(`/tasks/${encodeURIComponent(id)}`, { method: 'PUT', body: payload }), { onError: () => _cb.refreshData?.({ silent: true }) });
}

export function queueTaskDelete(id) {
  if (!isServerMode() || !id) return;
  runServerAction(() => apiRequest(`/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' }), { onError: () => _cb.refreshData?.({ silent: true }) });
}

export function flushPendingTaskUpdates() {
  for (const [id, entry] of pendingTaskUpdates.entries()) {
    if (entry && entry.timer) clearTimeout(entry.timer);
    if (entry && entry.patch) {
      runServerAction(() => apiRequest(`/tasks/${encodeURIComponent(id)}`, { method: 'PUT', body: entry.patch }), { silent: true, onError: () => _cb.refreshData?.({ silent: true }) });
    }
  }
  pendingTaskUpdates.clear();
}

// ---------------------------------------------------------------------------
// Очередь проектов
// ---------------------------------------------------------------------------

export function queueProjectCreate(project) {
  if (!isServerMode()) return;
  const payload = normalizeProjectPayload(project);
  runServerAction(() => apiRequest('/projects', { method: 'POST', body: payload }), { onError: () => _cb.refreshData?.({ silent: true }) });
}

export function queueProjectUpdate(id, patch) {
  if (!isServerMode() || !id) return;
  const payload = {};
  if (patch.title !== undefined) payload.title = String(patch.title);
  if (patch.emoji !== undefined) payload.emoji = typeof patch.emoji === 'string' && patch.emoji.trim() ? patch.emoji.trim() : null;
  runServerAction(() => apiRequest(`/projects/${encodeURIComponent(id)}`, { method: 'PUT', body: payload }), { onError: () => _cb.refreshData?.({ silent: true }) });
}

export function queueProjectDelete(id) {
  if (!isServerMode() || !id) return;
  runServerAction(() => apiRequest(`/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }), { onError: () => _cb.refreshData?.({ silent: true }) });
}

// ---------------------------------------------------------------------------
// Очередь архива
// ---------------------------------------------------------------------------

export function queueArchiveDelete(id) {
  if (!isServerMode() || !id) return;
  runServerAction(() => apiRequest(`/archive/${encodeURIComponent(id)}`, { method: 'DELETE' }), { onError: () => _cb.refreshData?.({ silent: true }) });
}

// ---------------------------------------------------------------------------
// Синхронизация рабочего дня с сервером
// ---------------------------------------------------------------------------

let pendingWorkdaySync = null;
let workdaySyncTimer = null;
let workdaySyncInFlight = false;
let lastWorkdaySyncPayload = null;

export function stringifyWorkdayPayload(payload) {
  try { return JSON.stringify(payload); } catch { return null; }
}

export function resetWorkdaySyncState() {
  if (workdaySyncTimer) { clearTimeout(workdaySyncTimer); workdaySyncTimer = null; }
  pendingWorkdaySync = null;
  workdaySyncInFlight = false;
  lastWorkdaySyncPayload = null;
}

export function scheduleWorkdaySync(delay = 400) {
  if (workdaySyncTimer) clearTimeout(workdaySyncTimer);
  workdaySyncTimer = setTimeout(() => {
    workdaySyncTimer = null;
    if (workdaySyncInFlight) { scheduleWorkdaySync(delay); return; }
    sendPendingWorkdaySync();
  }, delay);
}

function sendPendingWorkdaySync() {
  if (workdaySyncInFlight || !pendingWorkdaySync) return;
  const entry = pendingWorkdaySync;
  workdaySyncInFlight = true;
  runServerAction(
    () => apiRequest('/workday/sync', { method: 'POST', body: { workday: entry.payload } }),
    {
      silent: true,
      onSuccess: () => {
        if (pendingWorkdaySync === entry) pendingWorkdaySync = null;
        lastWorkdaySyncPayload = entry.serialized;
        workdaySyncInFlight = false;
        if (pendingWorkdaySync) { scheduleWorkdaySync(150); }
      },
      onError: () => {
        workdaySyncInFlight = false;
        if (pendingWorkdaySync) { scheduleWorkdaySync(2000); } else { lastWorkdaySyncPayload = null; }
      }
    }
  );
}

export function flushPendingWorkdaySync() {
  if (workdaySyncTimer) { clearTimeout(workdaySyncTimer); workdaySyncTimer = null; }
  if (workdaySyncInFlight) return;
  sendPendingWorkdaySync();
}

export function handleServerWorkdayWrite(state) {
  if (!isServerMode()) return;
  if (!state || !state.id) { resetWorkdaySyncState(); return; }
  const payload = _cb.buildWorkdayPayload?.(state);
  if (!payload) return;
  const serialized = stringifyWorkdayPayload(payload);
  if (!serialized) return;
  if (serialized === lastWorkdaySyncPayload && !pendingWorkdaySync) return;
  if (pendingWorkdaySync && pendingWorkdaySync.serialized === serialized) return;
  pendingWorkdaySync = { payload, serialized };
  if (!workdaySyncInFlight) { scheduleWorkdaySync(); }
}

// ---------------------------------------------------------------------------
// Настройки API — UI
// ---------------------------------------------------------------------------

const API_KEY_HINT = 'Возьми ключ на сервере в /etc/tasks-*.env';
export let apiSettingsBlocking = false;

export const ApiSettingsUI = {
  overlay: document.getElementById('apiSettingsOverlay'),
  dialog: document.getElementById('apiSettingsDialog'),
  closeBtn: document.getElementById('apiSettingsClose'),
  form: document.getElementById('apiSettingsForm'),
  input: document.getElementById('apiKeyInput'),
  toggle: document.getElementById('apiKeyToggle'),
  error: document.getElementById('apiSettingsError'),
  env: document.getElementById('apiSettingsEnv'),
  hint: document.getElementById('apiSettingsHint'),
  message: document.getElementById('apiSettingsMessage'),
  saveBtn: document.getElementById('apiSettingsSave'),
  clearBtn: document.getElementById('apiKeyClear'),
  toLocalBtn: document.getElementById('apiKeyToLocal'),
  openBtn: document.getElementById('apiSettingsBtn')
};

function apiEnvDescription() { return `Окружение: ${API_ENV_LABEL}`; }

export function setApiSettingsError(message) {
  if (ApiSettingsUI.error) ApiSettingsUI.error.textContent = message || '';
}

export function setApiSettingsMessage(message) {
  if (!ApiSettingsUI.message) return;
  ApiSettingsUI.message.textContent = message || '';
  ApiSettingsUI.message.style.display = message ? 'block' : 'none';
}

export function isApiSettingsOpen() {
  return ApiSettingsUI.overlay && ApiSettingsUI.overlay.classList.contains('is-open');
}

function syncApiSettingsStaticText() {
  if (ApiSettingsUI.env) ApiSettingsUI.env.textContent = apiEnvDescription();
  if (ApiSettingsUI.hint) ApiSettingsUI.hint.textContent = API_KEY_HINT;
}

export function openApiSettings({ blocking = false, reason = null, message = null, resetInput = false } = {}) {
  syncApiSettingsStaticText();
  apiSettingsBlocking = !!blocking;
  const overlay = ApiSettingsUI.overlay;
  if (!overlay) return;
  const defaultMessage =
    reason === 'unauthorized' ? 'Ключ неверный или не подходит для этого окружения' :
    reason === 'network' ? 'API недоступен' :
    reason === 'missing' ? 'Укажи ключ для этого окружения' :
    'Добавь или обнови ключ для серверного режима';
  setApiSettingsMessage(message || defaultMessage);
  setApiSettingsError('');
  const currentValue = ApiKeyStore.read();
  if (ApiSettingsUI.input) {
    ApiSettingsUI.input.value = resetInput ? '' : currentValue;
    ApiSettingsUI.input.type = 'password';
  }
  if (ApiSettingsUI.toggle) {
    ApiSettingsUI.toggle.setAttribute('aria-label', 'Показать API key');
    ApiSettingsUI.toggle.setAttribute('title', 'Показать API key');
    ApiSettingsUI.toggle.classList.remove('is-active');
  }
  if (ApiSettingsUI.closeBtn) ApiSettingsUI.closeBtn.style.display = apiSettingsBlocking ? 'none' : 'block';
  overlay.classList.add('is-open');
  overlay.setAttribute('aria-hidden', 'false');
  document.body.classList.add('api-settings-open');
  const target = ApiSettingsUI.input || ApiSettingsUI.dialog;
  setTimeout(() => {
    if (target) { try { target.focus({ preventScroll: true }); } catch { try { target.focus(); } catch {} } }
  }, 50);
}

export function closeApiSettings({ force = false } = {}) {
  if (!isApiSettingsOpen()) return;
  if (apiSettingsBlocking && !force && isServerMode() && !ApiKeyStore.read()) return;
  apiSettingsBlocking = false;
  const overlay = ApiSettingsUI.overlay;
  overlay.classList.remove('is-open');
  overlay.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('api-settings-open');
  setApiSettingsError('');
}

export function toggleApiKeyVisibility() {
  if (!ApiSettingsUI.input || !ApiSettingsUI.toggle) return;
  const showing = ApiSettingsUI.input.type === 'text';
  ApiSettingsUI.input.type = showing ? 'password' : 'text';
  const label = showing ? 'Показать API key' : 'Скрыть API key';
  ApiSettingsUI.toggle.setAttribute('aria-label', label);
  ApiSettingsUI.toggle.setAttribute('title', label);
  ApiSettingsUI.toggle.classList.toggle('is-active', !showing);
}

export async function saveApiKey(event) {
  event && event.preventDefault();
  if (!ApiSettingsUI.input) return;
  const value = (ApiSettingsUI.input.value || '').trim();
  if (!value) { setApiSettingsError('Введите API key'); return; }
  ApiKeyStore.write(value);
  setApiSettingsError('');
  const reset = () => { if (ApiSettingsUI.saveBtn) ApiSettingsUI.saveBtn.disabled = false; };
  if (ApiSettingsUI.saveBtn) ApiSettingsUI.saveBtn.disabled = true;
  try {
    resetApiAuthLock();
    if (isServerMode()) { await apiRequest('/tasks?limit=1'); }
    apiSettingsBlocking = false;
    closeApiSettings({ force: true });
    _cb.toast?.('API key сохранён');
    if (isServerMode()) await _cb.refreshData?.({ silent: true });
  } catch (err) {
    if (err && err.code === 'unauthorized') {
      setApiSettingsError('Ключ неверный или не подходит для этого окружения');
      lockApiAuth('unauthorized', 'Ключ неверный или не подходит для этого окружения');
      return;
    } else if (err && err.code === 'network') {
      setApiSettingsError('API недоступен');
      lockApiAuth('network', 'API недоступен');
      return;
    }
    setApiSettingsError(err && err.message ? err.message : 'Не удалось сохранить ключ');
  } finally {
    reset();
  }
}

export function clearApiKey() {
  ApiKeyStore.clear();
  if (ApiSettingsUI.input) ApiSettingsUI.input.value = '';
  setApiSettingsError('Ключ очищен');
  if (isServerMode()) lockApiAuth('missing', 'Нужен API key для доступа к API');
}

export async function switchToLocalMode() {
  await _cb.setStorageModeAndReload?.(STORAGE_MODES.LOCAL, { forceReload: true });
  apiSettingsBlocking = false;
  closeApiSettings({ force: true });
  _cb.toast?.('Режим: localStorage');
}
