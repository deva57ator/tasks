PRAGMA foreign_keys=ON;

UPDATE workdays
SET closedAt = endTs,
    updatedAt = CURRENT_TIMESTAMP
WHERE closedAt IS NULL
  AND endTs IS NOT NULL;
