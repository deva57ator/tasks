const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');

const SQLITE_BIN = 'sqlite3';
let initialized = false;

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function ensureInitialized() {
  if (initialized) return;
  ensureDir(config.dbPath);
  await exec(['-cmd', 'PRAGMA journal_mode=WAL;', config.dbPath, 'SELECT 1;']);
  initialized = true;
}

function exec(args, input) {
  return new Promise((resolve, reject) => {
    execFile(SQLITE_BIN, args, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        return reject(err);
      }
      resolve(stdout);
    }).stdin?.end(input);
  });
}

function formatValue(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'NULL';
    return String(value);
  }
  if (typeof value === 'boolean') {
    return value ? '1' : '0';
  }
  if (value instanceof Date) {
    return `'${value.toISOString()}'`;
  }
  if (typeof value === 'object') {
    return `'${escapeString(JSON.stringify(value))}'`;
  }
  return `'${escapeString(String(value))}'`;
}

function escapeString(value) {
  return value.replace(/'/g, "''");
}

function bindParams(sql, params = []) {
  let index = 0;
  return sql.replace(/\?/g, () => {
    if (index >= params.length) {
      throw new Error('Not enough parameters for SQL statement');
    }
    const val = formatValue(params[index]);
    index += 1;
    return val;
  });
}

async function run(sql, params = []) {
  await ensureInitialized();
  const statement = `PRAGMA foreign_keys=ON; ${bindParams(sql, params)}`;
  await exec([config.dbPath, statement]);
}

async function get(sql, params = []) {
  await ensureInitialized();
  const statement = bindParams(sql, params);
  const output = await exec(['-json', config.dbPath, `PRAGMA foreign_keys=ON; ${statement}`]);
  const parsed = output ? JSON.parse(output) : [];
  return parsed[0] || null;
}

async function all(sql, params = []) {
  await ensureInitialized();
  const statement = bindParams(sql, params);
  const output = await exec(['-json', config.dbPath, `PRAGMA foreign_keys=ON; ${statement}`]);
  return output ? JSON.parse(output) : [];
}

async function transaction(builder) {
  await ensureInitialized();
  const statements = [];
  await builder({
    run: (sql, params = []) => {
      statements.push(bindParams(sql, params));
    }
  });
  if (!statements.length) return;
  const body = statements.join('; ');
  const combined = `PRAGMA foreign_keys=ON; BEGIN IMMEDIATE; ${body}; COMMIT;`;
  await exec([config.dbPath, combined]);
}

async function runScript(filePath) {
  await ensureInitialized();
  const full = path.resolve(filePath);
  await exec(['-cmd', 'PRAGMA foreign_keys=ON;', config.dbPath, `.read ${full}`]);
}

module.exports = {
  run,
  get,
  all,
  transaction,
  bindParams,
  formatValue,
  runScript
};
