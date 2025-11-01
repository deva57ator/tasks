import {
  requestLoginCode,
  verifyLoginCode,
  fetchSession,
  logout as apiLogout,
  ApiError
} from './api.js';

const AUTH_EMAIL = 'deva57ator@gmail.com';

const AuthUI = {
  overlay: document.getElementById('authOverlay'),
  stepEmail: document.getElementById('authStepEmail'),
  stepCode: document.getElementById('authStepCode'),
  emailForm: document.getElementById('authEmailForm'),
  emailInput: document.getElementById('authEmailInput'),
  emailError: document.getElementById('authEmailError'),
  codeForm: document.getElementById('authCodeForm'),
  codeInput: document.getElementById('authCodeInput'),
  codeError: document.getElementById('authCodeError'),
  codeMessage: document.getElementById('authCodeMessage'),
  emailDisplay: document.getElementById('authEmailDisplay'),
  resendBtn: document.getElementById('authResendBtn'),
  changeEmailBtn: document.getElementById('authChangeEmailBtn'),
  hint: document.getElementById('authDebugHint'),
  themeToggle: document.getElementById('authThemeToggle')
};

let domReady = false;
let authState = { status: 'unknown', user: null };
let initPromise = null;
let themeToggleHandler = null;
const stateListeners = new Set();
const pendingResolvers = new Set();
let requestInFlight = false;
let verifyInFlight = false;
let pendingEmail = '';
let lastKnownEmail = AUTH_EMAIL;

function emitState() {
  for (const listener of stateListeners) {
    try {
      listener({ status: authState.status, user: authState.user });
    } catch (err) {
      console.error('Auth state listener error', err);
    }
  }
}

function setState(status, user) {
  authState = { status, user: user || null };
  if (authState.user?.email) {
    lastKnownEmail = authState.user.email;
  }
  emitState();
}

function resolvePending(user) {
  if (!pendingResolvers.size) return;
  for (const resolver of pendingResolvers) {
    try {
      resolver(user);
    } catch (err) {
      console.error('Auth waiter failed', err);
    }
  }
  pendingResolvers.clear();
}

function setupDom() {
  if (domReady) return;
  domReady = true;
  if (AuthUI.emailForm) {
    AuthUI.emailForm.addEventListener('submit', handleEmailSubmit);
  }
  if (AuthUI.codeForm) {
    AuthUI.codeForm.addEventListener('submit', handleCodeSubmit);
  }
  if (AuthUI.resendBtn) {
    AuthUI.resendBtn.addEventListener('click', handleResendClick);
  }
  if (AuthUI.changeEmailBtn) {
    AuthUI.changeEmailBtn.addEventListener('click', () => {
      pendingEmail = '';
      setCodeError('');
      showOverlay('email');
    });
  }
  if (AuthUI.themeToggle) {
    AuthUI.themeToggle.addEventListener('click', (event) => {
      event.preventDefault();
      if (typeof themeToggleHandler === 'function') {
        themeToggleHandler();
      }
    });
  }
}

function showOverlay(step = 'email') {
  if (!AuthUI.overlay) return;
  AuthUI.overlay.classList.add('is-open');
  AuthUI.overlay.setAttribute('aria-hidden', 'false');
  document.body.classList.add('auth-open');
  setStep(step);
  if (step === 'email') {
    if (AuthUI.emailInput) {
      if (!AuthUI.emailInput.value) {
        AuthUI.emailInput.value = lastKnownEmail;
      }
      setTimeout(() => {
        try {
          AuthUI.emailInput.focus({ preventScroll: true });
        } catch {
          AuthUI.emailInput.focus();
        }
      }, 40);
    }
  } else if (step === 'code') {
    if (AuthUI.codeInput) {
      setTimeout(() => {
        try {
          AuthUI.codeInput.focus({ preventScroll: true });
        } catch {
          AuthUI.codeInput.focus();
        }
      }, 40);
    }
  }
}

function hideOverlay() {
  if (!AuthUI.overlay) return;
  AuthUI.overlay.classList.remove('is-open');
  AuthUI.overlay.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('auth-open');
}

