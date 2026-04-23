# Архитектура backend

## Зачем этот документ

Этот файл описывает текущее устройство API-части проекта: как поднимается сервер, где проходят границы между слоями, какие сервисы за что отвечают и куда смотреть при изменениях. Он нужен как рабочая карта backend-кода, а не как список всех эндпоинтов.

## Точки входа

Главные backend entry points:

- `apps/api/src/server.js` — запуск HTTP-сервера и graceful shutdown.
- `apps/api/src/app.js` — сборка Express-приложения.
- `apps/api/src/config/index.js` — чтение runtime-конфига.
- `apps/api/scripts/migrate.js` — применение SQL-миграций.

Упрощённая схема старта:

```text
server.js
  -> load config
  -> createApp()
  -> http.createServer(app)
  -> start workdayLifecycle
  -> listen(host, port)
```

## Runtime-конфиг

Конфиг собирается в `apps/api/src/config/index.js`.

Ключевые переменные:

- `PORT`
- `HOST`
- `DB_PATH`
- `TASKS_API_KEY`
- `CORS_ORIGIN`

Особенность:

- `DB_PATH` резолвится через `path.resolve(process.cwd(), ...)`, поэтому фактическая база зависит от рабочей директории процесса.

Это одно из самых важных мест для сопровождения, потому что ошибка здесь приводит к работе не с той SQLite-базой.

## Слои backend

### 1. Transport layer

- `src/server.js`
- `src/app.js`
- `src/routes/*`
- `src/middleware/*`

Этот слой отвечает за:

- HTTP-сервер;
- сборку Express pipeline;
- валидацию входных параметров на уровне маршрута;
- преобразование доменных ошибок в HTTP-ответы.

### 2. Domain services

- `src/services/tasks.js`
- `src/services/projects.js`
- `src/services/workdays.js`
- `src/services/archive.js`
- `src/services/stats.js`
- `src/services/importer.js`
- `src/services/yearplan.js`
- `src/services/workdayLifecycle.js`

Это главный слой бизнес-логики:

- CRUD и нормализация;
- доменные ограничения;
- агрегации;
- импорт данных;
- lifecycle рабочего дня.

### 3. Persistence layer

- `src/db/client.js`
- `src/migrations/*.sql`

Этот слой отвечает за SQL и исполнение запросов к SQLite.

### 4. Shared libs

- `src/lib/time.js`
- `src/lib/task-utils.js`
- `src/lib/pagination.js`
- `src/lib/logger.js`

Это мелкие утилитарные модули, используемые несколькими сервисами и middleware.

## Express pipeline

`apps/api/src/app.js` собирает приложение в таком порядке:

1. `express.json({ limit: '1mb' })`
2. `requestLogger`
3. `cors`
4. `/api/health` без auth
5. `auth` на весь остальной `/api`
6. доменные роуты
7. `errorHandler`

Это значит:

- health-check всегда должен оставаться доступным без API-ключа;
- все остальные маршруты защищены общим middleware;
- маршруты опираются на общий формат ошибок из `errorHandler`.

## Middleware

### `request-logger.js`

Логирует завершившийся запрос в формате:

- HTTP метод
- URL
- status code
- длительность в миллисекундах

Это минимальная observability проекта.

### `cors.js`

Включает CORS только если задан `CORS_ORIGIN`.

Поведение:

- выставляет `Access-Control-Allow-Origin`;
- разрешает `GET,POST,PUT,DELETE,OPTIONS`;
- разрешает заголовки `Content-Type,X-API-Key`;
- сам отвечает на `OPTIONS` со статусом `204`.

### `auth.js`

Общая авторизация для всего API, кроме health-check.

Поведение:

- если `TASKS_API_KEY` не задан, всё кроме `/api/health` будет отвечать `401`;
- ключ читается из заголовка `X-API-Key`;
- `OPTIONS` запросы пропускаются.

Практический вывод: backend intentionally fail-closed, если секрет не настроен.

### `error.js`

Нормализует ошибки в JSON-формат:

```json
{
  "error": {
    "code": "internal_error",
    "message": "Internal Server Error"
  }
}
```

Особенности:

- статус берётся из `err.status` или `err.statusCode`;
- код ошибки берётся из `err.code`;
- `err.expose` определяет, можно ли показывать исходное сообщение клиенту.

## Маршруты и ответственность

### `/api/health`

- маршрут живёт в `src/routes/health.js`
- должен оставаться максимально простым и независимым
- используется деплоем и внешними health-check

### `/api/tasks`

