PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS yearplan_activities_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER NOT NULL,
  startMonth INTEGER NOT NULL,
  startDay INTEGER NOT NULL,
  endMonth INTEGER NOT NULL,
  endDay INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT 'активность',
  isDone INTEGER NOT NULL DEFAULT 0,
  createdTs INTEGER NOT NULL,
  updatedTs INTEGER NOT NULL
);

INSERT INTO yearplan_activities_new (id, year, startMonth, startDay, endMonth, endDay, title, isDone, createdTs, updatedTs)
SELECT id, year, month, startDay, month, endDay, title, isDone, createdTs, updatedTs
FROM yearplan_activities;

DROP TABLE yearplan_activities;
ALTER TABLE yearplan_activities_new RENAME TO yearplan_activities;

CREATE INDEX IF NOT EXISTS idx_yearplan_year_start ON yearplan_activities(year, startMonth, startDay);
CREATE INDEX IF NOT EXISTS idx_yearplan_year_end ON yearplan_activities(year, endMonth, endDay);

UPDATE meta SET schemaVersion = 3 WHERE schemaVersion < 3;
