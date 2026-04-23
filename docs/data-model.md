# Модель данных

## Зачем этот документ

Этот файл фиксирует текущие сущности, их связи и бизнес-инварианты. Он нужен, чтобы агент не выводил модель данных по кускам из SQL, фронтендовой нормализации и серверных сервисов.

## Обзор сущностей

В проекте есть пять основных доменных сущностей:

1. `projects`
2. `tasks`
3. `workdays`
4. `archive`
5. `yearplan_activities`

Служебная таблица:

6. `meta`

## Связи между сущностями

```text
projects 1 --- * tasks
projects 1 --- * yearplan_activities (optional)
tasks    1 --- * tasks (parentId -> id)
workdays store snapshots/aggregates derived from tasks
archive stores historical payloads, usually related to closed workdays or removed task trees
```

## `projects`

Назначение: каталог проектов, к которым можно привязать задачи и year plan активности.

Основные поля:

- `id TEXT PRIMARY KEY`
- `title TEXT NOT NULL`
- `emoji TEXT`
- `createdAt TEXT NOT NULL`
- `updatedAt TEXT NOT NULL`

Особенности:

- на API проект дополнительно отдаёт агрегированное поле `timeSpent`;
- `timeSpent` не хранится как отдельная колонка в таблице `projects`, а считается через `SUM(tasks.timeSpentMs)`.

Инварианты:

- проект может существовать без задач;
- удаление проекта не удаляет задачи, а обнуляет у них `projectId` через `ON DELETE SET NULL`;
- привязка year plan к проекту сейчас логическая, без SQL foreign key.

## `tasks`

Назначение: основная рабочая сущность приложения.

Основные поля таблицы:

- `id TEXT PRIMARY KEY`
- `title TEXT NOT NULL`
- `done INTEGER NOT NULL DEFAULT 0`
- `due TEXT`
- `projectId TEXT`
- `notes TEXT`
- `timeSpentMs INTEGER NOT NULL DEFAULT 0`
- `parentId TEXT`
- `createdAt TEXT NOT NULL`
- `updatedAt TEXT NOT NULL`
- `completedAt TEXT`

Связи:

- `projectId -> projects.id` с `ON DELETE SET NULL`
- `parentId -> tasks.id` с `ON DELETE CASCADE`

Как задача выглядит на API и фронте:

- `projectId` маппится в поле `project`;
- `timeSpentMs` маппится в поле `timeSpent`;
- на фронте задачи собираются в дерево через `children`;
- `children` не хранится в SQLite, это производная клиентская структура.

Инварианты:

- `title` обязателен для создания через API;
- `done` трактуется как boolean, но хранится числом `0/1`;
- `completedAt` выставляется при завершении задачи;
- `timeSpent`/`timeSpentMs` не должен быть отрицательным;
- удаление родительской задачи каскадно удаляет всё поддерево;
- на фронте максимальная глубина дерева ограничена `MAX_TASK_DEPTH = 2`.

Важно:

- ограничение глубины enforced в первую очередь фронтендом, а не SQL-схемой;
- сервер допускает запись `parentId`, если запись проходит ограничения внешнего ключа.

## `workdays`

Назначение: состояние и история рабочего дня как отдельной доменной сущности.

Основные поля:

- `id TEXT PRIMARY KEY`
- `startTs INTEGER`
- `endTs INTEGER`
- `summaryTimeMs INTEGER NOT NULL DEFAULT 0`
- `summaryDone INTEGER NOT NULL DEFAULT 0`
- `payload TEXT`
- `closedAt INTEGER`
- `createdAt TEXT NOT NULL`
- `updatedAt TEXT NOT NULL`

`id`:

- не UUID;
- формируется как дата рабочего дня в формате `YYYY-MM-DD`;
- вычисляется в фиксированной timezone логике GMT+3.

Что лежит в `payload`:

- снимок клиентского состояния рабочего дня;
- baseline по задачам;
- completed map;
- флаги `locked`, `closedManually`;
- `manualClosedStats`;
- финальные агрегаты (`finalTimeMs`, `finalDoneCount`);
- `reopenedAt`.

Как работает доменная логика:

- сервер умеет определить текущее окно рабочего дня;
- день активен с `06:00` до `03:00` следующего календарного дня по GMT+3;
- если рабочий день отсутствует, backend может создать его автоматически;
- день можно синхронизировать, закрыть и переоткрыть.

Инварианты:

