#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const db = require('../src/db/client');
require('../src/config');

async function migrate() {
  const migrationsDir = path.resolve(__dirname, '../migrations');
  if (!fs.existsSync(migrationsDir)) {
    console.log('No migrations directory found, skipping.');
    return;
  }
  const files = fs.readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  await db.run('CREATE TABLE IF NOT EXISTS migrations (id TEXT PRIMARY KEY, appliedAt TEXT NOT NULL)');
  const rows = await db.all('SELECT id FROM migrations');
  const applied = new Set(rows.map((row) => row.id));

  for (const file of files) {
    if (applied.has(file)) {
      continue;
    }
    const fullPath = path.join(migrationsDir, file);
    console.log(`Applying migration ${file}...`);
    await db.runScript(fullPath);
    await db.run('INSERT INTO migrations (id, appliedAt) VALUES (?, ?)', [file, new Date().toISOString()]);
  }

  console.log('Migrations complete.');
}

migrate().catch((err) => {
  console.error('Migration failed:', err.stderr || err.message || err);
  process.exit(1);
});