function setStep(step) {
  const isEmail = step === 'email';
  if (AuthUI.stepEmail) {
    AuthUI.stepEmail.classList.toggle('is-active', isEmail);
    AuthUI.stepEmail.setAttribute('aria-hidden', isEmail ? 'false' : 'true');
  }
  if (AuthUI.stepCode) {
    AuthUI.stepCode.classList.toggle('is-active', !isEmail);
    AuthUI.stepCode.setAttribute('aria-hidden', isEmail ? 'true' : 'false');
  }
}

function setEmailError(message) {
  if (AuthUI.emailError) {
    AuthUI.emailError.textContent = message || '';
  }
}

function setCodeError(message) {
  if (AuthUI.codeError) {
    AuthUI.codeError.textContent = message || '';
  }
}

function setHint({ ttlText = '', debugCode = '' } = {}) {
  if (!AuthUI.hint) return;
  AuthUI.hint.textContent = '';
  const nodes = [];
  if (ttlText) {
    const span = document.createElement('span');
    span.textContent = ttlText;
    nodes.push(span);
  }
  if (debugCode) {
    const span = document.createElement('span');
    span.textContent = 'Код для теста: ';
    const codeEl = document.createElement('code');
    codeEl.textContent = debugCode;
    span.appendChild(codeEl);
    nodes.push(span);
  }
  if (!nodes.length) {
    return;
  }
  const frag = document.createDocumentFragment();
  nodes.forEach((node, index) => {
    if (index > 0) {
      const sep = document.createElement('span');
      sep.textContent = ' · ';
      frag.appendChild(sep);
    }
    frag.appendChild(node);
  });
  AuthUI.hint.appendChild(frag);
}

function formatTtlText(expiresAt) {
  if (!expiresAt || Number.isNaN(expiresAt)) {
    return 'Код действителен несколько минут.';
  }
  const diff = Math.max(0, expiresAt - Date.now());
  if (diff <= 0) {
    return 'Код истёк, запросите новый.';
  }
  const minutes = Math.floor(diff / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);
  if (!minutes && !seconds) {
    return 'Код почти истёк.';
  }
  const parts = [];
  if (minutes) {
    parts.push(`${minutes} мин`);
  }
  if (seconds) {
    parts.push(`${seconds.toString().padStart(minutes ? 2 : 1, '0')} сек`);
  }
  return `Код действителен ещё ~${parts.join(' ')}.`;
}

async function handleEmailSubmit(event) {
  event.preventDefault();
  if (requestInFlight) return;
  const email = (AuthUI.emailInput?.value || '').trim().toLowerCase();
  if (!email) {
    setEmailError('Укажите e-mail');
    AuthUI.emailInput?.focus();
    return;
  }
  requestInFlight = true;
  setEmailError('');
  setCodeError('');
  setHint();
  const submitBtn = AuthUI.emailForm?.querySelector('button[type="submit"]');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Отправка…';
  }
  try {
    const response = await requestLoginCode(email);
    lastKnownEmail = email;
    pendingEmail = email;
    if (AuthUI.emailInput) {
      AuthUI.emailInput.value = email;
    }
    if (AuthUI.emailDisplay) {
      AuthUI.emailDisplay.textContent = email;
    }
    setCodeError('');
    setEmailError('');
    setHint({ ttlText: formatTtlText(response?.expiresAt), debugCode: response?.debugCode || '' });
    showOverlay('code');
    if (AuthUI.codeInput) {
      AuthUI.codeInput.value = '';
    }
  } catch (err) {
    let message = 'Не удалось отправить код';
    if (err instanceof ApiError) {
      if (err.status === 401) {
        message = 'Вход доступен только для указанного e-mail';
      } else if (err.message) {
        message = err.message;
      }
    }
    setEmailError(message);
  } finally {
    requestInFlight = false;
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Получить код';
    }
  }
}

async function handleCodeSubmit(event) {
  event.preventDefault();
  if (verifyInFlight) return;
  if (!pendingEmail) {
    showOverlay('email');
    return;
  }
  const code = (AuthUI.codeInput?.value || '').trim();
  if (!code) {
    setCodeError('Введите код');
    AuthUI.codeInput?.focus();
    return;
  }
  verifyInFlight = true;
  setCodeError('');
  const submitBtn = AuthUI.codeForm?.querySelector('button[type="submit"]');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Проверка…';
  }
  try {
    const response = await verifyLoginCode(pendingEmail, code);
    const user = response?.user?.email ? response.user : { email: pendingEmail };
    setState('authenticated', user);
    hideOverlay();
    resolvePending(user);
  } catch (err) {
    let message = 'Неверный или просроченный код';
    if (err instanceof ApiError && err.message) {
      message = err.message;
    }
    setCodeError(message);
  } finally {
    verifyInFlight = false;
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Войти';
    }
  }
}