- `summaryTimeMs` и `summaryDone` неотрицательны;
- `closedAt = null` означает открытый рабочий день;
- `payload` может быть источником данных для восстановления UI и итоговых метрик;
- агрегаты рабочего дня производны от задач и snapshot-данных, а не независимая бизнес-сущность.

## `archive`

Назначение: историческое хранилище JSON-снапшотов.

Основные поля:

- `id TEXT PRIMARY KEY`
- `payload TEXT NOT NULL`
- `archivedAt TEXT NOT NULL`
- `createdAt TEXT NOT NULL`
- `updatedAt TEXT NOT NULL`

Что важно:

- `payload` хранится как JSON-строка;
- архив используется для исторических данных, а не для оперативного состояния;
- структура payload может представлять рабочий день или архивируемое поддерево задач.

Инварианты:

- это append-oriented сущность по смыслу;
- фронтенд воспринимает архив как список объектных записей, а не как нормализованную реляционную модель.

## `yearplan_activities`

Назначение: интервальные активности годового плана.

Текущая структура после миграций и кода сервиса:

- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `year INTEGER NOT NULL`
- `startMonth INTEGER NOT NULL`
- `startDay INTEGER NOT NULL`
- `endMonth INTEGER NOT NULL`
- `endDay INTEGER NOT NULL`
- `title TEXT NOT NULL DEFAULT 'активность'`
- `color TEXT NOT NULL DEFAULT '#3a82f6'`
- `isDone INTEGER NOT NULL DEFAULT 0`
- `projectId TEXT`
- `createdTs INTEGER NOT NULL`
- `updatedTs INTEGER NOT NULL`

Важно:

- year plan эволюционировал через несколько миграций;
- текущий сервис `apps/api/src/services/yearplan.js` работает уже с диапазоном `startMonth/startDay -> endMonth/endDay`, цветом и `projectId`;
- если нужно перепроверить фактическую финальную схему, смотрите все миграции `003`-`006` вместе, а не только первую.

Инварианты уровня сервиса:

- `year`, `startMonth`, `endMonth`, `startDay`, `endDay` обязательны;
- месяцы должны быть в диапазоне `1..12`;
- день не может выходить за число дней в месяце;
- конечная дата не может быть раньше начальной;
- `title` нормализуется в `'активность'`, если пустой;
- `isDone` нормализуется в `0/1`;
- `projectId` опционален.

Связь с проектами:

- логически activity может быть привязана к проекту;
- SQL foreign key на `projects` сейчас не добавлен, поэтому консистентность этой ссылки обеспечивается приложением, а не базой.

## `meta`

Назначение: учёт версии схемы.

Поле:

- `schemaVersion INTEGER NOT NULL`

Использование:

- миграции обновляют `schemaVersion`;
- таблица служебная, но критична для понимания, применялись ли ожидаемые изменения схемы.

## Как данные маппятся между слоями

### SQLite -> API

- `tasks.projectId` -> `task.project`
- `tasks.timeSpentMs` -> `task.timeSpent`
- `projects` -> проект с вычисленным `timeSpent`
- `workdays.payload` -> parsed object

### API -> Frontend runtime state

- плоские записи задач собираются в дерево;
- `parentId` сохраняется и одновременно используется для сборки `children`;
- часть UI-полей не хранится на сервере и вычисляется уже на клиенте;
- активные таймеры живут отдельно от таблицы `tasks` и восстанавливаются из browser storage.

## Инварианты, которые особенно важны при изменениях

- Любое изменение структуры `tasks` надо проверять и в SQL, и в frontend tree normalization.
- Любое изменение `workday.payload` должно быть совместимо с `normalizeWorkdayState` на фронте и гидратацией на сервере.
- Изменение `yearplan_activities` почти всегда требует синхронного обновления миграций, `services/yearplan.js` и фронтендовых `yearplan/*`.
- Связь `projectId` в `yearplan_activities` сейчас не защищена foreign key, поэтому миграции и импорт нужно писать осторожно.
- `DB_PATH` влияет на фактическую базу сильнее, чем относительный путь в репозитории.

## Где проверять модель при сомнениях

- `apps/api/migrations/*.sql`
- `apps/api/src/services/tasks.js`
- `apps/api/src/services/workdays.js`
- `apps/api/src/services/projects.js`
- `apps/api/src/services/yearplan.js`
- `apps/web/src/tasks-data.js`
- `apps/web/src/storage.js`
- `apps/web/src/workday.js`
