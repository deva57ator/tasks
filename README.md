# Tasks

Личный таск-трекер для self-hosting. Статический SPA на ванильном JS + Node.js API + SQLite. Нет фреймворков, нет сборщика, минимум зависимостей.

Живёт на [parkhomenko.space/tasks](https://parkhomenko.space/tasks/).

---

## Быстрый старт

### Backend

```bash
cd apps/api
cp .env.example .env   # задать TASKS_API_KEY
npm install
npm run migrate        # создать/обновить базу
npm run dev            # http://127.0.0.1:4001/api
```

### Frontend

```bash
# Открыть напрямую в браузере
open apps/web/index.html

# Или через статик-сервер
cd apps/web && python3 -m http.server 8000
```

По умолчанию фронтенд работает в режиме `local` — данные хранятся в localStorage, API не нужен. Для синхронизации с сервером переключиться в режим `server` через настройки и ввести API-ключ.

---

## Архитектура

```
Браузер
  └── Nginx (parkhomenko.space)
        ├── /tasks/api/*     → 127.0.0.1:3101  (Node.js, systemd: tasks-prod)
        ├── /tasks-stg/api/* → 127.0.0.1:3102  (Node.js, systemd: tasks-stg)
        ├── /tasks/*         → /var/www/tasks-prod/   (статика)
        └── /tasks-stg/*     → /var/www/tasks-stg/    (статика)
```

### Архитектурная документация

- `docs/architecture-overview.md` — короткая карта системы и связей между слоями
- `docs/backend-architecture.md` — устройство API, сервисов, middleware и SQLite-слоя
- `docs/frontend-architecture.md` — как устроен фронтенд, состояние и callback-реестры
- `docs/data-model.md` — сущности, связи, инварианты и замечания по схеме БД
- `docs/runtime-flows.md` — пошаговые сценарии запуска, sync, import и deploy
- `docs/repo-map.md` — быстрая карта папок, entry points и куда идти по типу задачи

### Структура репозитория

```
apps/
  api/                   # Node.js + Express + SQLite
  web/                   # SPA: нативные ES-модули, без сборщика
db/
  README.md              # Политика миграций и бэкапов
infra/
  nginx/                 # Конфиг Nginx (справочный, деплоится вручную)
  rsync/                 # Фильтры rsync для CI-деплоя
  systemd/               # Unit-файлы systemd (справочные)
.github/workflows/
  deploy-stg.yml         # Автодеплой при push в main
  promote-prod.yml       # Ручной промоут в production
```

---

## Что умеет

- **Задачи** — создание, редактирование, вложенность до 2 уровней, дедлайны, заметки
- **Проекты** — группировка задач, эмодзи-иконки
- **Таймеры** — отслеживание времени на каждую задачу, ручная коррекция
- **Рабочий день** — открытие/закрытие дня, перенос незавершённых задач на следующий день, автоматическое открытие в 06:00 и закрытие в 03:00
- **Архив** — снимки завершённых рабочих дней, просмотр истории
- **Годовой план** — визуальная сетка активностей: drag-to-create, resize, привязка к проекту
- **Спринт** — фильтрация задач по проекту и диапазону дат
- **Тема** — светлая и тёмная, несколько цветовых палитр
- **Горячие клавиши** — навигация, быстрое создание задач
- **Два режима хранения** — `local` (localStorage) или `server` (синхронизация с API)
- **Импорт** — загрузка данных из JSON-дампа

---

## Фронтенд — `apps/web/`

SPA без фреймворков и сборщика. Нативные ES-модули (`type="module"`) — браузер загружает их напрямую.

### Точки входа

| Файл | Роль |
|---|---|
| `index.html` | HTML-оболочка, подключает `main.js` и `style.css` |
| `main.js` | Инициализация приложения: импортирует все модули, связывает их через коллбэки, запускает циклы обновления |
| `style.css` | Все стили (один файл, без CSS-модулей) |

### Почему коллбэки, а не прямые импорты

Модули взаимозависимы: задачи знают о проектах, проекты — о задачах. Прямые перекрёстные импорты создали бы циклические зависимости. Вместо этого `main.js` выступает шиной: импортирует все модули и передаёт им друг друга через коллбэки при инициализации.

### Режимы хранения

| Режим | Где хранятся данные | Когда использовать |
|---|---|---|
| `local` | localStorage браузера | Без сервера, личное использование |
| `server` | API + localStorage как кэш | Несколько устройств, резервное копирование |

Переключение и ввод API-ключа — через диалог настроек в интерфейсе.

### Модули `src/`

| Модуль | Назначение |
|---|---|
| `config.js` | Глобальные константы: URL API, интервалы, лимиты. Автодетект окружения по URL (`/tasks` vs `/tasks-stg`) |
| `api.js` | HTTP-клиент, блокировка при невалидном ключе, очереди запросов с дебаунсом |
| `storage.js` | Адаптеры localStorage: задачи, проекты, рабочий день, архив, тема, API-ключ, режим хранения |
| `tasks-data.js` | Дерево задач, таймеры, добавление/удаление/перемещение, синхронизация с сервером |
| `tasks-render.js` | Рендер списка задач, контекстное меню, заметки, выбор проекта, пресеты времени |
| `projects.js` | Данные и рендер проектов |
| `workday.js` | Рабочий день: открытие, закрытие, перенос задач, цикл синхронизации |
| `sprint.js` | Фильтрация задач по спринту и проекту |
| `archive.js` | Отображение и управление архивом |
| `due-picker.js` | Попап выбора дедлайна |
| `time-dialog.js` | Диалог ручного редактирования потраченного времени |
| `calendar.js` | Мини-календарь (используется в `due-picker` и `time-dialog`) |
| `keyboard.js` | Горячие клавиши |
| `effects.js` | Анимации при завершении задач; учитывает `prefers-reduced-motion` |
| `sidebar.js` | Ресайз боковой панели |
| `utils.js` | DOM-хелперы, генератор ID, форматирование дат и длительности, операции с деревом |

### Подмодуль `src/yearplan/`

Годовой план — отдельная фича со своими модулями.

| Модуль | Назначение |
|---|---|
| `data.js` | Состояние плана, загрузка с сервера или из localStorage, кэш по годам |
| `render.js` | Рендер сетки, drag-to-create, resize, перемещение, inline-переименование |
| `interactions.js` | Контекстное меню, клики, ховеры |
| `normalize.js` | Нормализация данных в единый формат |

---

## API — `apps/api/`

Node.js + Express. База данных — SQLite (через CLI `sqlite3`, без npm-пакета). Аутентификация — статический API-ключ в заголовке `X-API-Key`.

### Конфигурация (`.env`)

| Переменная | По умолчанию | Описание |
|---|---|---|
| `PORT` | `4001` | TCP-порт сервера |
| `HOST` | `127.0.0.1` | Интерфейс для bind |
| `DB_PATH` | `./data/tasks.db` | Путь к SQLite-файлу |
| `TASKS_API_KEY` | — | Ключ авторизации; если не задан — все запросы кроме `/health` вернут 401 |
| `CORS_ORIGIN` | — | Разрешённый CORS-origin (пусто — заголовки не выставляются) |

### Эндпоинты

| Маршрут | Методы | Описание |
|---|---|---|
| `/api/health` | GET | Health check (без авторизации) |
| `/api/tasks` | GET, POST, `PUT /:id`, `DELETE /:id` | CRUD задач; фильтры: `projectId`, `done`, `dueFrom`, `dueTo`, `limit`, `offset` |
| `/api/projects` | GET, POST, `PUT /:id`, `DELETE /:id` | CRUD проектов |
| `/api/archive` | GET, DELETE | Архивные снимки рабочих дней |
| `/api/workday/current` | GET | Текущий рабочий день (с ETag) |
| `/api/workday/sync` | POST | Сохранение состояния рабочего дня с клиента |
| `/api/yearplan` | GET, POST, `PATCH /:id`, `DELETE /:id` | CRUD активностей годового плана |
| `/api/stats/summary` | GET | Агрегированная статистика |
| `/api/import` | POST | Импорт данных из JSON-дампа |

### База данных

SQLite-файл, миграции — последовательные SQL-файлы в `migrations/`, применяются через `npm run migrate`.

| Таблица | Назначение |
|---|---|
| `projects` | Проекты с эмодзи-иконкой |
| `tasks` | Задачи; вложенность через `parentId` (ON DELETE CASCADE); проект через `projectId` (ON DELETE SET NULL) |
| `archive` | JSON-снимки завершённых рабочих дней |
| `workdays` | Рабочие дни; `id` = `YYYY-MM-DD` |
| `yearplan_activities` | Активности годового плана |

### Доступные команды

```bash
npm start          # production-сервер
npm run dev        # --watch, перезапуск при изменении файлов
npm run migrate    # применить ожидающие миграции
npm run lint       # проверка кода
npm test           # тесты (Node.js --test)
```

---

## Деплой

### Окружения

| | Staging | Production |
|---|---|---|
| Триггер | Автоматически при push в `main` | Вручную через `workflow_dispatch` |
| Workflow | `deploy-stg.yml` | `promote-prod.yml` |
| API-порт | `3102` | `3101` |
| Путь API | `/srv/tasks-stg/apps/api` | `/srv/tasks-prod/apps/api` |
| Путь веба | `/var/www/tasks-stg/` | `/var/www/tasks-prod/` |
| URL | `https://parkhomenko.space/tasks-stg/` | `https://parkhomenko.space/tasks/` |
| Systemd-юнит | `tasks-stg` | `tasks-prod` |
| Env-файл | `/etc/tasks-stg.env` | `/etc/tasks-prod.env` |

### Шаги деплоя

1. **rsync API** — репозиторий синхронизируется во временную папку `_tmp` через фильтр `infra/rsync/api.filter` (исключает `node_modules`, `data/`, `.env`), затем `apps/api` атомарно перекладывается на место
2. **rsync Web** — `apps/web/` синхронизируется напрямую в webroot
3. **npm ci** — установка prod-зависимостей (`--omit=dev`)
4. **Миграции** — `npm run migrate` с явно указанным `DB_PATH`
5. **Рестарт** — `systemctl restart tasks-stg / tasks-prod`
6. **Health check** — `curl --retry 10` к `/api/health`

### Секреты GitHub Actions

| Секрет | Описание |
|---|---|
| `SSH_KEY` | Приватный SSH-ключ для деплоя |
| `DEPLOY_HOST` | Хост сервера |
| `DEPLOY_USER` | SSH-пользователь |
| `DEPLOY_PORT` | SSH-порт |
| `DEPLOY_PATH_STG` / `DEPLOY_PATH_PROD` | Путь к директории API |
| `DEPLOY_WEB_PATH_STG` / `DEPLOY_WEB_PATH_PROD` | Путь к webroot |

---

## Операции

### Откат

1. Восстановить предыдущий снимок API из бэкапа или прежнего деплоя в `/srv/tasks-*/apps/api`
2. Перезапустить: `sudo systemctl restart tasks-stg tasks-prod`
3. При необходимости — запустить `promote-prod.yml` с нужным `ref`
4. Проверить: `curl -sS https://parkhomenko.space/tasks/api/health`

### Бэкапы и миграции

Политика хранения, процедура восстановления и правила написания миграций — в [db/README.md](db/README.md).
