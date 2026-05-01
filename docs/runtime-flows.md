# Runtime Flows

## Зачем этот документ

Этот файл описывает не структуру проекта, а его поведение во времени: что происходит по шагам при старте приложения, изменении данных, синхронизации рабочего дня, импорте и деплое. Это самый практический документ для отладки и быстрого онбординга.

## Как читать этот документ

Каждый flow описан в одном формате:

- что запускает сценарий;
- какие слои участвуют;
- как идут данные;
- где чаще всего искать проблему.

## Flow 1. Старт фронтенда в `local` режиме

### Что запускает

- открытие `apps/web/index.html` локально;
- или открытие `/tasks/` в браузере, если в `localStorage` выбран режим `local`.

### Шаги

1. Браузер загружает `index.html`.
2. `main.js` импортирует модули фронтенда.
3. Читается `storageMode` из `StorageModeStore`.
4. Из `Store`, `ProjectsStore`, `WorkdayStore` и других localStorage-адаптеров поднимаются локальные данные.
5. Выполняются:
   - нормализация задач,
   - миграция фронтендового формата,
   - восстановление `parentId`,
   - восстановление активных таймеров.
6. `main.js` регистрирует callback-реестры между модулями.
7. Вызываются `renderProjects()`, общий `render()` и обновление UI рабочего дня.

### Участвующие файлы

- `apps/web/main.js`
- `apps/web/src/storage.js`
- `apps/web/src/tasks-data.js`
- `apps/web/src/projects.js`
- `apps/web/src/workday.js`

### Где искать сбой

- неправильный runtime state после reload: `tasks-data.js`, `storage.js`
- потеря данных: localStorage keys и миграция в `tasks-data.js`
- странное поведение UI после старта: `main.js`

## Flow 2. Старт фронтенда в `server` режиме

### Что запускает

- открытие приложения, когда в `StorageModeStore` уже выбран `server`;
- или переключение из `local` в `server`.

### Шаги

1. Frontend стартует так же, как в `local` режиме.
2. `main.js` определяет, что активен `server` режим.
3. `apps/web/src/config.js` вычисляет API-префикс:
   - `/tasks-stg/api` для STG
   - `/tasks/api` для PROD
4. `api.js` проверяет наличие API-ключа в `ApiKeyStore`.
5. Если ключа нет или он неверный:
   - auth lock активируется,
   - открывается UI настроек API,
   - запросы в API блокируются.
6. Если ключ валиден, `main.js` загружает:
   - `/tasks`
   - `/projects`
   - `/workday/current`
7. Ответы API гидратируются обратно во фронтендовый runtime state.
8. Локальный кэш рабочего дня и активных таймеров обновляется.

### Участвующие файлы

- `apps/web/main.js`
- `apps/web/src/config.js`
- `apps/web/src/api.js`
- `apps/web/src/storage.js`
- `apps/api/src/routes/tasks.js`
- `apps/api/src/routes/projects.js`
- `apps/api/src/routes/workday.js`

### Где искать сбой

- неправильное окружение STG/PROD: `apps/web/src/config.js`
- бесконечная блокировка по auth: `apps/web/src/api.js`
- данные пришли, но UI сломан: `main.js` и соответствующий feature-модуль
- запросы успешны, но сервер отдаёт неожиданный shape: route/service в `apps/api/src`

## Flow 3. Создание или обновление задачи в `local` режиме

### Что запускает

- добавление новой задачи;
- редактирование заголовка, дедлайна, заметки, проекта;
- отметка задачи выполненной;
- удаление задачи.

### Шаги

1. UI действие попадает в `tasks-data.js` или `tasks-render.js`.
2. Изменяется runtime state задач.
3. `Store.write(tasks)` пишет новое состояние в localStorage.
4. Обновляется связанный UI:
   - список задач,
   - индикаторы,
   - состояние рабочего дня,
   - таймеры.

### Участвующие файлы

- `apps/web/src/tasks-data.js`
- `apps/web/src/tasks-render.js`
- `apps/web/src/storage.js`
- `apps/web/src/workday.js`

