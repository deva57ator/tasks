# Database operations

The application uses a SQLite database stored under `apps/api/data/`. All schema changes must be implemented as SQL files in `apps/api/migrations/` and applied through `npm run migrate`.

## Migration policy

- Every structural change must be captured by a new migration with an incremental timestamp prefix (for example `202402281000_add_status_column.sql`).
- Migrations must be idempotent and safe to re-run; use `IF NOT EXISTS` / `DROP ... IF EXISTS` guards where necessary.
- Run `npm run migrate` locally before pushing changes to verify the scripts.
- Production deployments rely on the GitHub Actions workflow (`deploy.yml`) to run `npm run migrate` automatically on both staging and production hosts.

## Backups

- Databases are stored at `/srv/tasks-stg/apps/api/data/tasks.db` and `/srv/tasks-prod/apps/api/data/tasks.db` on the server.
- Use `sqlite3`'s `.backup` command or filesystem-level snapshots to capture backups before risky migrations.
- Keep at least the latest nightly backup for staging and a weekly backup for production. Retention for production must be ≥ 30 days.
- Store backup archives outside of `/srv/tasks-*` (for example under `/var/backups/tasks/`).

## Restore procedure

1. Stop the corresponding systemd service (`sudo systemctl stop tasks-stg` or `tasks-prod`).
2. Copy the backup database file back to `apps/api/data/tasks.db`.
3. Start the service again (`sudo systemctl start tasks-stg` or `tasks-prod`).
4. Validate the API with `/api/health` before considering the restoration complete.
