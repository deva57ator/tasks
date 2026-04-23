# Архитектура фронтенда

## Зачем этот документ

Фронтенд проекта уже разбит на модули, но его mental model всё ещё легко потерять: часть состояния живёт в `main.js`, часть в feature-модулях, а связи между ними часто проходят через callback-реестры. Этот документ описывает текущую рабочую архитектуру, а не идеализированную схему.

## Ключевая идея

Фронтенд — это SPA без сборщика:

- нативные ES modules;
- один `index.html`;
- один `main.js` как композиционный слой;
- один `style.css`;
- данные могут жить либо в `localStorage`, либо на сервере.

`main.js` не является только bootstrap-файлом. Он выполняет три роли одновременно:

1. связывает feature-модули;
2. хранит часть runtime state;
3. содержит orchestration для загрузки данных, рендера и переключения режимов.

## Слои фронтенда

### 1. Config и shared helpers

- `src/config.js` — константы окружения, лимиты, интервалы, API routing, year plan constants.
- `src/utils.js` — общие утилиты для DOM, времени, дерева задач и форматирования.

Это самый нижний слой. Он не должен зависеть от feature-модуля.

### 2. Storage и режим хранения

- `src/storage.js`

Этот модуль отвечает за:

- `storageMode` (`local` или `server`);
- сохранение задач, проектов, архива и рабочего дня;
- API key storage;
- настройки темы, палитры, шрифта;
- кэш активных таймеров.

Главный архитектурный смысл `storage.js`: скрыть от остального UI, куда именно сейчас пишутся данные.

### 3. API и серверная синхронизация

- `src/api.js`

Отвечает за:

- HTTP-клиент и ошибки API;
- блокировку UI при невалидном API-ключе;
- очереди на создание, обновление и удаление задач;
- синхронизацию проектов, архива и рабочего дня;
- экран/диалог настроек API.

Этот модуль знает про сервер, но старается не знать детали UI напрямую. Для этого использует `registerApiCallbacks(...)`.

### 4. Domain state и доменная логика

- `src/tasks-data.js`
- `src/projects.js`
- `src/workday.js`
- `src/archive.js`
- `src/sprint.js`
- `src/yearplan/data.js`
- `src/yearplan/normalize.js`

Эти модули содержат основное поведение предметной области:

- нормализация и миграция дерева задач;
- CRUD-потоки задач и проектов;
- таймеры;
- логика рабочего дня;
- кэш и состояние year plan;
- фильтрация для sprint view.

### 5. UI/render и interaction modules

- `src/tasks-render.js`
- `src/due-picker.js`
- `src/time-dialog.js`
- `src/calendar.js`
- `src/sidebar.js`
- `src/keyboard.js`
- `src/effects.js`
- `src/yearplan/render.js`
- `src/yearplan/interactions.js`

Они управляют DOM, диалогами, контекстными меню, клавиатурой, анимациями и drag/resize-сценариями.

## Где живёт состояние

Во фронтенде нет одного глобального state container. Состояние распределено.

### В `main.js`

Там живут orchestration-state и view-state:

- выбранная задача;
- активный view;
- выбранный проект;
- состояние некоторых UI-панелей;
- функции загрузки и общего `render()`.

### В feature-модулях

- `tasks-data.js` хранит `tasks`, состояние таймеров и операции над деревом.
- `projects.js` хранит `projects`.
- `workday.js` хранит `workdayState`.
- `yearplan/data.js` хранит year plan state, cache и selection/hover metadata.

### В `localStorage`

- текущий режим хранения;
- API-ключ по окружению;
- локальные данные в `local` режиме;
- рабочий день и активные таймеры как кэш;
- тема, палитра, шрифт.

Итог: чтобы понять реальное поведение, почти всегда нужно смотреть не один файл, а связку `main.js` + feature module + storage/api.

## Почему есть `register*Callbacks`

Во фронтенде много связанных фич: задачи зависят от проектов, рабочий день зависит от задач, API зависит от способа reload, рендер зависит от текущего view. Если соединить это прямыми импортами, быстро появятся циклы.

Поэтому многие модули экспортируют callback-реестры:

- `registerStorageCallbacks(...)`
- `registerApiCallbacks(...)`
- `registerTasksDataCallbacks(...)`
- `registerWorkdayCallbacks(...)`
- `registerProjectsCallbacks(...)`
- `registerYearPlanDataCallbacks(...)`
- `registerYearPlanInteractionsCallbacks(...)`
- `registerYearPlanRenderCallbacks(...)`

Практическое правило: если в модуле есть скрытая зависимость на поведение другого слоя, сначала ищите не `import`, а регистрацию в `main.js`.

