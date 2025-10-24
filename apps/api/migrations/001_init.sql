PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  emoji TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  due TEXT,
  projectId TEXT,
  notes TEXT,
  timeSpentMs INTEGER NOT NULL DEFAULT 0,
  parentId TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  completedAt TEXT,
  FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE SET NULL,
  FOREIGN KEY (parentId) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tasks_project_due_done ON tasks(projectId, due, done);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parentId);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due);

CREATE TABLE IF NOT EXISTS archive (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  archivedAt TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_archive_archivedAt ON archive(archivedAt DESC);

CREATE TABLE IF NOT EXISTS workdays (
  id TEXT PRIMARY KEY,
  startTs INTEGER,
  endTs INTEGER,
  summaryTimeMs INTEGER NOT NULL DEFAULT 0,
  summaryDone INTEGER NOT NULL DEFAULT 0,
  payload TEXT,
  closedAt INTEGER,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  schemaVersion INTEGER NOT NULL
);

INSERT INTO meta (schemaVersion)
SELECT 1
WHERE NOT EXISTS (SELECT 1 FROM meta);