async function handleResendClick(event) {
  event.preventDefault();
  if (!pendingEmail) {
    showOverlay('email');
    return;
  }
  if (requestInFlight) return;
  requestInFlight = true;
  setCodeError('');
  setHint();
  if (AuthUI.resendBtn) {
    AuthUI.resendBtn.disabled = true;
    AuthUI.resendBtn.textContent = 'Отправка…';
  }
  try {
    const response = await requestLoginCode(pendingEmail);
    if (AuthUI.emailDisplay) {
      AuthUI.emailDisplay.textContent = pendingEmail;
    }
    setHint({ ttlText: formatTtlText(response?.expiresAt), debugCode: response?.debugCode || '' });
    if (AuthUI.codeInput) {
      AuthUI.codeInput.focus();
    }
  } catch (err) {
    let message = 'Не удалось отправить код';
    if (err instanceof ApiError && err.message) {
      message = err.message;
    }
    setCodeError(message);
  } finally {
    requestInFlight = false;
    if (AuthUI.resendBtn) {
      AuthUI.resendBtn.disabled = false;
      AuthUI.resendBtn.textContent = 'Выслать код ещё раз';
    }
  }
}

async function checkSession() {
  try {
    const session = await fetchSession();
    if (session?.authenticated) {
      const user = session.user?.email ? session.user : { email: lastKnownEmail };
      setState('authenticated', user);
      hideOverlay();
      resolvePending(user);
      return;
    }
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 401)) {
      console.warn('Failed to check auth session', err);
    }
  }
  setState('unauthenticated', null);
}

export function initAuth({ onToggleTheme, initialTheme } = {}) {
  themeToggleHandler = typeof onToggleTheme === 'function' ? onToggleTheme : null;
  setupDom();
  if (initialTheme) {
    syncTheme(initialTheme);
  }
  if (!initPromise) {
    initPromise = checkSession().finally(() => {
      initPromise = null;
    });
  }
  return initPromise;
}

export function syncTheme(mode) {
  if (!AuthUI.themeToggle) return;
  const dark = mode === 'dark';
  const label = dark ? 'Переключить на светлую тему' : 'Переключить на тёмную тему';
  AuthUI.themeToggle.dataset.mode = dark ? 'dark' : 'light';
  AuthUI.themeToggle.setAttribute('aria-label', label);
  AuthUI.themeToggle.title = label;
}

export function onAuthStateChange(listener) {
  if (typeof listener !== 'function') return () => {};
  stateListeners.add(listener);
  listener({ status: authState.status, user: authState.user });
  return () => stateListeners.delete(listener);
}

export function getAuthState() {
  return { status: authState.status, user: authState.user };
}

export async function ensureAuthenticated() {
  if (initPromise) {
    await initPromise;
  }
  if (authState.status === 'authenticated') {
    return authState.user;
  }
  showOverlay('email');
  return new Promise((resolve) => {
    pendingResolvers.add(resolve);
  });
}

export function handleUnauthorized({ message } = {}) {
  setState('unauthenticated', authState.user);
  setHint();
  setCodeError('');
  setEmailError(message || 'Сессия истекла, запросите новый код.');
  if (AuthUI.emailInput) {
    AuthUI.emailInput.value = lastKnownEmail;
  }
  showOverlay('email');
}

export async function performLogout() {
  try {
    await apiLogout();
  } catch (err) {
    console.warn('Failed to logout', err);
  }
  pendingEmail = '';
  setState('unauthenticated', null);
  setHint();
  setCodeError('');
  setEmailError('Вы вышли из аккаунта. Получите новый код для входа.');
  if (AuthUI.emailInput) {
    AuthUI.emailInput.value = lastKnownEmail;
  }
  showOverlay('email');
}

export { AUTH_EMAIL };