### Где искать сбой

- дерево задач стало неконсистентным: `tasks-data.js`
- задача исчезает после reload: `Store.write` и миграция данных
- закрытие/открытие задачи не обновляет рабочий день: `workday.js`

## Flow 4. Создание или обновление задачи в `server` режиме

### Что запускает

- то же действие, что и в local flow, но при активном `server` режиме.

### Шаги

1. UI меняет локальный runtime state сразу.
2. `Store.write(tasks)` в `storage.js` не пишет в localStorage как источник истины, а делегирует серверную запись через callback.
3. `api.js` формирует payload:
   - create -> `POST /tasks`
   - update -> `PUT /tasks/:id`
   - delete -> `DELETE /tasks/:id`
4. Для части обновлений используется debounce и `pendingTaskUpdates`.
5. Backend route передаёт управление в `tasks` service.
6. `tasks` service пишет данные в SQLite.
7. При ошибке фронтенд может сделать `refreshData` с сервера и восстановить состояние.

### Участвующие файлы

- `apps/web/src/storage.js`
- `apps/web/src/api.js`
- `apps/web/src/tasks-data.js`
- `apps/api/src/routes/tasks.js`
- `apps/api/src/services/tasks.js`
- `apps/api/src/db/client.js`

### Где искать сбой

- UI обновился, но сервер не сохранил: `apps/web/src/api.js`
- сервер сохранил не те поля: `apps/api/src/services/tasks.js`
- проблема только на части полей, например `parentId` или `timeSpent`: сравнивайте `normalizeTaskPatch` и `tasks.update`

## Flow 5. Переключение между `local` и `server`

### Что запускает

- пользователь меняет режим хранения в настройках.

### Шаги

1. `setStorageModeAndReload(...)` в `main.js` выбирает новый режим.
2. Если есть активные таймеры:
   - они сначала останавливаются,
   - текущее время сохраняется,
   - при переходе в `server` режим ставятся server updates.
3. Сбрасывается часть кэшей, в том числе year plan cache.
4. Сливаются pending updates.
5. Выполняется reload данных:
   - из localStorage для `local`
   - из API для `server`

### Участвующие файлы

- `apps/web/main.js`
- `apps/web/src/storage.js`
- `apps/web/src/api.js`
- `apps/web/src/tasks-data.js`

### Где искать сбой

- потеря времени активного таймера: `finalizeActiveTimersBeforeModeChange`
- stale данные после переключения: reload path в `main.js`
- проблемы только в year plan после switch: `src/yearplan/data.js`

## Flow 6. Синхронизация текущего рабочего дня

### Что запускает

- изменение задач, влияющее на рабочий день;
- явные действия пользователя по завершению/переоткрытию дня;
- периодические циклы фронтенда;
- lifecycle backend.

### Шаги на фронтенде

1. `workday.js` держит `workdayState`.
2. При изменениях задач пересчитываются агрегаты и snapshot-данные.
3. `buildWorkdayPayloadForServer(...)` собирает transport payload.
4. `api.js` ставит синхронизацию в отдельную очередь рабочего дня.
5. Отправляется `POST /workday/sync`.
6. Ответ сервера гидратируется обратно через `hydrateWorkdayStateFromServer(...)`.

### Шаги на backend

1. `routes/workday.js` валидирует наличие `workday.id`.
2. `workdays.upsert(...)` сохраняет состояние.
3. `workdays.getCurrent()` и `getLatestUpdateMarker()` используются для чтения и ETag.
4. `workdayLifecycle` раз в 5 минут вызывает `workdays.getCurrent()`, чтобы удерживать день в актуальном состоянии.

### Участвующие файлы

- `apps/web/src/workday.js`
- `apps/web/src/api.js`
- `apps/api/src/routes/workday.js`
- `apps/api/src/services/workdays.js`
- `apps/api/src/services/workdayLifecycle.js`

### Где искать сбой

