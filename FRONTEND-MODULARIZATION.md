# Модуляризация фронтенда

## Контекст

`apps/web/main.js` — 3551 строка ванильного JS в единой глобальной области видимости.
Весь фронт: хранилища, API-клиент, стейт, рендер, обработчики событий — в одном файле.

Цель: разбить на отдельные ES-модули без введения сборщика. Деплой остаётся прежним — статика через rsync.

---

## Принципы

- **Нативные ES Modules** (`import`/`export`). Работают в браузере без сборки.
- **Явные зависимости**. Каждый модуль импортирует только то, что ему нужно.
- **Постепенная миграция**. Проект остаётся рабочим после каждого шага.
- **Никакого нового инструментария**. Браузер, nginx, rsync — всё остаётся как есть.

---

## Целевая структура

```
apps/web/
├── index.html
├── style.css
├── main.js              ← точка входа, только инициализация (~100 строк)
└── src/
    ├── config.js        ← константы окружения, API-пути
    ├── utils.js         ← DOM-хелперы, uid(), date-утилиты, tree-утилиты
    ├── storage.js       ← все Store-объекты (tasks, projects, workday, archive, timers, theme)
    ├── api.js           ← fetch-обёртка, очереди синхронизации, auth-состояние
    ├── state.js         ← глобальный реактивный стейт (задачи, проекты, вид, таймеры)
    ├── workday.js       ← логика рабочего дня: открытие, закрытие, нормализация, UI-обновления
    ├── projects.js      ← CRUD проектов, emoji picker, сабменю назначения
    ├── tasks-data.js    ← CRUD задач, иерархия, тайм-трекинг, нормализация, миграция
    ├── tasks-render.js  ← рендер строк задач, инлайн-редактирование, контекстное меню
    ├── archive.js       ← рендер архива, нормализация архивных нод
    ├── sprint.js        ← buildSprintData, рендер спринт-сетки, фильтры
    ├── due-picker.js    ← виджет выбора даты: buildDuePicker, open/close
    ├── yearplan/
    │   ├── normalize.js    ← нормализация, форматирование, цвета, даты
    │   ├── data.js         ← yearPlanProvider, кэш, стейт, CRUD, форма
    │   ├── interactions.js ← контекстное меню, цвета, drag/resize-обработчики
    │   └── render.js       ← renderActivity, renderCalendarGrid, draft/move preview
    ├── keyboard.js      ← глобальные горячие клавиши
    └── sidebar.js       ← resize-обработчик сайдбара
```

### Граф зависимостей (упрощённый)

```
config.js
    └── utils.js
        └── storage.js
            └── api.js
                └── state.js
                    ├── workday.js
                    ├── projects.js
                    ├── tasks.js ──────┬── archive.js
                    │                  ├── sprint.js
                    │                  └── due-picker.js
                    └── yearplan/
                        ├── config.js
                        ├── normalize.js
                        ├── data.js
                        ├── state.js
                        ├── interactions.js
                        └── render.js
```

---

## Фазы миграции

Каждая фаза — отдельный PR. Проект рабочий после каждого PR.

---

### ✅ Фаза 0: Подготовка

**Сделано:**
- `index.html`: `<script src="main.js?v=2025-11-04" defer>` → `<script type="module" src="main.js?v=2026-04-03">`
- `type="module"` автоматически включает `defer` — дублирование убрано
- Приложение проверено в браузере — работает

---

### ✅ Фаза 1: Утилиты и конфиги

**Создано:** `src/config.js` (53 строки), `src/utils.js` (78 строк)

**`src/config.js` содержит:**
- `STORAGE_MODES`, `API_PREFIX`, `API_BASE`, `api()`, `API_ENV_LABEL`
- `MIN_TASK_MINUTES`, `MAX_TASK_MINUTES`, `MAX_TASK_TIME_MS`, `TIME_PRESETS`
- `WORKDAY_REFRESH_INTERVAL`, `TIME_UPDATE_INTERVAL`, `MAX_TASK_DEPTH`, `MONTH_NAMES`
- `DEFAULT_PROJECT_EMOJI`, `SPRINT_UNASSIGNED_KEY`
- Все `YEAR_PLAN_*` константы и `YEAR_PLAN_COLORS`

**`src/utils.js` содержит:**
- `$()`, `$$()`, `uid()`, `escapeAttributeValue()`, `getTaskRowById()`
- `NON_TEXT_INPUT_TYPES`, `isEditableShortcutTarget()`
- `isDueToday()`, `isDuePast()`, `filterTree()`, `isoWeekInfo()`

> `isoWeekStartDate()` оставлена в `main.js` — зависит от `normalizeDate()`, которая глубоко встроена в логику календаря.

**В `main.js`:** добавлены 2 строки `import` вверху, удалены оригинальные определения. Проверено — работает.

---

### ✅ Фаза 2: Хранилища

**Создано:** `src/storage.js` (225 строк)

