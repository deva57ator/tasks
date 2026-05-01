# Repo Map

## Зачем этот документ

Это короткая карта репозитория для первого ориентирования. Если `architecture-*` документы объясняют, как система устроена, то этот файл отвечает на более простой вопрос: где что лежит и куда идти в зависимости от задачи.

## Верхний уровень

```text
apps/        основной код приложения
docs/        архитектурная и operational документация
infra/       nginx, systemd и rsync-артефакты для окружений
.github/     workflow деплоя и promote
README.md    стартовая точка для человека
AGENTS.md    repo-local инструкции для агента; это не часть `docs/`, а operational contract файла репозитория
```

## `apps/`

```text
apps/
  api/       Node.js API + SQLite + миграции + тесты
  web/       статический SPA на нативных ES modules
```

### Когда идти в `apps/api/`

- меняется API-контракт;
- меняется модель данных;
- нужна новая миграция;
- ломается auth, import, stats, workday или year plan на сервере;
- не проходит health-check;
- проблема проявляется только после записи в SQLite.

### Когда идти в `apps/web/`

- ломается UI;
- проблемы с localStorage;
- баг связан с `local/server` режимом;
- сломался рендер задач, year plan, sidebar, hotkeys или dialogs;
- сервер отвечает правильно, но пользователь видит неправильное поведение.

## `apps/api/`

```text
apps/api/
  data/          локальная SQLite база по умолчанию
  migrations/    SQL-миграции
  scripts/       служебные node-скрипты
  src/           runtime-код API
  tests/         Node.js tests
  package.json   backend scripts и зависимости
```

### `apps/api/src/`

```text
src/
  app.js             сборка Express app
  server.js          запуск HTTP-сервера
  config/            чтение env и runtime config
  db/                SQLite client через sqlite3 CLI
  lib/               shared helpers
  middleware/        auth, cors, error, request logging
  routes/            HTTP endpoints
  services/          доменная логика
```

### Самые важные backend-файлы

- `apps/api/src/server.js` — entry point backend.
- `apps/api/src/app.js` — pipeline middleware и routing.
- `apps/api/src/config/index.js` — `DB_PATH`, `PORT`, `TASKS_API_KEY`, `CORS_ORIGIN`.
- `apps/api/src/db/client.js` — все SQL-вызовы уходят через него.
- `apps/api/src/services/tasks.js` — самый чувствительный сервис по доменной логике.
- `apps/api/src/services/workdays.js` — ключевая логика рабочего дня.

### Куда идти по типу backend-задачи

- `routes/tasks.js` + `services/tasks.js` — CRUD и дерево задач
- `routes/projects.js` + `services/projects.js` — проекты
- `routes/workday.js` + `services/workdays.js` — рабочий день
- `routes/yearplan.js` + `services/yearplan.js` — годовой план
- `routes/import.js` + `services/importer.js` — импорт дампа
- `routes/stats.js` + `services/stats.js` — агрегированная статистика
- `migrations/*.sql` — изменение схемы БД

### Файлы, которые стоит менять осторожно

- `apps/api/src/config/index.js` — легко случайно переключить API на не ту БД
- `apps/api/src/db/client.js` — общий DB-слой для всего backend
- `apps/api/src/services/tasks.js` — влияет и на API, и на фронтендовую модель дерева
- `apps/api/src/services/workdays.js` — связан с timezone и синхронизацией рабочего дня

Для `DB_PATH` и похожих operational ловушек ориентируйтесь на `docs/backend-architecture.md`, секция `Common Pitfalls`.

## `apps/web/`

```text
apps/web/
  assets/        статические ассеты
  src/           модульный фронтенд-код
  index.html     HTML-оболочка
  main.js        orchestration и инициализация
  style.css      глобальные стили
```

### Самые важные frontend-файлы

- `apps/web/main.js` — главный orchestration-файл.
- `apps/web/src/config.js` — выбор STG/PROD API по URL, интервалы, лимиты.
- `apps/web/src/storage.js` — localStorage adapters и режим хранения.
- `apps/web/src/api.js` — frontend API client, auth lock, очереди.
- `apps/web/src/tasks-data.js` — state и логика задач.
- `apps/web/src/workday.js` — логика рабочего дня на клиенте.
- `apps/web/src/graph.js` — модуль вида `График` (месячная нагрузка + отпуска).

### `apps/web/src/`

