import { $, buildMonthMatrix } from './utils.js';

const MAX_VACATION_PERIODS = 5;
const VACATION_STORE_KEY = 'mini-task-tracker:vacation-ranges:v1';

export function initGraphFeature({
  getCurrentView,
  getTasks,
  totalTimeMs,
  isHolidayDay,
  isWeekendDay,
  requestRender,
}) {
  let graphMonthDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  let vacationRanges = readVacationRanges();
  let pickerBaseMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  let pickerStart = null;
  let pickerEnd = null;

  const ui = {
    composer: $('#vacationComposer'),
    periods: $('#vacationPeriods'),
    addBtn: $('#vacationAddBtn'),
    overlay: $('#vacationOverlay'),
    close: $('#vacationClose'),
    cancel: $('#vacationCancel'),
    ok: $('#vacationOk'),
    prev: $('#vacationPrev'),
    next: $('#vacationNext'),
    monthLeft: $('#vacationMonthLeft'),
    monthRight: $('#vacationMonthRight'),
    calLeft: $('#vacationCalLeft'),
    calRight: $('#vacationCalRight'),
  };

  bindEvents();

  function rerenderGraphIfVisible() {
    if (getCurrentView() === 'graph') requestRender();
  }

  function readVacationRanges() {
    try {
      const parsed = JSON.parse(localStorage.getItem(VACATION_STORE_KEY) || '[]');
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((item) => item && typeof item.start === 'string' && typeof item.end === 'string')
        .slice(0, MAX_VACATION_PERIODS);
    } catch {
      return [];
    }
  }

  function writeVacationRanges() {
    try {
      localStorage.setItem(VACATION_STORE_KEY, JSON.stringify(vacationRanges.slice(0, MAX_VACATION_PERIODS)));
    } catch {}
  }

  function dayKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function isKeyBetween(target, start, end) {
    return typeof target === 'string' && typeof start === 'string' && typeof end === 'string' && target >= start && target <= end;
  }

  function isVacationKey(key) {
    return vacationRanges.some((range) => range && isKeyBetween(key, range.start, range.end));
  }

  function isVacationDate(date) {
    return isVacationKey(dayKey(date));
  }

  function fromDayKey(key) {
    if (typeof key !== 'string') return null;
    const m = key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function formatVacationDate(key) {
    const d = fromDayKey(key);
    if (!d) return key || '';
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  }

  function formatVacationRange(range) {
    if (!range) return '';
    return `${formatVacationDate(range.start)} — ${formatVacationDate(range.end)}`;
  }

  function parseTs(value) {
    if (typeof value !== 'string' || !value) return null;
    const ts = Date.parse(value);
    return Number.isFinite(ts) ? ts : null;
  }

  function normalizeToDayStart(ts) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function walkTaskTree(list, cb) {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      if (!item) continue;
      cb(item);
      if (Array.isArray(item.children) && item.children.length) walkTaskTree(item.children, cb);
    }
  }

  function resolveSpentAnchorDate(task, nowTs) {
    if (task?.timerActive) return normalizeToDayStart(nowTs);
    const completedTs = parseTs(task?.completedAt);
    if (completedTs !== null) return normalizeToDayStart(completedTs);
    const updatedTs = parseTs(task?.updatedAt);
    if (updatedTs !== null) return normalizeToDayStart(updatedTs);
    const createdTs = parseTs(task?.createdAt);
    if (createdTs !== null) return normalizeToDayStart(createdTs);
    return null;
  }

  function resolveDoneAnchorDate(task) {
    const completedTs = parseTs(task?.completedAt);
    if (completedTs !== null) return normalizeToDayStart(completedTs);
    const updatedTs = parseTs(task?.updatedAt);
    if (updatedTs !== null) return normalizeToDayStart(updatedTs);
    const createdTs = parseTs(task?.createdAt);
    if (createdTs !== null) return normalizeToDayStart(createdTs);
    return null;
  }

  function buildGraphStatsMap(nowTs) {
    const statsByDay = new Map();
    const ensureDay = (key) => {
      const cur = statsByDay.get(key);
      if (cur) return cur;
      const next = { spentMinutes: 0, doneCount: 0 };
      statsByDay.set(key, next);
      return next;
    };
    walkTaskTree(getTasks(), (task) => {
      if (task.done === true) {
        const doneDate = resolveDoneAnchorDate(task);
        if (doneDate) ensureDay(dayKey(doneDate)).doneCount += 1;
      }
      const spentMs = totalTimeMs(task, nowTs);
      if (spentMs <= 0) return;
      const spentDate = resolveSpentAnchorDate(task, nowTs);
      if (!spentDate) return;
      ensureDay(dayKey(spentDate)).spentMinutes += Math.floor(spentMs / 60000);
    });
    return statsByDay;
  }

  function formatMinutes(minutes) {
    const safe = Math.max(0, Math.floor(minutes || 0));
    return `${Math.floor(safe / 60)} ч ${String(safe % 60).padStart(2, '0')} м`;
  }

  function resolveProgressBand(ratio) {
    if (ratio >= 1) return 'is-hit';
    if (ratio >= 0.8) return 'is-high';
    if (ratio >= 0.4) return 'is-mid';
    return 'is-low';
  }

  function formatDayWord(count) {
    const abs = Math.abs(Number(count) || 0);
    const mod100 = abs % 100;
    if (mod100 >= 11 && mod100 <= 14) return 'дней';
    const mod10 = abs % 10;
    if (mod10 === 1) return 'день';
    if (mod10 >= 2 && mod10 <= 4) return 'дня';
    return 'дней';
  }

  function renderGraphMonth(container) {
    const targetMinutes = 4 * 60;
    const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
    const weekdayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт'];
    const monthStart = new Date(graphMonthDate.getFullYear(), graphMonthDate.getMonth(), 1);
    const year = monthStart.getFullYear();
    const monthIndex = monthStart.getMonth();
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    const monthLabel = `${monthNames[monthIndex]} ${year}`;

    const root = document.createElement('section');
    root.className = 'graph-view';
    const header = document.createElement('div');
    header.className = 'graph-view-header';
    const controls = document.createElement('div');
    controls.className = 'graph-view-controls';

    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'year-plan-arrow';
    prevBtn.textContent = '‹';
    prevBtn.setAttribute('aria-label', 'Предыдущий месяц');
    prevBtn.onclick = () => {
      graphMonthDate = new Date(year, monthIndex - 1, 1);
      requestRender();
    };

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'year-plan-arrow';
    nextBtn.textContent = '›';
    nextBtn.setAttribute('aria-label', 'Следующий месяц');
    nextBtn.onclick = () => {
      graphMonthDate = new Date(year, monthIndex + 1, 1);
      requestRender();
    };

    const monthTitle = document.createElement('div');
    monthTitle.className = 'graph-view-month';
    monthTitle.textContent = monthLabel;

    let workdaysCount = 0;
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, monthIndex, day, 12, 0, 0);
      const weekend = isWeekendDay(year, monthIndex, day);
      const holiday = isHolidayDay(year, monthIndex, day);
      const vacation = isVacationDate(date);
      if (!weekend && !holiday && !vacation) workdaysCount += 1;
    }
    const workdaysLabel = document.createElement('div');
    workdaysLabel.className = 'graph-workdays';
    workdaysLabel.textContent = `${workdaysCount} ${formatDayWord(workdaysCount)}`;

    controls.append(prevBtn, monthTitle, nextBtn);
    header.append(controls, workdaysLabel);
    root.appendChild(header);

    const columns = document.createElement('div');
    columns.className = 'graph-columns';
    const monthEnd = new Date(year, monthIndex + 1, 0);
    const now = new Date();
    const nowTs = now.getTime();
    const statsByDay = buildGraphStatsMap(nowTs);
    const getMonIndex = (date) => (date.getDay() + 6) % 7;
    const firstWeekMonday = new Date(year, monthIndex, 1 - getMonIndex(monthStart));
    const lastWeekFriday = new Date(monthEnd);
    lastWeekFriday.setDate(monthEnd.getDate() + (4 - getMonIndex(monthEnd)));
    const weekStarts = [];
    for (let cursor = new Date(firstWeekMonday); cursor <= lastWeekFriday; cursor.setDate(cursor.getDate() + 7)) {
      weekStarts.push(new Date(cursor));
    }
    const visibleWeekStarts = weekStarts.filter((weekStart) => {
      for (let weekdayOffset = 0; weekdayOffset < 5; weekdayOffset++) {
        const date = new Date(weekStart);
        date.setDate(weekStart.getDate() + weekdayOffset);
        if (date.getMonth() !== monthIndex) continue;
        const weekend = isWeekendDay(date.getFullYear(), date.getMonth(), date.getDate());
        const holiday = isHolidayDay(date.getFullYear(), date.getMonth(), date.getDate());
        if (!weekend && !holiday) return true;
      }
      return false;
    });

    for (let weekday = 1; weekday <= 5; weekday++) {
      const col = document.createElement('section');
      col.className = 'graph-column';
      const title = document.createElement('div');
      title.className = 'graph-column-title';
      title.textContent = weekdayNames[weekday - 1];
      col.appendChild(title);

      const dayList = document.createElement('div');
      dayList.className = 'graph-day-list';
      for (const weekStart of visibleWeekStarts) {
        const date = new Date(weekStart);
        date.setDate(weekStart.getDate() + (weekday - 1));
        const isOut = date.getMonth() !== monthIndex;
        const isWeekend = isWeekendDay(date.getFullYear(), date.getMonth(), date.getDate());
        const isHoliday = isHolidayDay(date.getFullYear(), date.getMonth(), date.getDate());
        const isVacation = isVacationDate(date);
        const isOffday = isWeekend || isHoliday || isVacation;
        const isToday = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
        const rawStats = statsByDay.get(dayKey(date)) || { spentMinutes: 0, doneCount: 0 };
        const dayStats = isOffday ? { spentMinutes: 0, doneCount: 0 } : rawStats;
        const progressRatio = Math.min(dayStats.spentMinutes / targetMinutes, 1);
        const progressPct = Math.round(progressRatio * 100);
        const card = document.createElement('article');
        card.className = 'graph-day-card';
        card.classList.add(resolveProgressBand(progressRatio));
        if (isOut) card.classList.add('is-out');
        if (isHoliday) card.classList.add('is-holiday');
        if (isWeekend) card.classList.add('is-weekend');
        if (isVacation) card.classList.add('is-vacation');
        if (isOffday) card.classList.add('is-offday');
        if (isToday) card.classList.add('is-today');
        card.style.setProperty('--graph-progress', `${progressPct}%`);
        card.innerHTML = `
          <div class="graph-day-progress" aria-hidden="true"></div>
          <div class="graph-day-content">
            <div class="graph-day-head">
              <div class="graph-day-date">${date.getDate()}</div>
              <div class="graph-day-percent">${progressPct}%</div>
            </div>
            <div class="graph-day-metric">Время: ${formatMinutes(dayStats.spentMinutes)}</div>
            <div class="graph-day-metric">Задач: ${dayStats.doneCount}</div>
          </div>
        `;
        dayList.appendChild(card);
      }
      col.appendChild(dayList);
      columns.appendChild(col);
    }
    root.appendChild(columns);
    container.appendChild(root);
  }

  function openPicker() {
    if (!ui.overlay) return;
    pickerBaseMonth = new Date(graphMonthDate.getFullYear(), graphMonthDate.getMonth(), 1);
    pickerStart = null;
    pickerEnd = null;
    renderPicker();
    ui.overlay.classList.add('is-open');
    ui.overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('vacation-dialog-open');
  }

  function closePicker() {
    if (!ui.overlay) return;
    ui.overlay.classList.remove('is-open');
    ui.overlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('vacation-dialog-open');
  }

  function renderPickerMonth(container, year, month) {
    if (!container) return;
    const weeks = buildMonthMatrix(year, month, { minVisibleDays: 1, maxWeeks: 6 });
    const frag = document.createDocumentFragment();
    for (const week of weeks) {
      for (const cell of week.days) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'vacation-day';
        btn.textContent = String(cell.d.getDate());
        const key = dayKey(cell.d);
        if (!cell.inMonth) btn.classList.add('is-out');
        if (pickerStart === key) btn.classList.add('is-start');
        if (pickerEnd === key) btn.classList.add('is-end');
        if (pickerStart && pickerEnd && isKeyBetween(key, pickerStart, pickerEnd)) btn.classList.add('is-range');
        if (!cell.inMonth) {
          btn.disabled = true;
        } else {
          btn.addEventListener('click', () => {
            if (!pickerStart || pickerEnd) {
              pickerStart = key;
              pickerEnd = null;
            } else if (key < pickerStart) {
              pickerEnd = pickerStart;
              pickerStart = key;
            } else {
              pickerEnd = key;
            }
            renderPicker();
          });
        }
        frag.appendChild(btn);
      }
    }
    container.replaceChildren(frag);
  }

  function renderPicker() {
    const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
    const rightMonth = new Date(pickerBaseMonth.getFullYear(), pickerBaseMonth.getMonth() + 1, 1);
    if (ui.monthLeft) ui.monthLeft.textContent = `${monthNames[pickerBaseMonth.getMonth()]} ${pickerBaseMonth.getFullYear()}`;
    if (ui.monthRight) ui.monthRight.textContent = `${monthNames[rightMonth.getMonth()]} ${rightMonth.getFullYear()}`;
    renderPickerMonth(ui.calLeft, pickerBaseMonth.getFullYear(), pickerBaseMonth.getMonth());
    renderPickerMonth(ui.calRight, rightMonth.getFullYear(), rightMonth.getMonth());
    if (ui.ok) ui.ok.disabled = !(pickerStart && pickerEnd);
  }

  function savePickerRange() {
    if (!(pickerStart && pickerEnd)) return;
    if (vacationRanges.length >= MAX_VACATION_PERIODS) return;
    vacationRanges.push({ start: pickerStart, end: pickerEnd });
    vacationRanges.sort((a, b) => String(a.start).localeCompare(String(b.start)));
    writeVacationRanges();
    renderVacationComposer();
    rerenderGraphIfVisible();
    closePicker();
  }

  function renderVacationComposer() {
    const isGraph = getCurrentView() === 'graph';
    if (ui.composer) ui.composer.setAttribute('aria-hidden', isGraph ? 'false' : 'true');
    if (!ui.periods) return;
    ui.periods.innerHTML = '';
    if (!isGraph) return;
    vacationRanges.forEach((range, index) => {
      const chip = document.createElement('span');
      chip.className = 'vacation-period-chip';
      const text = document.createElement('span');
      text.className = 'vacation-period-text';
      text.textContent = formatVacationRange(range);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'vacation-period-remove';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Удалить период отпуска ${index + 1}`);
      remove.title = 'Удалить период';
      remove.addEventListener('click', () => {
        vacationRanges = vacationRanges.filter((_, i) => i !== index);
        writeVacationRanges();
        renderVacationComposer();
        rerenderGraphIfVisible();
      });
      chip.append(text, remove);
      ui.periods.appendChild(chip);
    });
    if (!vacationRanges.length) {
      const empty = document.createElement('span');
      empty.className = 'vacation-period-empty';
      empty.textContent = 'Периоды отпуска не добавлены';
      ui.periods.appendChild(empty);
    }
    if (ui.addBtn) {
      const blocked = vacationRanges.length >= MAX_VACATION_PERIODS;
      ui.addBtn.disabled = blocked;
      ui.addBtn.textContent = blocked ? 'Лимит: 5 периодов' : 'Добавить отпуск';
    }
  }

  function bindEvents() {
    if (ui.addBtn) ui.addBtn.addEventListener('click', () => openPicker());
    if (ui.prev) ui.prev.addEventListener('click', () => {
      pickerBaseMonth = new Date(pickerBaseMonth.getFullYear(), pickerBaseMonth.getMonth() - 1, 1);
      renderPicker();
    });
    if (ui.next) ui.next.addEventListener('click', () => {
      pickerBaseMonth = new Date(pickerBaseMonth.getFullYear(), pickerBaseMonth.getMonth() + 1, 1);
      renderPicker();
    });
    if (ui.ok) ui.ok.addEventListener('click', () => savePickerRange());
    if (ui.cancel) ui.cancel.addEventListener('click', () => closePicker());
    if (ui.close) ui.close.addEventListener('click', () => closePicker());
    if (ui.overlay) ui.overlay.addEventListener('click', (e) => {
      if (e.target === ui.overlay) closePicker();
    });
  }

  return {
    renderGraphMonth,
    renderVacationComposer,
  };
}
