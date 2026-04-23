# API Contract

## Зачем этот документ

Этот файл фиксирует практический HTTP-контракт API: какие endpoints реально существуют, какие поля ожидаются во входе и какие shapes приходят в ответах. Документ намеренно покрывает не все детали предметной логики, а те формы данных, которые чаще всего нужны агенту при изменении backend или frontend.

## Общие правила

- Все endpoints, кроме health-check, требуют заголовок `X-API-Key`.
- Базовый префикс API зависит от окружения фронтенда:
  - STG: `/tasks-stg/api`
  - PROD: `/tasks/api`
- Успешное удаление обычно возвращает `204 No Content`.
- Ошибки нормализуются в shape:

```json
{
  "error": {
    "code": "validation_error",
    "message": "title is required"
  }
}
```

## Health

### `GET /api/health`

Ответ:

```json
{
  "status": "ok",
  "version": "0.1.0",
  "schemaVersion": 5,
  "backlogOpenDays": 0
}
```

Назначение:

- внешний и внутренний health-check;
- быстрая проверка версии и применённой схемы.

## Tasks

### Shape задачи в API

```json
{
  "id": "task-id",
  "title": "Task title",
  "done": false,
  "due": "2026-04-23T00:00:00.000Z",
  "project": "project-id",
  "notes": "",
  "timeSpent": 0,
  "parentId": null,
  "createdAt": "2026-04-23T10:00:00.000Z",
  "updatedAt": "2026-04-23T10:00:00.000Z",
  "completedAt": null,
  "children": []
}
```

Замечания:

- `children` присутствует в API-ответе, хотя в SQLite не хранится как колонка;
- `project` в API соответствует `projectId` в базе;
- `timeSpent` в API соответствует `timeSpentMs` в базе;
- `collapsed`, `timerActive` и `timerStart` в backend API не являются persist-истиной и не должны ожидаться как контрактный ответ.

### `GET /api/tasks`

Query params:

- `projectId`
- `done`
- `dueFrom`
- `dueTo`
- `limit`
- `offset`

Ответ:

```json
{
  "items": [
    {
      "id": "task-id",
      "title": "Task title",
      "done": false,
      "due": null,
      "project": null,
      "notes": "",
      "timeSpent": 0,
      "parentId": null,
      "createdAt": "2026-04-23T10:00:00.000Z",
      "updatedAt": "2026-04-23T10:00:00.000Z",
      "completedAt": null,
      "children": []
    }
  ],
  "total": 1
}
```

### `POST /api/tasks`

Минимальный request body:

```json
{
  "title": "New task"
}
```

Расширенный request body:

```json
{
  "id": "task-id",
  "title": "New task",
  "done": false,
  "due": null,
  "project": "project-id",
  "notes": "",
  "timeSpent": 0,
  "parentId": null
}
```

Ответ:

- `201 Created`
- body: одна созданная задача в task shape

### `PUT /api/tasks/:id`

Request body:

- частичный patch задачи;
- допустимы поля `title`, `done`, `due`, `project`, `notes`, `timeSpent`, `parentId`, `completedAt`.

Ответ:

- `200 OK` + обновлённая задача
- `404` если задача не найдена

### `DELETE /api/tasks/:id`

Ответ:

- `204 No Content`

## Projects

### Shape проекта в API

```json
{
  "id": "project-id",
  "title": "Project title",
  "emoji": "📁",
  "timeSpent": 0,
  "createdAt": "2026-04-23T10:00:00.000Z",
  "updatedAt": "2026-04-23T10:00:00.000Z"
}
```

### `GET /api/projects`

Query params:

- `limit`
- `offset`

Ответ:

```json
{
  "items": [
    {
      "id": "project-id",
      "title": "Project title",
      "emoji": "📁",
      "timeSpent": 0,
      "createdAt": "2026-04-23T10:00:00.000Z",
      "updatedAt": "2026-04-23T10:00:00.000Z"
    }
  ],
  "total": 1
}
```

### `POST /api/projects`

Минимальный request body:

```json
{
  "title": "Project title"
}
```

Расширенный request body:

```json
{
  "id": "project-id",
  "title": "Project title",
  "emoji": "📁"
}
```

Ответ:

- `201 Created`
- body: один созданный проект

### `PUT /api/projects/:id`

Request body:

```json
{
  "title": "Renamed project",
  "emoji": "💼"
}
```

Ответ:

- `200 OK` + обновлённый проект
- `404` если проект не найден

### `DELETE /api/projects/:id`

Ответ:

- `204 No Content`

## Workday

### Shape workday record в API

