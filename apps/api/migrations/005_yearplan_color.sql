PRAGMA foreign_keys=ON;

ALTER TABLE yearplan_activities
ADD COLUMN color TEXT NOT NULL DEFAULT '#3a82f6';

UPDATE meta SET schemaVersion = 4 WHERE schemaVersion < 4;