**Содержит:** `StorageModeStore`, `ApiKeyStore`, `Store`, `ThemeStore`, `ProjectsStore`, `WorkdayStore`, `persistLocalWorkdayState()`, `normalizeWorkdayState()`, `ArchiveStore`, `ActiveTimersStore`, `storageMode`, `isServerMode()`

**Решение циклической зависимости storage ↔ api:** реестр коллбэков `registerStorageCallbacks()`. `storage.js` вызывает `_cb.onServerTaskWrite?.()` и т.д. — не зная про `api.js` напрямую. Коллбэки регистрируются из `main.js` после определения всех `handleServer*` функций.

**`storageMode`:** экспортируется как live binding (`export let`). Единственная запись заменена на `setStorageMode()` в `setStorageModeAndReload`. Проверено на STG — серверный режим работает.

---

### ✅ Фаза 3: API-клиент

**Создано:** `src/api.js` (~430 строк)

**`src/api.js` содержит:**
- `apiRequest()`, `handleApiError()`, `runServerAction()` — базовый fetch, обработка ошибок
- `mapTaskForServer()`, `normalizeTaskPatch()`, `normalizeProjectPayload()` — нормализация данных
- `pendingTaskUpdates` (Map), `queueTaskCreate/Update/Delete()`, `flushPendingTaskUpdates()` — очередь задач
- `queueProjectCreate/Update/Delete()`, `queueArchiveDelete()` — очереди проектов и архива
- `stringifyWorkdayPayload()`, `scheduleWorkdaySync()`, `flushPendingWorkdaySync()`, `handleServerWorkdayWrite()` — синхронизация рабочего дня
- `apiAuthLocked`, `apiAuthMessage`, `apiAuthReason`, `lockApiAuth()`, `resetApiAuthLock()` — auth-состояние
- `ApiSettingsUI`, `apiSettingsBlocking`, `openApiSettings()`, `closeApiSettings()`, `saveApiKey()`, `clearApiKey()`, `switchToLocalMode()`, `toggleApiKeyVisibility()` — UI настроек API

**В `src/utils.js` добавлено:** `clampTimeSpentMs()` — нужна и api.js, и main.js

**Коллбэки из main.js** (через `registerApiCallbacks()`): `toast`, `buildWorkdayPayload`, `refreshData`, `setStorageModeAndReload`

**Что осталось в `main.js`:** `handleServerTaskWrite`, `handleServerProjectsWrite`, `handleServerArchiveWrite` (мутируют стейт), `buildWorkdayPayloadForServer` (зависит от `computeAggregatedWorkdayStats`), `refreshDataForCurrentMode`, `loadDataFromServer`, `loadDataFromLocal`, `setStorageModeAndReload`

**Зависит от:** `config.js`, `storage.js`, `utils.js`

---

### ✅ Фаза 4: Сайдбар (1 PR)

**Извлекаем:** `sidebar.js`

Код уже обёрнут в IIFE — почти готовый модуль. Убрать IIFE, добавить `export` если нужно, подключить через `import` в `main.js`.

Это самая простая фаза, хорошо подходит для проверки процесса.

---

### ~~Фаза 5: Глобальный стейт~~ — отменена

Глобальные переменные (`currentView`, `selectedTaskId`, `tasks` и т.д.) остаются в `main.js`. Вынос потребовал бы `export let` + сеттеры во всех модулях — излишняя сложность без реальной пользы.

---

### ✅ Фаза 6a: Year Plan — данные и стейт

**Создано:** `src/yearplan/normalize.js` (~250 строк), `src/yearplan/data.js` (~350 строк)

- `normalize.js` — чистые функции нормализации, форматирования, цветов, дат, позиционирования
- `data.js` — состояние (`yearPlan*` переменные + сеттеры), `yearPlanProvider`, кэш, CRUD, форма
- Callback-реестр `registerYearPlanDataCallbacks` для избегания циклических зависимостей
- `getDaysInMonth` перенесена в `utils.js`

---

### ✅ Фаза 6b: Year Plan — взаимодействия

**Извлекаем:** `src/yearplan/interactions.js` (~250 строк)

- Контекстное меню (`openYearPlanContextMenu`, `closeYearPlanContextMenu`)
- Выбор цвета (`renderYearPlanColorSubmenu`)
- `bindYearPlanActivityHover`, `bindYearPlanActivitySelect`, `bindYearPlanActivityContext`
- Обработчики drag/resize/rename на уровне элементов активности

---

### ✅ Фаза 6c: Year Plan — рендер

**Извлекаем:** `src/yearplan/render.js` (~350 строк)

- `renderYearPlanActivities` — рендер всех активностей в месяцах
- `renderYearPlanMovePreview` — превью перетаскивания
- `renderYearPlanDraft` — превью создаваемой активности
- `renderYearPlan` — сборка всего year plan view
- `getYearPlanSegmentsForMonth`, `getYearPlanSlicesForRange` — вспомогательные

---

### ✅ Фаза 7a: Рабочий день

**Извлекаем:** `src/workday.js` (~200 строк)