```text
src/
  api.js                 fetch-слой и server sync
  archive.js             UI архива
  calendar.js            календарные UI-части
  config.js              константы и API routing
  due-picker.js          выбор дедлайна
  effects.js             completion effects
  keyboard.js            hotkeys
  projects.js            state и UI проектов
  graph.js               вид «График», агрегации и отпуска
  sidebar.js             resize/mobile sidebar
  sprint.js              sprint view
  storage.js             localStorage adapters
  tasks-data.js          runtime model задач
  tasks-render.js        DOM-рендер задач
  time-dialog.js         редактирование времени
  utils.js               общие утилиты
  workday.js             рабочий день
  yearplan/              feature-модули годового плана
```

### `apps/web/src/yearplan/`

```text
yearplan/
  data.js            state, cache, CRUD
  interactions.js    DOM interactions
  normalize.js       чистые функции и нормализация
  render.js          рендер feature
```

### Куда идти по типу frontend-задачи

- проблемы запуска/инициализации — `apps/web/main.js`
- local/server режим — `apps/web/main.js`, `apps/web/src/storage.js`, `apps/web/src/api.js`
- баги дерева задач — `apps/web/src/tasks-data.js`, `apps/web/src/tasks-render.js`
- UI проектов — `apps/web/src/projects.js`
- рабочий день — `apps/web/src/workday.js`
- график месяца и отпуска — `apps/web/src/graph.js`
- таймеры и время — `apps/web/src/tasks-data.js`, `apps/web/src/time-dialog.js`
- year plan — `apps/web/src/yearplan/*`
- стили и визуал — `apps/web/style.css`

### Файлы, которые стоит менять осторожно

- `apps/web/main.js` — центральная связка модулей и callback-реестров
- `apps/web/src/storage.js` — ломает persistence сразу в двух режимах
- `apps/web/src/api.js` — ломает sync, auth и server mode
- `apps/web/src/tasks-data.js` — ломает дерево, таймеры и часть работы workday

## `docs/`

```text
docs/
  architecture-overview.md
  api-contract.md
  backend-architecture.md
  frontend-architecture.md
  data-model.md
  local-development.md
  runtime-flows.md
  repo-map.md
```

### Что читать первым

1. `README.md`
2. `docs/repo-map.md`
3. `docs/architecture-overview.md`

### Что читать дальше по ситуации

- backend-задача — `docs/backend-architecture.md`
- frontend-задача — `docs/frontend-architecture.md`
- работа с HTTP shapes — `docs/api-contract.md`
- изменения схемы или payload — `docs/data-model.md`
- локальный запуск и проверки — `docs/local-development.md`
- debugging runtime или deploy — `docs/runtime-flows.md`

## `infra/`

```text
infra/
  nginx/      эталонный nginx config
  rsync/      фильтры для CI deploy
  systemd/    unit-файлы staging и production
```

### Когда идти в `infra/`

- проблема только после деплоя;
- внешний health-check не совпадает с внутренним;
- API или статика обслуживаются не по тем путям;
- нужно понять, как именно код попадает на сервер.

## `.github/workflows/`

```text
.github/workflows/
  deploy-stg.yml      автодеплой staging
  promote-prod.yml    ручной promote production
```

### Когда идти сюда

- нужно понять, откуда берётся `DB_PATH` на сервере;
- staging и production ведут себя по-разному;
- после push или promote разъехались API и frontend;
- нужно проверить, какой health-check считается успешным.

## Быстрые маршруты по типу задачи

### “Нужно поменять API”

Смотрите:

- `apps/api/src/routes/*`
- `apps/api/src/services/*`
- `apps/web/src/api.js`

### “Нужно поменять поведение задач”

Смотрите:

- `apps/web/src/tasks-data.js`
- `apps/web/src/tasks-render.js`
- `apps/api/src/services/tasks.js`
- `docs/data-model.md`

### “Нужно поменять рабочий день”

Смотрите:

- `apps/web/src/workday.js`
- `apps/api/src/services/workdays.js`
- `apps/api/src/routes/workday.js`
- `docs/runtime-flows.md`

### “Нужно изменить деплой”

Смотрите:

- `.github/workflows/*.yml`
- `infra/systemd/*`
- `infra/nginx/*`
- `infra/rsync/*`

## Что обычно можно игнорировать при локальной feature-работе

- `.git/`
- `.claude/`
- production-specific operational детали в `infra/`, если задача чисто UI или локальная логика

## Когда обновлять этот документ

Обновите `repo-map.md`, если:

- появилась новая верхнеуровневая папка с важной ролью;
- изменились entry points;
- крупная feature переехала в другое место;
- `main.js` или backend entry points перестали быть центральными;
- изменились основные operational файлы деплоя.