- рабочий день расходится между клиентом и сервером: сравнивайте payload на обеих сторонах
- день не открывается/не закрывается по времени: `workdays.getWorkdayWindow`
- после reopen не сбрасываются ограничения редактирования: `apps/web/src/workday.js`

## Flow 7. Автоматическое окно рабочего дня

### Что запускает

- запрос текущего рабочего дня;
- lifecycle backend;
- старт сервера или очередной цикл.

### Шаги

1. Backend переводит текущее время в фиксированную timezone GMT+3.
2. Вычисляется рабочее окно:
   - с `06:00` до `03:00` следующего дня — активный рабочий день
   - между `03:00` и `06:00` — waiting state до следующего старта
3. Если активный день должен существовать, но записи нет, `workdays.ensureActiveWorkday()` создаёт её.
4. Если день уже есть, backend гидратирует и отдаёт существующую запись.

### Участвующие файлы

- `apps/api/src/services/workdays.js`
- `apps/api/src/services/workdayLifecycle.js`

### Где искать сбой

- несоответствие локального времени ожиданиям пользователя: timezone-логика в `workdays.js`
- неожиданный `id` рабочего дня: `formatWorkdayId`

## Flow 8. Импорт JSON-дампа

### Что запускает

- запрос `POST /api/import` с JSON payload.

### Шаги

1. `routes/import.js` передаёт payload в `importer.importData(...)`.
2. Importer умеет читать как:
   - legacy ключи localStorage,
   - так и прямые поля `tasks`, `projects`, `workday`, `archive`.
3. Дерево задач сплющивается в плоский список с `parentId`.
4. Проекты импортируются через `projectsService.importMany(...)`.
5. Задачи импортируются через `tasksService.importMany(...)`.
6. Архив импортируется через `archiveService.importMany(...)`.
7. Текущий рабочий день импортируется через `workdaysService.importCurrent(...)`.

### Участвующие файлы

- `apps/api/src/routes/import.js`
- `apps/api/src/services/importer.js`
- `apps/api/src/services/projects.js`
- `apps/api/src/services/tasks.js`
- `apps/api/src/services/archive.js`
- `apps/api/src/services/workdays.js`

### Где искать сбой

- вложенные задачи потеряли структуру: `normalizeTasks` в importer
- архив импортировался, но статистика странная: `archiveService` и `statsService`
- рабочий день импортировался без ожидаемых итогов: mapping в `importer.importData`

## Flow 9. Вид «График» и отпуска

### Что запускает

- переход в sidebar-кнопку `График`;
- навигация по месяцам в `Графике`;
- добавление/удаление периода отпуска.

### Шаги

1. `main.js` при `currentView === 'graph'` вызывает:
   - `graphFeature.renderVacationComposer()`
   - `graphFeature.renderGraphMonth(...)`.
2. `graph.js` строит матрицу рабочих недель (`Пн–Пт`) для месяца и показывает соседние месяцы как `is-out`.
3. Для каждого дня применяется фильтрация неактивности:
   - выходной (`isWeekendDay`),
   - праздник (`isHolidayDay`),
   - отпуск (`isVacationDate`).
4. Для активных дней `graph.js` агрегирует из `tasks`:
   - `spentMinutes/day` через `totalTimeMs(...)` + anchor date strategy,
   - `doneCount/day` через `completedAt` (с fallback для старых записей).
5. Прогресс карточки дня считается как `min(spentMinutes / targetMinutes, 1)` и рендерится заливкой.
6. Отпуск добавляется через модалку из двух календарей:
   - диапазон сохраняется в `localStorage`,
   - composer и график перерисовываются сразу после add/remove.

### Участвующие файлы

- `apps/web/main.js`
- `apps/web/src/graph.js`
- `apps/web/src/tasks-data.js`
- `apps/web/src/utils.js`

### Где искать сбой

- график не обновляется после действий: `render()` ветка `currentView==='graph'` в `main.js` и `rerenderGraphIfVisible()` в `graph.js`
- неверная неактивность дней: `isOffday` логика в `renderGraphMonth(...)`
- отпуск пропадает после reload: `readVacationRanges()/writeVacationRanges()` и ключ localStorage
- расходятся цифры времени: `buildGraphStatsMap(...)`, `resolveSpentAnchorDate(...)`, `totalTimeMs(...)`