- route: `src/routes/tasks.js`
- service: `src/services/tasks.js`

Что делает:

- list c фильтрами и пагинацией;
- create/update/delete задачи;
- маппинг между плоской SQL-моделью и клиентским деревом задач.

Это один из самых критичных сервисов проекта.

### `/api/projects`

- route: `src/routes/projects.js`
- service: `src/services/projects.js`

Что делает:

- CRUD проектов;
- возвращает вычисленный `timeSpent` по задачам проекта.

### `/api/archive`

- route: `src/routes/archive.js`
- service: `src/services/archive.js`

Что делает:

- список архивных записей с пагинацией;
- удаление архивной записи.

### `/api/workday`

- route: `src/routes/workday.js`
- service: `src/services/workdays.js`
- lifecycle: `src/services/workdayLifecycle.js`

Что делает:

- реализует подмаршруты `/current`, `/sync`, `/close`, `/reopen`;
- отдаёт текущий рабочий день;
- синхронизирует рабочий день с фронтенда;
- закрывает и переоткрывает рабочий день;
- возвращает `ETag` для текущего состояния.

Это отдельная доменная область, а не просто приложение поверх `tasks`.

### `/api/import`

- route: `src/routes/import.js`
- service: `src/services/importer.js`

Что делает:

- принимает JSON-дамп;
- извлекает из него задачи, проекты, архив и рабочий день;
- раскладывает данные по соответствующим сервисам.

### `/api/stats`

- route: `src/routes/stats.js`
- service: `src/services/stats.js`

Что делает:

- фактический summary endpoint сейчас: `/api/stats/summary`;
- считает summary по активным задачам;
- отдельно агрегирует архивные данные из JSON payload.

### `/api/yearplan`

- route: `src/routes/yearplan.js`
- service: `src/services/yearplan.js`

Что делает:

- list/create/update/delete активностей годового плана;
- валидирует диапазоны дат и нормализует значения.

## Как устроен слой сервисов

Общая договорённость по коду такая:

- route отвечает за HTTP-уровень и базовую проверку входа;
- service отвечает за предметную логику и работу с БД;
- db client отвечает только за исполнение SQL.

Это не идеальная чистая архитектура, но для текущего проекта границы достаточно ясные.

## `tasks` service

`src/services/tasks.js` — самый насыщенный по логике сервис.

Он отвечает за:

- загрузку всех задач из БД;
- построение дерева через `lib/task-utils`;
- фильтрацию дерева;
- CRUD одной задачи;
- bulk import;
- архивирование поддеревьев;
- перенос просроченных незавершённых задач на новый рабочий день.

Особенности:

- в таблице задачи хранятся плоско, через `parentId`;
- API наружу отдаёт дерево;
- часть операций сначала загружает весь набор задач, а потом строит дерево в памяти.

Практический вывод: изменения в `tasks.js` почти всегда нужно сверять и с SQL, и с frontend tree-model.

## `projects` service

`src/services/projects.js` относительно простой:

- CRUD проектов;
- агрегирует суммарное время по задачам проекта;
- поддерживает import с upsert-поведением.

Особенность:

- удаление проекта полагается на SQL foreign key поведение, а не на ручную переработку задач в сервисе.

## `workdays` service

`src/services/workdays.js` — второй по важности сервис после `tasks`.

Он отвечает за:

- вычисление рабочего окна по фиксированной timezone логике GMT+3;
- автосоздание активного рабочего дня;
- upsert текущего состояния;
- закрытие и reopening;
- вычисление агрегатов по данным задач и snapshot payload;
- гидрацию записи БД в API-модель.

Особенности:

- `id` рабочего дня вычисляется как дата, а не UUID;
- доменная логика завязана на период `06:00 -> 03:00`;
- часть агрегатов вычисляется через сравнение task snapshot baseline с текущими задачами в БД.

Любые изменения здесь требуют очень аккуратной проверки на границе backend <-> frontend.

## `workdayLifecycle`

`src/services/workdayLifecycle.js` — фоновый цикл с таймером раз в 5 минут.

Что делает:

- вызывает `workdays.getCurrent()`;
- тем самым поддерживает актуальность рабочего дня и авто-переходов;
- работает параллельно с HTTP-сервером до graceful shutdown.

Важно:

- это единственная явная фоновая задача backend;
- ошибки lifecycle логируются, но не валят процесс немедленно.

## `archive` service

`src/services/archive.js` хранит JSON payload как текст в SQLite и маппит его обратно в объект при чтении.

