# Local Development

## Зачем этот документ

Этот файл даёт агенту и разработчику минимальный набор команд для локального запуска, проверки и безопасной работы перед изменениями.

## Требования

- Node.js `>=20` для backend
- системный бинарь `sqlite3` в `PATH`
- браузер для открытия SPA

## Backend

Рабочая директория:

```bash
cd apps/api
```

Первый запуск:

```bash
cat > .env <<'EOF'
TASKS_API_KEY=dev-secret
EOF
npm install
npm run migrate
npm run dev
```

Ожидаемое поведение:

- backend слушает `http://127.0.0.1:4001` по умолчанию
- health-check доступен на `http://127.0.0.1:4001/api/health`

### Обязательные переменные

В `.env` обычно важнее всего:

- `TASKS_API_KEY`

Остальные параметры имеют defaults, но при диагностике нужно помнить про:

- `PORT`
- `HOST`
- `DB_PATH`
- `CORS_ORIGIN`

## Frontend

Самый простой запуск:

```bash
open apps/web/index.html
```

Или через простой static server:

```bash
cd apps/web
python3 -m http.server 8000
```

Замечания:

- в `local` режиме frontend может работать без API;
- для `server` режима нужен backend и корректный API key;
- выбор STG/PROD префикса по URL актуален для серверного размещения, а не для прямого открытия локального файла.

## Полезные команды проверки

Из `apps/api/`:

```bash
npm run lint
npm test
npm run migrate
```

Обычный production-like запуск:

```bash
npm start
```

## Что запускать перед изменениями

### Если меняется backend

```bash
cd apps/api
npm run lint
npm test
npm run migrate
```

### Если меняется frontend

- открыть `apps/web/index.html`
- проверить базовые сценарии вручную
- если затронут `server` режим, проверить и с поднятым backend

### Если меняются миграции

- локально прогнать `npm run migrate`
- проверить, что `DB_PATH` указывает на ожидаемую локальную базу

## Локальные адреса и ожидания

- API default: `http://127.0.0.1:4001/api`
- Health: `http://127.0.0.1:4001/api/health`

## Частые локальные проблемы

### `Unauthorized` почти на все endpoints

Проверьте:

- задан ли `TASKS_API_KEY` в `apps/api/.env`
- отправляет ли frontend ключ в `X-API-Key`

### Backend не стартует или миграции падают

Проверьте:

- установлен ли `sqlite3`
- корректен ли `DB_PATH`
- существует ли каталог для базы или может ли backend его создать

### Frontend в `server` режиме не грузит данные

Проверьте:

- что backend реально поднят
- какой API key сохранён во frontend
- нет ли auth lock в `apps/web/src/api.js`

## Где искать дальше

- API shapes: `docs/api-contract.md`
- архитектура backend: `docs/backend-architecture.md`
- архитектура frontend: `docs/frontend-architecture.md`
- runtime сценарии: `docs/runtime-flows.md`