```json
{
  "id": "2026-04-23",
  "startTs": 1745377200000,
  "endTs": 1745456400000,
  "summaryTimeMs": 120000,
  "summaryDone": 1,
  "payload": {
    "id": "2026-04-23",
    "start": 1745377200000,
    "end": 1745456400000,
    "baseline": {},
    "completed": {},
    "locked": false,
    "closedAt": null,
    "closedManually": false,
    "manualClosedStats": {
      "timeMs": 0,
      "doneCount": 0
    },
    "finalTimeMs": 0,
    "finalDoneCount": 0,
    "reopenedAt": null
  },
  "closedAt": null,
  "createdAt": "2026-04-23T10:00:00.000Z",
  "updatedAt": "2026-04-23T10:05:00.000Z"
}
```

### `GET /api/workday/current`

Ответ:

```json
{
  "workday": {
    "id": "2026-04-23",
    "startTs": 1745377200000,
    "endTs": 1745456400000,
    "summaryTimeMs": 120000,
    "summaryDone": 1,
    "payload": {},
    "closedAt": null,
    "createdAt": "2026-04-23T10:00:00.000Z",
    "updatedAt": "2026-04-23T10:05:00.000Z"
  }
}
```

Дополнительно:

- endpoint выставляет `ETag`;
- может вернуть `{"workday": null}`, если активного/доступного дня нет.

### `POST /api/workday/sync`

Request body:

```json
{
  "workday": {
    "id": "2026-04-23",
    "startTs": 1745377200000,
    "endTs": 1745456400000,
    "summaryTimeMs": 120000,
    "summaryDone": 1,
    "payload": {},
    "closedAt": null
  }
}
```

Ответ:

```json
{
  "workday": {
    "id": "2026-04-23",
    "startTs": 1745377200000,
    "endTs": 1745456400000,
    "summaryTimeMs": 120000,
    "summaryDone": 1,
    "payload": {},
    "closedAt": null,
    "createdAt": "2026-04-23T10:00:00.000Z",
    "updatedAt": "2026-04-23T10:05:00.000Z"
  }
}
```

### `POST /api/workday/close`

Request body:

- тот же shape, что и у `/sync`, но с `workday.id` обязательно;
- `closedAt` может быть передан клиентом, иначе сервер возьмёт `Date.now()`.

Ответ:

- `200 OK`
- body: `{ "workday": <closed record> }`

### `POST /api/workday/reopen`

Request body:

- тот же shape, что и у `/sync`, но с `workday.id` обязательно.

Ответ:

- `200 OK` + reopened record
- `404` если день не найден

## Archive

### `GET /api/archive`

Query params:

- `limit`
- `offset`

Ответ:

```json
{
  "items": [
    {
      "id": "archive-id",
      "payload": {},
      "archivedAt": "2026-04-23T10:00:00.000Z",
      "createdAt": "2026-04-23T10:00:00.000Z",
      "updatedAt": "2026-04-23T10:00:00.000Z"
    }
  ],
  "total": 1
}
```

### `DELETE /api/archive/:id`

Ответ:

- `204 No Content`

## Stats

### `GET /api/stats/summary`

Ответ:

```json
{
  "activeTasks": 12,
  "activeCompleted": 3,
  "activeTimeSpentMs": 5400000,
  "archivedTasks": 40,
  "archivedTimeSpentMs": 12300000
}
```

## Year Plan

### Shape activity в API

```json
{
  "id": 1,
  "year": 2026,
  "startMonth": 4,
  "startDay": 10,
  "endMonth": 4,
  "endDay": 12,
  "title": "активность",
  "color": "#3a82f6",
  "isDone": 0,
  "projectId": "project-id",
  "createdTs": 1745377200000,
  "updatedTs": 1745377200000
}
```

### `GET /api/yearplan?year=2026`

Ответ:

- массив activity objects

### `POST /api/yearplan`

Request body:

```json
{
  "year": 2026,
  "startMonth": 4,
  "startDay": 10,
  "endMonth": 4,
  "endDay": 12,
  "title": "активность",
  "color": "#3a82f6",
  "isDone": 0,
  "projectId": "project-id"
}
```

Ответ:

- `201 Created`
- body: одна activity

### `PATCH /api/yearplan/:id`

Request body:

- частичный patch;
- сервис сам подмешивает defaults из существующей записи.

Ответ:

- `200 OK` + обновлённая activity
- `404` если activity не найдена

### `DELETE /api/yearplan/:id`

Ответ:

- `204 No Content`

## Import

### `POST /api/import`

Поддерживаемые shapes payload:

1. Legacy localStorage dump:

```json
{
  "mini-task-tracker:text:min:v14": [],
  "mini-task-tracker:projects": [],
  "mini-task-tracker:workday": null,
  "mini-task-tracker:archive:v1": []
}
```

2. Прямой shape:

```json
{
  "tasks": [],
  "projects": [],
  "workday": null,
  "archive": []
}
```

Ответ:

```json
{
  "status": "accepted"
}
```

## Что перепроверять при изменениях

- Если меняется task/project/workday shape, обновляйте и этот файл, и frontend mapping.
- Если меняется endpoint path, обновляйте `README.md`, `api-contract.md` и соответствующий architecture doc.
- Если меняется `yearplan` или `workday`, проверяйте одновременно routes, services и frontend consumers.
