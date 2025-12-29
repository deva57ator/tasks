const fs = require('node:fs');
const path = require('node:path');

function config(options = {}) {
  const envPath = options.path || path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return { parsed: {} };
  const content = fs.readFileSync(envPath, 'utf8');
  const parsed = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!key) continue;
    parsed[key] = value;
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
  return { parsed };
}

module.exports = { config };
