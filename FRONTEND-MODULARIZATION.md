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
    ├── projects.js      ← CRUD проектов, назначение на задачи, сабменю
    ├── tasks.js         ← CRUD задач, иерархия, тайм-трекинг, рендер строк
    ├── archive.js       ← рендер архива, нормализация архивных нод
    ├── sprint.js        ← buildSprintData, рендер спринт-сетки, drag-drop по дням
    ├── due-picker.js    ← виджет выбора даты: buildDuePicker, open/close
    ├── yearplan/
    │   ├── config.js    ← константы year plan (цвета, ключи, размеры)
    │   ├── normalize.js ← нормализация элементов и списков year plan
    │   ├── data.js      ← yearPlanProvider, кэш, чтение/запись (local + server)
    │   ├── state.js     ← selection, hover, resize, move, draft, editing состояния
    │   ├── interactions.js ← контекстное меню, сабменю проектов, drag/resize-обработчики
    │   └── render.js    ← renderActivity, renderCalendarGrid, draft/move preview
    ├── keyboard.js      ← глобальные горячие клавиши
    └── sidebar.js       ← resize-обработчик сайдбара (уже почти изолирован)
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

### Фаза 3: API-клиент (1 PR)

**Извлекаем:** `api.js`

**Что идёт в `api.js`:**
- `apiRequest()` — базовый fetch с заголовком авторизации
- `handleServerTaskWrite()`, `handleServerWorkdayWrite()`, `handleServerArchiveWrite()`, `handleServerProjectsWrite()`
- Очереди: `queueTaskUpdate()`, `queueProjectCreate()`, `queueProjectDelete()`, `queueArchiveDelete()`
- `apiAuthLocked`, `apiAuthMessage`, `apiAuthReason`
- Логика API-настроек: `ApiSettingsUI`, открытие/закрытие диалога, форма

**Зависит от:** `config.js`, `storage.js`

---

### Фаза 4: Сайдбар (1 PR)

**Извлекаем:** `sidebar.js`

Код уже обёрнут в IIFE — почти готовый модуль. Убрать IIFE, добавить `export` если нужно, подключить через `import` в `main.js`.

Это самая простая фаза, хорошо подходит для проверки процесса.

---

### Фаза 5: Глобальный стейт (1 PR)

**Извлекаем:** `state.js`

**Что идёт в `state.js`:**
- `tasks`, `archivedTasks`, `selectedTaskId`, `pendingEditId`
- `currentView`, `currentProjectId`
- `projects`, `activeTimersState`
- `workdayState`
- `pendingTimeUpdates`
- `sprintVisibleProjects`
- Функции-мутаторы стейта (если есть)

**Зависит от:** `storage.js`

**Важно:** Это самый связанный модуль — на него будут ссылаться почти все остальные. Сделать его раньше задач/проектов/рендеров.

---

### Фаза 6: Year Plan (2 PR)

Самая большая и сложная часть. Разбивается на два PR:

**PR 6a: Данные и стейт**
- `yearplan/config.js` — все YEAR_PLAN_* константы
- `yearplan/normalize.js` — `normalizeYearPlanItem()`, `normalizeYearPlanList()`, вспомогательные нормализаторы
- `yearplan/data.js` — `yearPlanProvider`, кэш (`yearPlanCache`, `yearPlanLoadingYears`, `yearPlanErrors`), `ensureYearPlanData()`
- `yearplan/state.js` — все `yearPlanEditing*`, `yearPlanResize*`, `yearPlanMove*`, `yearPlanDraft*` переменные и функции-мутаторы

**PR 6b: Рендер и взаимодействия**
- `yearplan/render.js` — `renderActivity()`, `renderCalendarGrid()`, preview-рендеры
- `yearplan/interactions.js` — контекстное меню, цвета, переименование, drag/resize-обработчики, обработка событий мыши

---

### Фаза 7: Прикладные модули (2–3 PR)

Параллельно или последовательно:

**PR 7a:**
- `workday.js` — `normalizeWorkdayState()` переносится сюда, UI-обновления workday bar, диалог закрытия дня
- `projects.js` — `normalizeProjectsList()`, CRUD, сабменю назначения, `removeProjectById()`

**PR 7b:**
- `tasks.js` — рендер строк задач, CRUD задач, тайм-трекинг
- `archive.js` — `renderArchivedNode()`, `renderArchive()`, `normalizeArchivedNode()`

**PR 7c:**
- `sprint.js` — `buildSprintData()`, рендер, drag-drop
- `due-picker.js` — `buildDuePicker()`, `openDuePicker()`, `closeDuePicker()`
- `keyboard.js` — все глобальные `keydown`-обработчики

---

### Фаза 8: Финал (1 PR)

- Удалить `main.legacy.js`
- `main.js` становится точкой входа: импортирует все модули, инициализирует приложение
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
| 1 файл, 3551 строка | ~14 файлов, ~100–300 строк каждый |
| Глобальная область видимости | Явные импорты/экспорты |
| Найти код — скроллить | Открыть нужный файл |
| Любое изменение — весь файл в диффе | PR трогает только нужные модули |
| Сборщик не нужен | Сборщик не нужен |