## Flow 9. Деплой на STG

### Что запускает

- push в `main`;
- либо ручной запуск `deploy-stg.yml`.

### Шаги

1. GitHub Actions checkout-ит репозиторий.
2. Настраивается SSH agent и `known_hosts`.
3. API часть rsync-ится во временную папку `${PATH_STG}/_tmp/`.
4. На сервере `apps/api` атомарно перекладывается на место.
5. `apps/web/` rsync-ится в `${WEB_STG}`.
6. На сервере выполняются:
   - `npm ci --omit=dev`
   - `DB_PATH="$DEPLOY_PATH/data/tasks.db" npm run migrate`
   - `systemctl restart tasks-stg`
7. Workflow проверяет:
   - что systemd unit активен;
   - что health-check `https://parkhomenko.space/tasks-stg/api/health` отвечает успешно.

### Участвующие файлы

- `.github/workflows/deploy-stg.yml`
- `infra/rsync/api.filter`
- `infra/systemd/tasks-stg.service`

### Где искать сбой

- backend не поднялся после рестарта: `systemctl status tasks-stg`, `journalctl -u tasks-stg`
- миграция отработала не туда: проверьте `DB_PATH`
- фронт не соответствует API версии: проверьте, что rsync API и WEB завершились корректно

## Flow 10. Промоут в PROD

### Что запускает

- ручной запуск `promote-prod.yml`;
- можно указать конкретный `ref`.

### Шаги

1. GitHub Actions checkout-ит нужный `ref` или `main`.
2. Проверяется SSH connectivity.
3. API rsync-ится в `${PATH_PROD}/_tmp/`, затем перекладывается в `${PATH_PROD}/apps/api`.
4. `apps/web/` rsync-ится в `${WEB_PROD}`.
5. На сервере выполняются:
   - `npm ci --omit=dev`
   - `DB_PATH='${PATH_PROD}/data/tasks.db' npm run migrate`
   - `systemctl restart tasks-prod`
6. Workflow делает внутренний health-check на `http://127.0.0.1:3101/api/health`.
7. Затем делает внешний health-check на `https://parkhomenko.space/tasks/api/health`.

### Участвующие файлы

- `.github/workflows/promote-prod.yml`
- `infra/systemd/tasks-prod.service`
- `infra/nginx/parkhomenko.space.conf`

### Где искать сбой

- внутренний health-check проходит, внешний нет: смотрите nginx и webroot
- внешний проходит, а данные не те: проверьте `DB_PATH` и env-файл production
- промоут конкретного `ref` дал неожиданный результат: перепроверьте `workflow_dispatch` input

## Flow 11. Общая диагностика production/runtime проблем

### Если проблема только во фронтенде

Смотрите:

- `apps/web/main.js`
- соответствующий feature-модуль
- localStorage и режим хранения
- запросы в Network tab

### Если проблема только в API

Смотрите:

- `apps/api/src/routes/*`
- `apps/api/src/services/*`
- `apps/api/src/db/client.js`
- systemd/journalctl

### Если проблема на границе frontend <-> backend

Смотрите сразу обе стороны:

- `apps/web/src/api.js`
- `apps/web/src/workday.js` или другой feature-модуль
- соответствующий route
- соответствующий service

### Если проблема появилась после деплоя

Проверьте по порядку:

1. Какой workflow запускался.
2. На какой `ref` он отработал.
3. Какой `DB_PATH` использовался при миграции.
4. Поднялся ли нужный systemd unit.
5. Проходит ли внутренний и внешний health-check.

## Что обновлять вместе с этим документом

Обновите `runtime-flows.md`, если меняется хотя бы один из этих аспектов:

- startup flow фронтенда или backend;
- логика `local/server` режима;
- формат синхронизации рабочего дня;
- контракт import;
- порядок деплоя STG или PROD;
- health-check URLs или systemd unit names.
