# Tasks

Monorepo for the Tasks single-page app and Node.js API. The project serves two environments (staging and production) from the same codebase.

## Repository layout

```
apps/
  api/           # Express-compatible API server and migrations
  web/           # Static SPA assets (index.html, main.js, style.css)
db/              # Policies for migrations and backups
infra/
  nginx/         # Reference Nginx configuration
  rsync/         # File delivery manifest used in CI
  systemd/       # Reference systemd unit files
.github/workflows/deploy.yml  # CI workflow that deploys to staging and production
README.md        # This document
```

## Environment configuration

Copy `apps/api/.env.example` to `apps/api/.env` when running locally. The API uses the following variables:

- `PORT` – TCP port to bind (default `4001`).
- `HOST` – host/interface to bind (default `127.0.0.1`).
- `DB_PATH` – path to the SQLite database file (default `./data/tasks.db`).
- `API_KEY` – shared secret that clients must provide in the `x-api-key` header.
- `CORS_ORIGIN` – optional origin allowed for browser requests (empty string disables CORS headers).

Environment files for staging and production live on the server under `/etc/tasks-stg.env` and `/etc/tasks-prod.env` and are loaded by systemd.

## Local development

From `apps/api/`:

```bash
npm install
npm run migrate
npm run dev
```

The API will listen on `http://127.0.0.1:4001/api`. The SPA in `apps/web/` can be opened directly in a browser (it expects the API on the same host under `/api`).

Useful scripts:

- `npm run start` – start the API without file watching.
- `npm run dev` – start the API with live reload (Node.js `--watch`).
- `npm run migrate` – apply pending SQL migrations from `apps/api/migrations/`.
- `npm run lint` – run the lightweight lint script.
- `npm test` – execute the Node.js test suite stubs.

## Deployment workflow

Continuous delivery is handled by GitHub Actions (`.github/workflows/deploy.yml`). On every push to `main` (or manual dispatch) the pipeline:

1. Syncs the repository to `/srv/tasks-stg` and `/srv/tasks-prod` via `rsync` using `infra/rsync/.rsync-filter` to ship only the API and SPA assets.
2. Copies the SPA bundle to `/var/www/tasks-stg/` and `/var/www/tasks-prod/`.
3. Runs `npm ci --omit=dev`, executes database migrations, and restarts the `tasks-stg` / `tasks-prod` systemd units.

The deployment keeps the existing directory layout on the servers, so no downtime or unit changes are required. Verify deployments with:

```bash
curl -sS https://parkhomenko.space/tasks-stg/api/health
curl -sS https://parkhomenko.space/tasks/api/health
```

## Server topology

- API services run as systemd units defined in `infra/systemd/`. Their working directories are `/srv/tasks-stg` and `/srv/tasks-prod`, and each unit executes `node apps/api/src/server.js`.
- Static files are served by Nginx from `/var/www/tasks-stg/` and `/var/www/tasks-prod/`. The reference configuration is stored in `infra/nginx/parkhomenko.space.conf` and proxies `/tasks-stg/api/*` and `/tasks/api/*` to the respective Node.js services.
- SQLite databases reside in `/srv/tasks-*/apps/api/data/` on the servers. See `db/README.md` for migration and backup policies.

## Rollback strategy

1. Restore the previous application snapshot under `/srv/tasks-stg` and `/srv/tasks-prod` (from backup or tag).
2. Restart the services: `sudo systemctl restart tasks-stg tasks-prod`.
3. If necessary, revert to the previous Git revision or temporarily disable the deploy workflow by editing `on.push` in GitHub Actions.
4. Validate with the health-check endpoints and static SPA URLs.
