const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const config = require('../config');
const logger = require('../lib/logger');

let dbInstance;

function ensureDirectory(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function createDatabase() {
  ensureDirectory(config.dbPath);
  const database = new Database(config.dbPath, {
    fileMustExist: false,
    timeout: config.dbBusyTimeoutMs
  });
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  database.pragma(`busy_timeout = ${config.dbBusyTimeoutMs}`);
  return database;
}

function getDb() {
  if (!dbInstance) {
    dbInstance = createDatabase();
    logger.debug({ dbPath: config.dbPath }, 'SQLite connection opened');
  }
  return dbInstance;
}

function run(sql, params = []) {
  const statement = getDb().prepare(sql);
  statement.run(...normalizeParams(params));
}

function get(sql, params = []) {
  const statement = getDb().prepare(sql);
  return statement.get(...normalizeParams(params)) || null;
}

function all(sql, params = []) {
  const statement = getDb().prepare(sql);
  return statement.all(...normalizeParams(params));
}

function normalizeParams(params) {
  if (!Array.isArray(params) && params && typeof params === 'object') {
    return [params];
  }
  return Array.isArray(params) ? params : [];
}

async function transaction(handler) {
  const database = getDb();
  await Promise.resolve().then(() => {
    database.exec('BEGIN IMMEDIATE');
  });

  const txContext = {
    run: (sql, params = []) => {
      database.prepare(sql).run(...normalizeParams(params));
    },
    get: (sql, params = []) => {
      return database.prepare(sql).get(...normalizeParams(params)) || null;
    },
    all: (sql, params = []) => {
      return database.prepare(sql).all(...normalizeParams(params));
    }
  };

  try {
    await handler(txContext);
    database.exec('COMMIT');
  } catch (err) {
    try {
      database.exec('ROLLBACK');
    } catch (rollbackErr) {
      logger.error({ err: rollbackErr }, 'Failed to rollback transaction');
    }
    throw err;
  }
}

function runScript(filePath) {
  const fullPath = path.resolve(filePath);
  const sql = fs.readFileSync(fullPath, 'utf8');
  if (!sql.trim()) return;
  getDb().exec(sql);
}

process.on('exit', () => {
  if (dbInstance) {
    try {
      dbInstance.close();
      logger.debug('SQLite connection closed');
    } catch (err) {
      logger.warn({ err }, 'Failed to close SQLite connection');
    }
  }
});

module.exports = {
  run: async (sql, params = []) => run(sql, params),
  get: async (sql, params = []) => get(sql, params),
  all: async (sql, params = []) => all(sql, params),
  transaction,
  runScript
};
