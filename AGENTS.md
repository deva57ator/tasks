# AGENTS.md

## Структура проекта (коротко)
- `apps/api/` — Node.js API + миграции (`migrations/`, `scripts/`, `src/`).
- `apps/web/` — статическая SPA (index.html, main.js, style.css).
- `apps/api/data/` — локальная SQLite база по умолчанию (относительный путь `./data/tasks.db`).
- `db/` — политика миграций/бэкапов (см. `db/README.md`).
- `infra/systemd/` — unit-файлы `tasks-stg.service`, `tasks-prod.service`.
- `infra/nginx/` — конфиг nginx с путями `/tasks-stg` и `/tasks`.
- `infra/rsync/` — фильтр доставляемых файлов для деплоя.
- Staging/Production на сервере:
  - код API: `/srv/tasks-stg` и `/srv/tasks-prod` (см. workflow deploy/promote),
  - статика: `/var/www/tasks-stg` и `/var/www/tasks-prod` (см. workflow/nginx).

## Локальный запуск и проверка
API (из `apps/api/`):
```bash
npm install
npm run migrate
npm run dev
```
Дополнительно (там же):
- `npm start` — обычный запуск API.
- `npm run lint` — линт.
- `npm test` — тесты.

SPA (из `apps/web/`):
- открыть `apps/web/index.html` в браузере (статическая сборка, без сборщика).

API по умолчанию слушает `http://127.0.0.1:4001` (если не задан `PORT`).

## API маршруты и выбор окружения на фронте
- API health: `/api/health` (подключено в `apps/api/src/app.js`).
- Nginx проксирует:
  - `/tasks-stg/api/` → `http://127.0.0.1:3102/api/`
  - `/tasks/api/` → `http://127.0.0.1:3101/api/`
- В `apps/web/main.js` API префикс выбирается по пути страницы:
  - если URL начинается с `/tasks-stg`, используется `/tasks-stg/api` (STG),
  - иначе используется `/tasks/api` (PROD).

## Миграции SQLite и DB_PATH (важно)
- Миграции — SQL в `apps/api/migrations/`, запуск: `npm run migrate`.
- `DB_PATH` читается в `apps/api/src/config/index.js` и влияет на то, куда пишется база.
- В GitHub Actions:
  - STG: `DB_PATH="$PATH_STG/data/tasks.db"`
  - PROD: `DB_PATH='${PATH_PROD}/data/tasks.db'`
- В `db/README.md` база на сервере указана как `/srv/tasks-*/apps/api/data/tasks.db`.
  ⚠️ В репозитории есть расхождение путей — перепроверьте перед изменениями.
- В systemd unit-файлах используются env-файлы:
  - `/etc/tasks-stg.env`
  - `/etc/tasks-prod.env`
  Убедитесь, что там задан корректный `DB_PATH`.

## Деплой и промоут (GitHub Actions)
- **STG**: `.github/workflows/deploy-stg.yml`
  - триггер: push в `main` + manual `workflow_dispatch`.
  - rsync API по `infra/rsync/api.filter` в `/srv/tasks-stg`.
  - копирует `apps/web/` в `/var/www/tasks-stg/`.
  - выполняет `npm ci --omit=dev`, `npm run migrate`, `systemctl restart tasks-stg`.
  - health-check: `https://parkhomenko.space/tasks-stg/api/health`.

- **PROD**: `.github/workflows/promote-prod.yml`
  - триггер: только `workflow_dispatch` (можно выбрать `ref`).
  - rsync API в `/srv/tasks-prod`, web в `/var/www/tasks-prod/`.
  - выполняет `npm ci --omit=dev`, `npm run migrate`, `systemctl restart tasks-prod`.
  - внутренний health-check: `http://127.0.0.1:3101/api/health`.
  - внешний health-check: `https://parkhomenko.space/tasks/api/health`.

## Безопасные проверки
- Health endpoints:
  - STG: `https://parkhomenko.space/tasks-stg/api/health`
  - PROD: `https://parkhomenko.space/tasks/api/health`
- Логи/статус (упоминается в workflow):
  - `systemctl status tasks-stg` / `tasks-prod`
  - `journalctl -u tasks-stg` / `-u tasks-prod`

## Типовой PR (что менять и как проверять)
- Изменения API: `apps/api/**` (включая миграции в `apps/api/migrations/`).
- Изменения фронта: `apps/web/**` (статика, без сборки).
- Перед пушем:
  - API: `npm run lint`, `npm test`, `npm run migrate` (из `apps/api/`).
  - Фронт: открыть `apps/web/index.html` и проверить базовые сценарии.

## Минимальный чеклист “готово, если…”
- [ ] Есть нужные изменения только в `apps/api/**` и/или `apps/web/**`.
- [ ] Миграции (если есть) прошли локально через `npm run migrate`.
- [ ] `npm run lint` и `npm test` (если трогали API) без ошибок.
- [ ] Health-check URL соответствует окружению (STG/PROD).
- [ ] DB_PATH проверен и указывает на правильную базу.
