# Tasks API

Backend API for the mini task tracker. Built with Node.js 20, a lightweight Express-compatible HTTP server, and SQLite (file mode with WAL).

## Getting started

1. Copy `.env.example` to `.env` and update the values (at minimum `API_KEY`).
2. Install SQLite CLI (already available in most Linux distributions).
3. Run database migrations:

```bash
npm run migrate
```

4. Start the server:

```bash
npm start
```

By default the server listens on `127.0.0.1:4001`. All API routes are prefixed with `/api` and require an `x-api-key` header, except `/api/health`.

## Available scripts

- `npm run migrate` – apply SQL migrations.
- `npm run start` – start the HTTP server.
- `npm run dev` – start the server with file watching.
- `npm run lint` – run a simple syntax check across JS sources.
- `npm test` – execute unit test stubs (Node.js built-in runner).

## Deployment notes

A sample systemd unit file is available in `deploy/tasks-api.service`, and an Nginx snippet for reverse proxying `/api/` is provided at `deploy/nginx.conf`.
