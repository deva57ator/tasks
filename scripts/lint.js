#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const folders = ['src', 'scripts', 'tests'];
let hasError = false;

function listFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listFiles(full);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      const result = spawnSync(process.execPath, ['--check', full], { stdio: 'inherit' });
      if (result.status !== 0) {
        hasError = true;
      }
    }
  }
}

for (const folder of folders) {
  const fullPath = path.join(ROOT, folder);
  if (fs.existsSync(fullPath)) {
    listFiles(fullPath);
  }
}

if (hasError) {
  process.exit(1);
}

console.log('Lint OK');
