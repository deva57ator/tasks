PRAGMA foreign_keys=ON;

ALTER TABLE yearplan_activities
ADD COLUMN projectId TEXT;

CREATE INDEX IF NOT EXISTS idx_yearplan_project ON yearplan_activities(projectId);

UPDATE meta SET schemaVersion = 5 WHERE schemaVersion < 5;