- `computeAggregatedWorkdayStats`, `updateWorkdayUI`, `updateWorkdayDialogContent`
- `openWorkdayDialog`, `closeWorkdayDialog`
- `buildWorkdayPayloadForServer`, `createWorkdaySnapshot`
- `getWorkdayInfo`, `workdayDateKey`

---

### ✅ Фаза 7b: Проекты

**Извлекаем:** `src/projects.js` (~200 строк)

- `normalizeProjectsList`, `renderProjects`
- `getProjectMeta`, `getProjectEmoji`, `getProjectTitle`
- CRUD: `deleteProject`, `finalizeProjectDelete`, `removeProjectById`, `startProjectRename`
- Emoji picker: `ensureEmojiPicker`, `openEmojiPicker`, `closeEmojiPicker`, `setProjectEmoji`
- Контекстное меню проекта: `openProjMenu`, `closeProjMenu`

---

### ✅ Фаза 7c: Архив

**Извлекаем:** `src/archive.js` (~150 строк)

- `normalizeArchivedNode`, `normalizeArchiveList`
- `renderArchivedNode`, `renderArchive`
- `removeArchivedTask`

---

### ✅ Фаза 7d: Данные задач

**Извлекаем:** `src/tasks-data.js` (~250–300 строк)

- Нормализация и миграция: `normalizeTask`, `migrate`
- Дерево: `findTask`, `buildTaskTree`, `walkTasks`, `filterTree`
- CRUD: создание, обновление, удаление задачи, `handleServerTaskWrite`
- Таймеры: `ensureActiveTimersState`, `setActiveTimerState`, `startTimer`, `stopTimer`, `totalTimeMs`, `syncTimerLoop`

---

### ✅ Фаза 7e: Рендер задач

**Извлекаем:** `src/tasks-render.js` (~250–300 строк)

- `renderTaskRow` — рендер одной строки задачи (~90 строк)
- `startEdit`, `commitTaskInput`, `cancelTaskInput` — инлайн-редактирование
- Контекстное меню задачи: `openContextMenu`, `closeContextMenu`
- Notes panel: `openNotesPanel`, `closeNotesPanel`
- Сабменю назначения проекта: `openAssignSubmenu`, `closeAssignSubmenu`, `openProjectAssignSubmenu`

---

### ✅ Фаза 7f: Sprint и due-picker

**Извлекаем:** `src/sprint.js`, `src/due-picker.js` (~300 строк суммарно)

- `sprint.js` — `buildSprintData`, `renderSprint`, `renderSprintFiltersBar`, фильтры по проектам
- `due-picker.js` — `buildDuePicker`, `openDuePicker`, `closeDuePicker`, `ensureDuePickerWidth`

---

### Фаза 7g: Клавиатура

**Извлекаем:** `src/keyboard.js` (~100 строк)

- Глобальный `keydown`-обработчик
- Все горячие клавиши (навигация, быстрые действия, модальные окна)

---

### Фаза 8: Финал (1 PR)

- `main.js` становится точкой входа: импортирует все модули, инициализирует приложение (~100 строк)
- Проверить что все `import` разрешаются корректно
- Проверить браузерный кэш — убедиться, что отдельные модули кэшируются по-отдельности

---

## Техника безопасности при миграции

### Циклические зависимости — главный риск

Браузер их не разрешает. Основные опасные места:

- `tasks.js` ↔ `projects.js` (задача знает проект, проект знает задачи)
- `yearplan/state.js` ↔ `yearplan/interactions.js` (стейт обновляется из обработчиков, обработчики читают стейт)
- `api.js` ↔ `storage.js` (стор вызывает API, API читает из стора)

**Решение:** Для циклических зависимостей — выделить третий модуль с общими типами/интерфейсом, который импортируют оба. Либо передавать зависимости через параметры функций, а не через импорты.

### Как проверять каждый шаг

После каждого PR вручную проверять:
- [ ] Создать задачу, сделать подзадачу
- [ ] Запустить таймер, остановить
- [ ] Открыть/закрыть рабочий день
- [ ] Переключиться между вьюхами (all, sprint, yearplan)
- [ ] Переключить тему
- [ ] Переключиться между local/server режимами

### Один модуль за раз

Не переносить несколько модулей в одном PR. Если что-то сломалось — сразу видно где.

---

## Что не меняется

- Деплой через rsync — `apps/web/` по-прежнему набор статичных файлов
- Nginx — без изменений
- `index.html` — только добавить `type="module"` к `<script>` в фазе 0
- `style.css` — не трогаем

---

## Ожидаемый результат

| Сейчас | После |
|---|---|
| 1 файл, 3551 строка | ~16 файлов, ~100–300 строк каждый |
| Глобальная область видимости | Явные импорты/экспорты |
| Найти код — скроллить | Открыть нужный файл |
| Любое изменение — весь файл в диффе | PR трогает только нужные модули |
| Сборщик не нужен | Сборщик не нужен |
