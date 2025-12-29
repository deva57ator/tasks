PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS yearplan_activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  startDay INTEGER NOT NULL,
  endDay INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT 'активность',
  isDone INTEGER NOT NULL DEFAULT 0,
  createdTs INTEGER NOT NULL,
  updatedTs INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_yearplan_year_month ON yearplan_activities(year, month);

UPDATE meta SET schemaVersion = 2 WHERE schemaVersion < 2;