## Поток данных в `local` режиме

```text
UI action
  -> feature module updates runtime state
  -> storage.js writes to localStorage
  -> main.js / render modules redraw UI
```

Особенности:

- `Store.write`, `ProjectsStore.write`, `ArchiveStore.write` пишут прямо в браузерное хранилище;
- API не участвует;
- приложение может работать полностью офлайн.

## Поток данных в `server` режиме

```text
UI action
  -> feature module updates runtime state
  -> storage.js delegates write via callbacks
  -> api.js queues or sends HTTP request
  -> server persists data in SQLite
  -> on error frontend may refresh from server
```

Особенности:

- UI всё равно сначала меняет локальный runtime state;
- серверный режим здесь оптимистичный по ощущениям;
- `api.js` использует очереди, debounce и отдельную синхронизацию для `workday`.

## Инициализация приложения

Упрощённая последовательность старта:

1. `main.js` импортирует все модули.
2. Из `ProjectsStore` и `Store` поднимаются локальные данные.
3. Выполняются нормализация и миграция runtime state.
4. Регистрируются callback-реестры между модулями.
5. Если включён `server` режим, идут запросы:
   - `/tasks`
   - `/projects`
   - `/workday/current`
6. После загрузки вызываются:
   - нормализация задач и проектов,
   - восстановление активных таймеров,
   - `renderProjects()`,
   - общий `render()`,
   - обновление UI рабочего дня.

## Архитектура задач

`src/tasks-data.js` — главный доменный модуль задач.

Он отвечает за:

- структуру дерева задач;
- миграцию старых данных;
- поддержание `parentId`;
- таймеры и восстановление активных таймеров;
- CRUD-операции;
- интеграцию с рабочим днём;
- постановку серверных операций в очередь через `api.js`.

Что важно помнить:

- фронтендовая модель задач — древовидная;
- сервер тоже хранит `parentId`, но на клиенте дерево строится и поддерживается отдельно;
- вложенность ограничена константой `MAX_TASK_DEPTH`.

## Архитектура рабочего дня

`src/workday.js` отвечает за пользовательскую и доменную логику рабочего дня:

- текущее состояние дня;
- payload для серверной синхронизации;
- UI состояния диалога;
- расчёт финальных метрик;
- открытие, закрытие и переоткрытие рабочего дня.

Рабочий день связан с задачами в двух направлениях:

- изменение задач обновляет агрегаты рабочего дня;
- состояние рабочего дня влияет на часть UI и серверную синхронизацию.

Это одна из самых связанных областей фронтенда.

## Архитектура year plan

Year plan разделён на три подслоя:

- `src/yearplan/normalize.js` — чистые функции;
- `src/yearplan/data.js` — state, cache, CRUD и provider;
- `src/yearplan/render.js` и `src/yearplan/interactions.js` — DOM и пользовательские действия.

Это одна из наиболее аккуратно изолированных фич проекта.

## Что обычно нужно читать агенту для задачи

### Если меняется поведение задач

Смотрите:

- `apps/web/main.js`
- `apps/web/src/tasks-data.js`
- `apps/web/src/tasks-render.js`
- `apps/web/src/api.js`
- `apps/web/src/storage.js`

### Если меняется рабочий день

Смотрите:

- `apps/web/src/workday.js`
- `apps/web/src/tasks-data.js`
- `apps/web/src/api.js`
- `apps/api/src/routes/workday.js`
- `apps/api/src/services/workdays.js`

### Если меняется year plan

Смотрите:

- `apps/web/src/yearplan/data.js`
- `apps/web/src/yearplan/render.js`
- `apps/web/src/yearplan/interactions.js`
- `apps/api/src/services/yearplan.js`

## Инварианты, которые легко случайно сломать

- Переключение `local`/`server` режима не должно терять UI-управляемое состояние без явной причины.
- `main.js` остаётся центральным местом регистрации callback-зависимостей.
- Изменение задачи должно сохранять корректные `parentId` и не нарушать глубину вложенности.
- Таймеры должны переживать reload через `ActiveTimersStore`.
- Серверный режим должен оставаться работоспособным без сборщика и без env-injection на фронтенде.
- Выбор API-окружения по URL нельзя ломать, иначе STG и PROD перепутаются.

## Когда документ уже устарел

Обновите этот файл, если изменилось хотя бы одно из следующих утверждений:

- `main.js` перестал быть основным orchestration-слоем;
- callback-реестры заменены другим способом связывания модулей;
- появился сборщик, фреймворк или единый state manager;
- `local` и `server` режимы стали работать по другой модели;
- year plan или workday были существенно переработаны.
