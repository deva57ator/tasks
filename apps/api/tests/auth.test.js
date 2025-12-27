const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function mockDotenv(request, parent, isMain) {
  if (request === 'dotenv') {
    return { config() { return {}; } };
  }
  return originalLoad(request, parent, isMain);
};

function loadAuthMiddleware(apiKey) {
  if (apiKey === undefined) {
    delete process.env.TASKS_API_KEY;
  } else {
    process.env.TASKS_API_KEY = apiKey;
  }
  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/middleware/auth')];
  // eslint-disable-next-line global-require
  return require('../src/middleware/auth');
}

function createResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

test('allows health check without API key', () => {
  const auth = loadAuthMiddleware();
  const res = createResponse();
  let nextCalled = false;

  auth({ method: 'GET', path: '/api/health', originalUrl: '/api/health', get() {} }, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
});

test('allows OPTIONS requests without API key', () => {
  const auth = loadAuthMiddleware();
  const res = createResponse();
  let nextCalled = false;

  auth({ method: 'OPTIONS', path: '/api/tasks', originalUrl: '/api/tasks', get() {} }, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
});

test('rejects requests when API key is missing', () => {
  const auth = loadAuthMiddleware();
  const res = createResponse();

  auth({ method: 'GET', path: '/api/tasks', originalUrl: '/api/tasks', get() {} }, res, () => {});

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: 'Unauthorized' });
});

test('rejects requests with invalid API key', () => {
  const auth = loadAuthMiddleware('secret-key');
  const res = createResponse();

  auth({
    method: 'GET',
    path: '/api/tasks',
    originalUrl: '/api/tasks',
    get(header) {
      if (header === 'X-API-Key') return 'wrong-key';
      return undefined;
    }
  }, res, () => {});

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: 'Unauthorized' });
});

test('allows requests with valid API key', () => {
  const auth = loadAuthMiddleware('secret-key');
  const res = createResponse();
  let nextCalled = false;

  auth({
    method: 'GET',
    path: '/api/tasks',
    originalUrl: '/api/tasks',
    get(header) {
      if (header === 'X-API-Key') return 'secret-key';
      return undefined;
    }
  }, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
});

test.after(() => {
  Module._load = originalLoad;
});
