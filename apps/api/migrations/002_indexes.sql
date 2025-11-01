PRAGMA foreign_keys=ON;

CREATE INDEX IF NOT EXISTS idx_tasks_updatedAt ON tasks(updatedAt DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_done_completedAt ON tasks(done, completedAt);
CREATE INDEX IF NOT EXISTS idx_projects_updatedAt ON projects(updatedAt DESC);
CREATE INDEX IF NOT EXISTS idx_workdays_closedAt ON workdays(closedAt);
