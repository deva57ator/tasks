import { getApiSettings } from './state.js';

class ApiError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

const DEFAULT_TIMEOUT = 10000;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

const responseCache = new Map();

function cloneValue(value) {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch (err) {
      // fallthrough
    }
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (err) {
    return value;
  }
}

function getApiBaseUrl() {
  const settings = getApiSettings();
  const base = typeof settings.baseUrl === 'string' ? settings.baseUrl.trim() : '/api';
  if (!base) return '/api';
  return base.endsWith('/') ? base.slice(0, -1) : base;
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function performRequest(path, { method = 'GET', body, headers = {}, timeout = DEFAULT_TIMEOUT, retries = 2, cacheKey, cacheTtl } = {}) {
  const baseUrl = getApiBaseUrl();

  if (cacheKey) {
    const cached = responseCache.get(cacheKey);
    if (cached && cached.expiry > Date.now()) {
      return cloneValue(cached.value);
    }
    if (cached) {
      responseCache.delete(cacheKey);
    }
  }

  const url = `${baseUrl}${path}`;
  const init = {
    method,
    headers: {
      Accept: 'application/json',
      ...headers
    },
    credentials: 'include'
  };

  if (body !== undefined) {
    if (typeof body === 'string') {
      init.body = body;
    } else {
      init.body = JSON.stringify(body);
      if (!init.headers['Content-Type']) {
        init.headers['Content-Type'] = 'application/json';
      }
    }
  }

  let attempt = 0;
  let lastError;

  while (attempt <= retries) {
    try {
      const response = await fetchWithTimeout(url, init, timeout);
      if (!response.ok) {
        const shouldRetry = RETRYABLE_STATUS.has(response.status) && attempt < retries;
        let errorMessage = `Ошибка API (${response.status})`;
        let errorCode;
        try {
          const errorBody = await response.clone().json();
          if (errorBody?.error?.message) {
            errorMessage = errorBody.error.message;
          }
          if (errorBody?.error?.code) {
            errorCode = errorBody.error.code;
          }
        } catch (err) {
          // ignore JSON parse errors
        }
        if (shouldRetry) {
          attempt += 1;
          await waitFor(Math.min(200 * attempt, 1000));
          continue;
        }
        throw new ApiError(errorMessage, { status: response.status, code: errorCode });
      }

      if (response.status === 204) {
        if (cacheKey && cacheTtl) {
          responseCache.set(cacheKey, { value: null, expiry: Date.now() + cacheTtl });
        }
        return null;
      }

      const text = await response.text();
      if (!text) {
        if (cacheKey && cacheTtl) {
          responseCache.set(cacheKey, { value: null, expiry: Date.now() + cacheTtl });
        }
        return null;
      }
      try {
        const parsed = JSON.parse(text);
        if (cacheKey && cacheTtl) {
          responseCache.set(cacheKey, { value: cloneValue(parsed), expiry: Date.now() + cacheTtl });
        }
        return parsed;
      } catch (err) {
        return null;
      }
    } catch (err) {
      const shouldRetry = (err.name === 'AbortError' || err.name === 'TypeError' || err instanceof ApiError) && attempt < retries;
      if (!shouldRetry || err instanceof ApiError) {
        lastError = err;
        break;
      }
      attempt += 1;
      await waitFor(Math.min(200 * attempt, 1000));
      lastError = err;
    }
  }

  if (cacheKey) {
    responseCache.delete(cacheKey);
  }
  if (lastError instanceof ApiError) {
    throw lastError;
  }
  throw new ApiError(lastError?.message || 'Нет соединения с API');
}

function waitFor(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function apiRequest(path, options) {
  return performRequest(path, options);
}

export function requestLoginCode(email) {
  return performRequest('/auth/request-code', {
    method: 'POST',
    body: { email },
    retries: 0
  });
}

export function verifyLoginCode(email, code) {
  return performRequest('/auth/verify-code', {
    method: 'POST',
    body: { email, code },
    retries: 0
  });
}

export function fetchSession() {
  return performRequest('/auth/session', { method: 'GET', retries: 0 });
}

export function logout() {
  return performRequest('/auth/logout', { method: 'POST', retries: 0 });
}

export function runServerAction(fn, { onSuccess, onError, silent = false } = {}) {
  const promise = Promise.resolve().then(fn);
  promise
    .then((result) => {
      if (typeof onSuccess === 'function') {
        onSuccess(result);
      }
    })
    .catch((err) => {
      if (!silent && typeof onError === 'function') {
        onError(err);
      } else if (!silent) {
        console.error(err);
      } else if (typeof onError === 'function') {
        onError(err);
      }
    });
  return promise;
}

export function mapTaskForServer(task) {
  return {
    id: task.id,
    title: task.title || '',
    done: task.done === true,
    due: task.due || null,
    project: task.project || null,
    notes: task.notes || '',
    timeSpent: Number.isFinite(Number(task.timeSpent)) ? Math.max(0, Number(task.timeSpent)) : 0,
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
  if (patch.timeSpent !== undefined) payload.timeSpent = Math.max(0, Number(patch.timeSpent) || 0);
  if (patch.parentId !== undefined) payload.parentId = patch.parentId || null;
  if (patch.completedAt !== undefined) payload.completedAt = patch.completedAt;
  return payload;
}

export { ApiError, getApiBaseUrl };