Особенности:

- list работает с пагинацией;
- insert/import используют upsert;
- payload не нормализуется в отдельные таблицы.

## `importer` service

`src/services/importer.js` — glue layer между внешним JSON-дампом и внутренними сервисами.

Он умеет принимать:

- legacy ключи localStorage;
- более прямые поля `tasks`, `projects`, `workday`, `archive`.

Особенности:

- дерево задач сплющивается в список с `parentId`;
- архив нормализуется в список записей для `archiveService`;
- рабочий день импортируется отдельно через `workdaysService`.

Это полезное место, если нужно понять обратную совместимость форматов данных.

## `stats` service

`src/services/stats.js` считает summary из двух источников:

1. текущие активные задачи в таблице `tasks`
2. JSON payload из `archive`

Особенность:

- часть статистики считается не SQL-агрегацией, а обходом JSON-деревьев в Node.js.

## `yearplan` service

`src/services/yearplan.js` отвечает за:

- строгую нормализацию входных чисел;
- проверку диапазонов месяцев и дней;
- нормализацию `title`, `color`, `isDone`, `projectId`;
- CRUD по `yearplan_activities`.

Особенность:

- валидация здесь заметно строже, чем на уровне route;
- сервис хранит важную часть предметных инвариантов year plan.

## DB client

`src/db/client.js` — тонкая, но важная прослойка.

Что умеет:

- `run`
- `get`
- `all`
- `transaction`
- `runScript`

Как это работает:

- SQL исполняется через системный `sqlite3`;
- параметры подставляются вручную через `bindParams`;
- при инициализации включается `PRAGMA journal_mode=WAL`;
- перед каждым исполнением включается `PRAGMA foreign_keys=ON`.

Это означает:

- SQL очень прозрачен для чтения;
- нет ORM и нет абстракций поверх схемы;
- любые неточности в SQL будут сразу влиять на production behaviour.

## Миграции

Миграции лежат в `apps/api/migrations/*.sql`.

Подход проекта:

- схема описывается SQL-файлами;
- версия схемы хранится в `meta.schemaVersion`;
- новые фичи обычно требуют одновременно:
  - новой миграции,
  - обновления сервиса,
  - при необходимости обновления импортера и фронтенда.

## Пагинация и лимиты

`src/lib/pagination.js` задаёт общий паттерн:

- `default limit = 50`
- `max limit = 200`
- `offset` по умолчанию `0`

Это влияет на `projects`, `tasks`, `archive`.

## Наблюдаемость и логи

Сейчас observability минимальная:

- request logging через middleware;
- lifecycle и startup/shutdown сообщения через `logger`;
- ошибки запросов логируются в `errorHandler`.

При отладке production-проблем реальным источником правды остаются:

- `journalctl`
- `systemctl status`
- health-check endpoints

## Что обычно читать при изменениях

### Если меняется схема API ответа

Смотрите:

- соответствующий route
- соответствующий service
- `apps/web/src/api.js`
- потребляющий фронтендовый модуль

### Если меняется модель задач

Смотрите:

- `src/services/tasks.js`
- `src/lib/task-utils.js`
- миграции
- `apps/web/src/tasks-data.js`

### Если меняется рабочий день

Смотрите:

- `src/services/workdays.js`
- `src/services/workdayLifecycle.js`
- `src/routes/workday.js`
- `apps/web/src/workday.js`
- `apps/web/src/api.js`

### Если меняется импорт

Смотрите:

- `src/services/importer.js`
- `src/services/tasks.js`
- `src/services/archive.js`
- `src/services/workdays.js`

## Инварианты, которые легко сломать

- `/api/health` должен оставаться доступным без авторизации.
- `TASKS_API_KEY` fail-closed поведение не должно случайно превратиться в fail-open.
- `DB_PATH` нельзя менять, не проверив рабочую директорию процесса и env-файлы.
- `tasks` и `workdays` нельзя менять изолированно от фронтенда: они связаны общим payload и общей моделью состояния.
- `yearplan` требует синхронности между миграциями, сервисом и фронтендом.
- SQL foreign keys здесь часть бизнес-поведения, а не просто техническая деталь.

## Когда документ стоит обновить

Обновите этот файл, если произошло одно из следующих изменений:

- появился новый доменный сервис или новый маршрут;
- backend перестал использовать `sqlite3` CLI;
- auth-модель изменилась;
- lifecycle рабочего дня изменился по расписанию или ответственности;
- появился новый фоновой процесс;
- изменилась контрактная форма ошибок API.
