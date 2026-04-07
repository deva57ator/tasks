import { MONTH_NAMES, YEAR_PLAN_MAX_DAYS, YEAR_PLAN_DAY_HEIGHT, YEAR_PLAN_DEFAULT_TITLE, YEAR_PLAN_ROW_GAP, YEAR_PLAN_MOVE_THRESHOLD } from '../config.js';
import { getDaysInMonth } from '../utils.js';
import {
  normalizeYearPlanRange, normalizeYearPlanColor, applyYearPlanColorStyles,
  getYearPlanSegmentPosition,
  getYearPlanDayOfYear, getYearPlanDateFromDayOfYear, getYearPlanDaysInYear,
  compareYearPlanDates,
} from './normalize.js';
import {
  yearPlanYear, setYearPlanYear,
  yearPlanCache, yearPlanLoadingYears, yearPlanErrors,
  yearPlanSelectedId, setYearPlanSelectedId,
  yearPlanResizeState, setYearPlanResizeState, yearPlanResizeSubmitting, setYearPlanResizeSubmitting,
  yearPlanMoveState, setYearPlanMoveState,
  yearPlanDraft, setYearPlanDraft, yearPlanDraftFocusRequested, setYearPlanDraftFocusRequested,
  yearPlanDraftSubmitting, setYearPlanDraftSubmitting,
  yearPlanMonthMeta, setYearPlanMonthMeta,
  yearPlanFocusId, setYearPlanFocusId,
  yearPlanEditingId, yearPlanEditingValue, yearPlanEditingSubmitting,
  setYearPlanEditingId, setYearPlanEditingValue, setYearPlanEditingOriginal,
  setYearPlanEditingFocusRequested, setYearPlanEditingSubmitting,
  yearPlanEditingFocusRequested,
  findYearPlanItem, upsertYearPlanItem, yearPlanProvider,
  updateYearPlanItemRange, ensureYearPlanData,
} from './data.js';
import {
  bindYearPlanActivityHover, bindYearPlanActivitySelect, bindYearPlanActivityContext,
  closeYearPlanContextMenu,
} from './interactions.js';

const _cb = {};
export function registerYearPlanRenderCallbacks(cbs) { Object.assign(_cb, cbs); }
function renderIfVisible() { _cb.renderIfVisible?.(); }
function toast(msg) { _cb.toast?.(msg); }
function isHolidayDay(year, m, d) { return _cb.isHolidayDay?.(year, m, d) ?? false; }
function isWeekendDay(year, m, d) { return _cb.isWeekendDay?.(year, m, d) ?? false; }

// --- State helpers ---

export function resetYearPlanEditingState() {
  setYearPlanEditingId(null);
  setYearPlanEditingValue('');
  setYearPlanEditingOriginal('');
  setYearPlanEditingFocusRequested(false);
  setYearPlanEditingSubmitting(false);
}

export function resetYearPlanResizeState({ render = true } = {}) {
  setYearPlanResizeState(null);
  setYearPlanResizeSubmitting(false);
  if (render) renderIfVisible();
}

export function resetYearPlanMoveState({ render = true } = {}) {
  setYearPlanMoveState(null);
  if (render) renderIfVisible();
}

function getYearPlanMonthMetaByIndex(index) {
  if (!Array.isArray(yearPlanMonthMeta)) return null;
  return yearPlanMonthMeta.find(entry => entry && entry.index === index) || null;
}

function getYearPlanTargetMetaFromEvent(event) {
  if (!Array.isArray(yearPlanMonthMeta)) return null;
  for (const meta of yearPlanMonthMeta) {
    if (!meta || !meta.body) continue;
    const rect = meta.body.getBoundingClientRect();
    if (event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom) return meta;
  }
  return null;
}

function getYearPlanDayFromEvent(event, meta) {
  if (!meta || !meta.daysWrap) return null;
  const row = event.target && typeof event.target.closest === 'function' ? event.target.closest('.year-day') : null;
  if (row && row.dataset.day && !row.classList.contains('is-disabled')) {
    const parsed = Math.trunc(Number(row.dataset.day));
    return Number.isFinite(parsed) ? parsed : null;
  }
  const rect = meta.daysWrap.getBoundingClientRect();
  const relativeY = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
  const inferred = Math.floor(relativeY / YEAR_PLAN_DAY_HEIGHT) + 1;
  return Math.max(1, Math.min(meta.daysInMonth, inferred));
}

function getYearPlanDurationDays(item) {
  const start = getYearPlanDayOfYear(yearPlanYear, item.startMonth, item.startDay);
  const end = getYearPlanDayOfYear(yearPlanYear, item.endMonth, item.endDay);
  return end - start + 1;
}

function getYearPlanSegmentsForMonth(slices, daysInMonth) {
  const perItemDayMeta = new Map();
  for (let day = 1; day <= daysInMonth; day++) {
    const active = slices.filter(entry => entry.startDay <= day && entry.endDay >= day);
    active.sort((a, b) => a.startDay - b.startDay || b.endDay - a.endDay || String(a.id).localeCompare(String(b.id)));
    const colCount = active.length;
    for (let i = 0; i < active.length; i++) {
      const slice = active[i];
      if (!perItemDayMeta.has(slice.id)) perItemDayMeta.set(slice.id, {});
      perItemDayMeta.get(slice.id)[day] = { slotIndex: i, colCount };
    }
  }
  const segments = [];
  for (const slice of slices) {
    const dayMeta = perItemDayMeta.get(slice.id) || {};
    let current = null;
    for (let day = slice.startDay; day <= slice.endDay && day <= daysInMonth; day++) {
      const meta = dayMeta[day];
      if (!meta) continue;
      if (!current) {
        current = { item: slice.item, slice, startDay: day, endDay: day, slotIndex: meta.slotIndex, colCount: meta.colCount };
      } else if (current.slotIndex === meta.slotIndex && current.colCount === meta.colCount) {
        current.endDay = day;
      } else {
        segments.push(current);
        current = { item: slice.item, slice, startDay: day, endDay: day, slotIndex: meta.slotIndex, colCount: meta.colCount };
      }
    }
    if (current) segments.push(current);
  }
  segments.sort((a, b) => a.slice.startDay - b.slice.startDay || b.slice.endDay - a.slice.endDay || String(a.item.id).localeCompare(String(b.item.id)) || a.startDay - b.startDay);
  return segments;
}

function getYearPlanSlicesForRange(range) {
  const slices = [];
  if (!range) return slices;
  for (let month = range.startMonth; month <= range.endMonth; month++) {
    const daysInMonth = getDaysInMonth(yearPlanYear, month - 1);
    const fromDay = month === range.startMonth ? range.startDay : 1;
    const toDay = month === range.endMonth ? range.endDay : daysInMonth;
    slices.push({ month, startDay: fromDay, endDay: toDay, isFirstSlice: month === range.startMonth, isLastSlice: month === range.endMonth });
  }
  return slices;
}

// --- Move ---

function getYearPlanMoveRange({ state, meta, day }) {
  const daysInYear = getYearPlanDaysInYear(yearPlanYear);
  const duration = Math.min(state.durationDays, daysInYear);
  const clampedDay = Math.max(1, Math.min(meta.daysInMonth, day));
  let startDayOfYear = getYearPlanDayOfYear(yearPlanYear, meta.index + 1, clampedDay);
  let endDayOfYear = startDayOfYear + duration - 1;
  if (endDayOfYear > daysInYear) { endDayOfYear = daysInYear; startDayOfYear = Math.max(1, endDayOfYear - duration + 1); }
  if (startDayOfYear < 1) { startDayOfYear = 1; endDayOfYear = Math.min(daysInYear, startDayOfYear + duration - 1); }
  const startDate = getYearPlanDateFromDayOfYear(yearPlanYear, startDayOfYear);
  const endDate = getYearPlanDateFromDayOfYear(yearPlanYear, endDayOfYear);
  return { startMonth: startDate.month, startDay: startDate.day, endMonth: endDate.month, endDay: endDate.day };
}

function startYearPlanMove(item, meta, event) {
  if (!item || !meta || !event || yearPlanMoveState) return;
  if (yearPlanResizeState || yearPlanResizeSubmitting || yearPlanDraft || yearPlanEditingId) return;
  setYearPlanSelectedId(item.id);
  setYearPlanMoveState({
    id: item.id,
    originalStartMonth: item.startMonth, originalStartDay: item.startDay,
    originalEndMonth: item.endMonth, originalEndDay: item.endDay,
    durationDays: getYearPlanDurationDays(item),
    startX: event.clientX, startY: event.clientY,
    active: false, lastValidMonthIndex: meta.index,
    targetStartMonth: item.startMonth, targetStartDay: item.startDay,
    targetEndMonth: item.endMonth, targetEndDay: item.endDay,
  });
}

export function updateYearPlanMove(event) {
  if (!yearPlanMoveState || !event) return;
  const dx = event.clientX - yearPlanMoveState.startX;
  const dy = event.clientY - yearPlanMoveState.startY;
  if (!yearPlanMoveState.active) {
    if (Math.hypot(dx, dy) < YEAR_PLAN_MOVE_THRESHOLD) return;
    yearPlanMoveState.active = true;
  }
  const targetMeta = getYearPlanTargetMetaFromEvent(event) || getYearPlanMonthMetaByIndex(yearPlanMoveState.lastValidMonthIndex);
  if (!targetMeta) return;
  yearPlanMoveState.lastValidMonthIndex = targetMeta.index;
  const day = getYearPlanDayFromEvent(event, targetMeta);
  if (!day) return;
  const range = getYearPlanMoveRange({ state: yearPlanMoveState, meta: targetMeta, day });
  yearPlanMoveState.targetStartMonth = range.startMonth;
  yearPlanMoveState.targetStartDay = range.startDay;
  yearPlanMoveState.targetEndMonth = range.endMonth;
  yearPlanMoveState.targetEndDay = range.endDay;
  renderIfVisible();
}

export async function finalizeYearPlanMove() {
  if (!yearPlanMoveState) return;
  const state = yearPlanMoveState;
  resetYearPlanMoveState({ render: false });
  if (!state.active) return;
  const unchanged = state.targetStartMonth === state.originalStartMonth && state.targetStartDay === state.originalStartDay && state.targetEndMonth === state.originalEndMonth && state.targetEndDay === state.originalEndDay;
  if (unchanged) { renderIfVisible(); return; }
  updateYearPlanItemRange(state.id, { startMonth: state.targetStartMonth, startDay: state.targetStartDay, endMonth: state.targetEndMonth, endDay: state.targetEndDay });
  renderIfVisible();
  try {
    const updated = await yearPlanProvider.update(state.id, { startMonth: state.targetStartMonth, startDay: state.targetStartDay, endMonth: state.targetEndMonth, endDay: state.targetEndDay });
    if (updated) upsertYearPlanItem(updated);
  } catch (err) {
    toast('Не удалось переместить активность');
    updateYearPlanItemRange(state.id, { startMonth: state.originalStartMonth, startDay: state.originalStartDay, endMonth: state.originalEndMonth, endDay: state.originalEndDay });
    renderIfVisible();
  }
}

// --- Resize ---

export function startYearPlanResize(item, edge, meta) {
  if (!item || !meta || yearPlanResizeSubmitting) return;
  if (yearPlanDraft || yearPlanEditingId) return;
  setYearPlanResizeState({
    id: item.id,
    startMonth: item.startMonth, startDay: item.startDay,
    endMonth: item.endMonth, endDay: item.endDay,
    originalStartMonth: item.startMonth, originalStartDay: item.startDay,
    originalEndMonth: item.endMonth, originalEndDay: item.endDay,
    edge, lastValidMonthIndex: meta.index,
  });
  renderIfVisible();
}

export function updateYearPlanResizeFromEvent(event) {
  if (!yearPlanResizeState || !event) return;
  const targetMeta = getYearPlanTargetMetaFromEvent(event) || getYearPlanMonthMetaByIndex(yearPlanResizeState.lastValidMonthIndex);
  if (!targetMeta) return;
  const day = getYearPlanDayFromEvent(event, targetMeta);
  if (!day) return;
  yearPlanResizeState.lastValidMonthIndex = targetMeta.index;
  const targetMonth = targetMeta.index + 1;
  if (yearPlanResizeState.edge === 'start') {
    if (compareYearPlanDates(targetMonth, day, yearPlanResizeState.endMonth, yearPlanResizeState.endDay) > 0) {
      yearPlanResizeState.startMonth = yearPlanResizeState.endMonth;
      yearPlanResizeState.startDay = yearPlanResizeState.endDay;
    } else {
      yearPlanResizeState.startMonth = targetMonth;
      yearPlanResizeState.startDay = day;
    }
  } else {
    if (compareYearPlanDates(targetMonth, day, yearPlanResizeState.startMonth, yearPlanResizeState.startDay) < 0) {
      yearPlanResizeState.endMonth = yearPlanResizeState.startMonth;
      yearPlanResizeState.endDay = yearPlanResizeState.startDay;
    } else {
      yearPlanResizeState.endMonth = targetMonth;
      yearPlanResizeState.endDay = day;
    }
  }
  renderIfVisible();
}

export async function finalizeYearPlanResize() {
  if (!yearPlanResizeState || yearPlanResizeSubmitting) return;
  const { id, startMonth, startDay, endMonth, endDay, originalStartMonth, originalStartDay, originalEndMonth, originalEndDay } = yearPlanResizeState;
  const unchanged = startMonth === originalStartMonth && startDay === originalStartDay && endMonth === originalEndMonth && endDay === originalEndDay;
  if (unchanged) { resetYearPlanResizeState(); return; }
  setYearPlanResizeSubmitting(true);
  renderIfVisible();
  try {
    const updated = await yearPlanProvider.update(id, { startMonth, startDay, endMonth, endDay });
    if (updated) upsertYearPlanItem(updated);
  } catch (err) {
    toast('Не удалось изменить сроки');
    await ensureYearPlanData(yearPlanYear, { force: true });
  } finally {
    resetYearPlanResizeState();
  }
}

// --- Rename ---

export function startYearPlanRename(id) {
  const item = findYearPlanItem(id);
  if (!item) return;
  setYearPlanEditingId(id);
  setYearPlanEditingValue(item.title || '');
  setYearPlanEditingOriginal(item.title || '');
  setYearPlanEditingFocusRequested(true);
  renderIfVisible();
}

function cancelYearPlanRename() {
  if (!yearPlanEditingId) return;
  resetYearPlanEditingState();
  renderIfVisible();
}

async function commitYearPlanRename() {
  if (!yearPlanEditingId || yearPlanEditingSubmitting) return;
  const id = yearPlanEditingId;
  const item = findYearPlanItem(id);
  if (!item) { resetYearPlanEditingState(); renderIfVisible(); return; }
  const normalized = (yearPlanEditingValue || '').trim() || YEAR_PLAN_DEFAULT_TITLE;
  if (normalized === item.title) { resetYearPlanEditingState(); renderIfVisible(); return; }
  setYearPlanEditingSubmitting(true);
  renderIfVisible();
  try {
    const updated = await yearPlanProvider.update(id, { title: normalized });
    if (updated) upsertYearPlanItem(updated);
  } catch (err) {
    toast('Не удалось переименовать');
  } finally {
    resetYearPlanEditingState();
    renderIfVisible();
  }
}

// --- Draft ---

export function resetYearPlanDraft() {
  setYearPlanDraft(null);
  setYearPlanDraftSubmitting(false);
  setYearPlanDraftFocusRequested(false);
}

export function startYearPlanDraft(monthIndex, day) {
  if (yearPlanDraftSubmitting) return;
  if (yearPlanDraft && (yearPlanDraft.mode === 'editing' || yearPlanDraft.mode === 'dragging')) return;
  resetYearPlanResizeState({ render: false });
  setYearPlanDraft({ mode: 'dragging', startMonth: monthIndex + 1, startDay: day, endMonth: monthIndex + 1, endDay: day, lastValidMonthIndex: monthIndex });
  setYearPlanDraftSubmitting(false);
  renderIfVisible();
}

export function updateYearPlanDraftFromEvent(event) {
  if (!yearPlanDraft || yearPlanDraft.mode !== 'dragging') return;
  const targetMeta = getYearPlanTargetMetaFromEvent(event) || getYearPlanMonthMetaByIndex(yearPlanDraft.lastValidMonthIndex);
  if (!targetMeta) return;
  const day = getYearPlanDayFromEvent(event, targetMeta);
  if (!day) return;
  yearPlanDraft.lastValidMonthIndex = targetMeta.index;
  yearPlanDraft.endMonth = targetMeta.index + 1;
  yearPlanDraft.endDay = day;
  renderIfVisible();
}

function getYearPlanDraftRange() {
  if (!yearPlanDraft) return { startMonth: 1, startDay: 1, endMonth: 1, endDay: 1 };
  return normalizeYearPlanRange(yearPlanDraft.startMonth, yearPlanDraft.startDay, yearPlanDraft.endMonth, yearPlanDraft.endDay);
}

export function finalizeYearPlanDraft() {
  if (!yearPlanDraft || yearPlanDraft.mode !== 'dragging') return;
  const range = getYearPlanDraftRange();
  setYearPlanDraft({ ...yearPlanDraft, mode: 'editing', startMonth: range.startMonth, startDay: range.startDay, endMonth: range.endMonth, endDay: range.endDay });
  setYearPlanDraftFocusRequested(true);
  renderIfVisible();
}

async function submitYearPlanDraft() {
  if (!yearPlanDraft || yearPlanDraft.mode !== 'editing' || yearPlanDraftSubmitting) return;
  setYearPlanDraftSubmitting(true);
  renderIfVisible();
  const range = getYearPlanDraftRange();
  const payload = { year: yearPlanYear, startMonth: range.startMonth, startDay: range.startDay, endMonth: range.endMonth, endDay: range.endDay, title: (yearPlanDraft.title || '').trim() || YEAR_PLAN_DEFAULT_TITLE, color: normalizeYearPlanColor(yearPlanDraft.color) };
  try {
    const created = await yearPlanProvider.create(payload);
    if (created) upsertYearPlanItem(created);
    resetYearPlanDraft();
    renderIfVisible();
  } catch (err) {
    toast('Не удалось создать активность');
    resetYearPlanDraft();
    renderIfVisible();
  }
}

// --- Focus ---

function applyYearPlanFocus() {
  if (!yearPlanFocusId) return;
  const id = yearPlanFocusId;
  requestAnimationFrame(() => {
    if (!id) return;
    const safe = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(String(id)) : String(id);
    const el = document.querySelector(`[data-year-activity-id="${safe}"]`);
    if (el && typeof el.scrollIntoView === 'function') {
      setYearPlanFocusId(null);
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  });
}

// --- Render ---

export function renderYearPlanActivities(monthMeta, items) {
  if (!Array.isArray(monthMeta)) return;
  if (!Array.isArray(items)) return;
  const rowOffset = YEAR_PLAN_ROW_GAP / 2;
  for (const meta of monthMeta) { if (!meta || !meta.layer) continue; meta.layer.innerHTML = ''; }
  for (const meta of monthMeta) {
    if (!meta || !meta.layer) continue;
    const monthIndex = meta.index + 1;
    const monthSlices = [];
    for (const entry of items) {
      if (!entry) continue;
      const adjusted = yearPlanResizeState && yearPlanResizeState.id === entry.id
        ? { ...entry, startMonth: yearPlanResizeState.startMonth, startDay: yearPlanResizeState.startDay, endMonth: yearPlanResizeState.endMonth, endDay: yearPlanResizeState.endDay }
        : entry;
      if (adjusted.startMonth > monthIndex || adjusted.endMonth < monthIndex) continue;
      const startDay = monthIndex === adjusted.startMonth ? adjusted.startDay : 1;
      const endDay = monthIndex === adjusted.endMonth ? adjusted.endDay : meta.daysInMonth;
      monthSlices.push({ id: adjusted.id, item: adjusted, startDay, endDay, isFirstSlice: monthIndex === adjusted.startMonth, isLastSlice: monthIndex === adjusted.endMonth });
    }
    if (!monthSlices.length) continue;
    const segments = getYearPlanSegmentsForMonth(monthSlices, meta.daysInMonth);
    const grouped = new Map();
    for (const segment of segments) {
      const itemId = segment.item.id;
      if (!grouped.has(itemId)) grouped.set(itemId, { item: segment.item, slice: segment.slice, segments: [], start: segment.startDay, end: segment.endDay });
      const group = grouped.get(itemId);
      group.segments.push(segment);
      group.start = Math.min(group.start, segment.startDay);
      group.end = Math.max(group.end, segment.endDay);
    }
    const orderedGroups = [...grouped.values()].sort((a, b) => a.start - b.start || b.end - a.end || String(a.item.id).localeCompare(String(b.item.id)));
    for (const group of orderedGroups) {
      const wrapper = document.createElement('div');
      wrapper.className = 'year-activity';
      applyYearPlanColorStyles(wrapper, group.item.color);
      wrapper.style.top = `${(group.start - 1) * YEAR_PLAN_DAY_HEIGHT}px`;
      wrapper.style.height = `${(group.end - group.start + 1) * YEAR_PLAN_DAY_HEIGHT}px`;
      wrapper.style.left = '0';
      wrapper.style.width = '100%';
      const isDragging = yearPlanMoveState && yearPlanMoveState.active && yearPlanMoveState.id === group.item.id;
      if (isDragging) wrapper.classList.add('is-dragging');
      const isSelected = yearPlanSelectedId === group.item.id;
      if (isSelected) wrapper.classList.add('is-selected');
      const isHovered = _cb.getYearPlanHoverId?.() === group.item.id;
      if (isHovered) wrapper.classList.add('is-hovered');
      const sortedSegments = group.segments.slice().sort((a, b) => a.startDay - b.startDay || a.slotIndex - b.slotIndex);
      const topSegment = sortedSegments[0];
      const bottomSegment = sortedSegments[sortedSegments.length - 1];
      if (isSelected && group.slice.isFirstSlice && topSegment) {
        const topHandle = document.createElement('div');
        topHandle.className = 'year-activity-resize is-top';
        topHandle.title = 'Изменить начало';
        const pos = getYearPlanSegmentPosition(topSegment);
        topHandle.style.left = pos.left;
        topHandle.style.width = pos.width;
        topHandle.addEventListener('mousedown', e => { if (e.button !== 0) return; e.preventDefault(); e.stopPropagation(); startYearPlanResize(group.item, 'start', meta); });
        bindYearPlanActivityHover(topHandle, group.item.id);
        bindYearPlanActivitySelect(topHandle, group.item.id);
        bindYearPlanActivityContext(topHandle, group.item.id);
        wrapper.appendChild(topHandle);
      }
      if (isSelected && group.slice.isLastSlice && bottomSegment) {
        const bottomHandle = document.createElement('div');
        bottomHandle.className = 'year-activity-resize is-bottom';
        bottomHandle.title = 'Изменить конец';
        const pos = getYearPlanSegmentPosition(bottomSegment);
        bottomHandle.style.left = pos.left;
        bottomHandle.style.width = pos.width;
        bottomHandle.addEventListener('mousedown', e => { if (e.button !== 0) return; e.preventDefault(); e.stopPropagation(); startYearPlanResize(group.item, 'end', meta); });
        bindYearPlanActivityHover(bottomHandle, group.item.id);
        bindYearPlanActivitySelect(bottomHandle, group.item.id);
        bindYearPlanActivityContext(bottomHandle, group.item.id);
        wrapper.appendChild(bottomHandle);
      }
      for (const segment of sortedSegments) {
        const segEl = document.createElement('div');
        segEl.className = 'year-activity-segment';
        const pos = getYearPlanSegmentPosition(segment);
        segEl.style.left = pos.left;
        segEl.style.width = pos.width;
        segEl.style.top = `${(segment.startDay - group.start) * YEAR_PLAN_DAY_HEIGHT + rowOffset}px`;
        segEl.style.height = `${(segment.endDay - segment.startDay + 1) * YEAR_PLAN_DAY_HEIGHT - YEAR_PLAN_ROW_GAP}px`;
        segEl.addEventListener('mousedown', e => startYearPlanMove(group.item, meta, e));
        bindYearPlanActivityHover(segEl, group.item.id);
        bindYearPlanActivitySelect(segEl, group.item.id);
        bindYearPlanActivityContext(segEl, group.item.id);
        if (segment.slice.isFirstSlice) {
          const handle = document.createElement('div');
          handle.className = 'year-activity-handle';
          bindYearPlanActivityHover(handle, group.item.id);
          bindYearPlanActivitySelect(handle, group.item.id);
          bindYearPlanActivityContext(handle, group.item.id);
          const label = document.createElement('div');
          label.className = 'year-activity-label';
          if (yearPlanEditingId === group.item.id && group.slice.isFirstSlice) {
            label.classList.add('is-editing');
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'year-plan-rename-input';
            input.value = yearPlanEditingValue;
            input.disabled = yearPlanEditingSubmitting;
            input.oninput = e => { setYearPlanEditingValue(e.target.value || ''); };
            input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); commitYearPlanRename(); } else if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); cancelYearPlanRename(); } };
            input.onblur = () => { if (yearPlanEditingId === group.item.id) commitYearPlanRename(); };
            label.appendChild(input);
            if (yearPlanEditingFocusRequested && !yearPlanEditingSubmitting) {
              setYearPlanEditingFocusRequested(false);
              setTimeout(() => { try { input.focus({ preventScroll: true }); input.select(); } catch { input.focus(); input.select(); } }, 0);
            }
          } else {
            const titleText = group.item.title || 'Без названия';
            const projectId = group.item.projectId;
            if (projectId) {
              const emojiSpan = document.createElement('span');
              emojiSpan.className = 'year-activity-emoji';
              emojiSpan.textContent = _cb.getProjectEmoji?.(projectId) ?? '';
              label.appendChild(emojiSpan);
            }
            const titleSpan = document.createElement('span');
            titleSpan.className = 'year-activity-title';
            titleSpan.textContent = titleText;
            label.appendChild(titleSpan);
          }
          bindYearPlanActivityHover(label, group.item.id);
          bindYearPlanActivitySelect(label, group.item.id);
          bindYearPlanActivityContext(label, group.item.id);
          segEl.append(handle, label);
        }
        wrapper.appendChild(segEl);
      }
      meta.layer.appendChild(wrapper);
    }
  }
}

export function renderYearPlanMovePreview(monthMeta) {
  if (!yearPlanMoveState || !yearPlanMoveState.active || !Array.isArray(monthMeta)) return;
  const item = findYearPlanItem(yearPlanMoveState.id);
  const itemColor = item ? item.color : null;
  const range = normalizeYearPlanRange(yearPlanMoveState.targetStartMonth, yearPlanMoveState.targetStartDay, yearPlanMoveState.targetEndMonth, yearPlanMoveState.targetEndDay);
  const slices = getYearPlanSlicesForRange(range);
  const rowOffset = YEAR_PLAN_ROW_GAP / 2;
  for (const slice of slices) {
    const target = monthMeta.find(entry => entry && entry.index === slice.month - 1);
    if (!target || !target.layer) continue;
    const start = Math.max(1, Math.min(slice.startDay, target.daysInMonth));
    const end = Math.max(start, Math.min(slice.endDay, target.daysInMonth));
    const block = document.createElement('div');
    block.className = 'year-activity year-activity--move-preview';
    applyYearPlanColorStyles(block, itemColor);
    block.style.top = `${(start - 1) * YEAR_PLAN_DAY_HEIGHT + rowOffset}px`;
    block.style.height = `${(end - start + 1) * YEAR_PLAN_DAY_HEIGHT - YEAR_PLAN_ROW_GAP}px`;
    if (slice.isFirstSlice) {
      const hint = document.createElement('div');
      hint.className = 'year-activity-duration';
      hint.textContent = `${getYearPlanDurationDays({ startMonth: range.startMonth, startDay: range.startDay, endMonth: range.endMonth, endDay: range.endDay })} дней`;
      block.appendChild(hint);
    }
    target.layer.appendChild(block);
  }
}

export function renderYearPlanDraft(monthMeta) {
  if (!yearPlanDraft || !Array.isArray(monthMeta)) return;
  const range = getYearPlanDraftRange();
  const slices = getYearPlanSlicesForRange(range);
  const rowOffset = YEAR_PLAN_ROW_GAP / 2;
  for (const slice of slices) {
    const target = monthMeta.find(entry => entry && entry.index === slice.month - 1);
    if (!target || !target.layer) continue;
    const start = Math.max(1, Math.min(slice.startDay, target.daysInMonth));
    const end = Math.max(start, Math.min(slice.endDay, target.daysInMonth));
    const block = document.createElement('div');
    block.className = 'year-activity year-activity--draft';
    block.style.top = `${(start - 1) * YEAR_PLAN_DAY_HEIGHT + rowOffset}px`;
    block.style.height = `${(end - start + 1) * YEAR_PLAN_DAY_HEIGHT - YEAR_PLAN_ROW_GAP}px`;
    if (yearPlanDraft.mode === 'editing') {
      block.classList.add('is-editing');
      if (slice.isFirstSlice) {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'year-plan-draft-input';
        input.value = yearPlanDraft.title || '';
        input.disabled = yearPlanDraftSubmitting;
        input.oninput = e => { yearPlanDraft.title = e.target.value || ''; };
        input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); submitYearPlanDraft(); } else if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); resetYearPlanDraft(); renderIfVisible(); } };
        input.onblur = () => submitYearPlanDraft();
        block.appendChild(input);
        if (yearPlanDraftFocusRequested && !yearPlanDraftSubmitting) {
          setYearPlanDraftFocusRequested(false);
          setTimeout(() => { try { input.focus({ preventScroll: true }); } catch { input.focus(); } }, 0);
        }
      } else {
        const title = document.createElement('div');
        title.className = 'year-activity-title';
        title.textContent = (yearPlanDraft.title || '').trim() || YEAR_PLAN_DEFAULT_TITLE;
        block.appendChild(title);
      }
    } else {
      block.classList.add('is-preview');
      const title = document.createElement('div');
      title.className = 'year-activity-title';
      title.textContent = YEAR_PLAN_DEFAULT_TITLE;
      block.appendChild(title);
      if (slice.isFirstSlice) {
        const hint = document.createElement('div');
        hint.className = 'year-activity-duration';
        hint.textContent = `${getYearPlanDurationDays({ startMonth: range.startMonth, startDay: range.startDay, endMonth: range.endMonth, endDay: range.endDay })} дней`;
        block.appendChild(hint);
      }
    }
    target.layer.appendChild(block);
  }
}

export function renderYearPlan(container) {
  if (!container) return;
  container.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'year-plan';

  const header = document.createElement('div');
  header.className = 'year-plan-header';
  const controls = document.createElement('div');
  controls.className = 'year-plan-controls';
  const prev = document.createElement('button');
  prev.type = 'button';
  prev.className = 'year-plan-arrow';
  prev.textContent = '‹';
  prev.onclick = () => {
    setYearPlanYear(yearPlanYear - 1);
    resetYearPlanDraft();
    setYearPlanSelectedId(null);
    resetYearPlanEditingState();
    resetYearPlanResizeState({ render: false });
    resetYearPlanMoveState({ render: false });
    closeYearPlanContextMenu();
    _cb.render?.();
  };
  const yearLabel = document.createElement('div');
  yearLabel.className = 'year-plan-year';
  yearLabel.textContent = String(yearPlanYear);
  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'year-plan-arrow';
  next.textContent = '›';
  next.onclick = () => {
    setYearPlanYear(yearPlanYear + 1);
    resetYearPlanDraft();
    setYearPlanSelectedId(null);
    resetYearPlanEditingState();
    resetYearPlanResizeState({ render: false });
    resetYearPlanMoveState({ render: false });
    closeYearPlanContextMenu();
    _cb.render?.();
  };
  controls.append(prev, yearLabel, next);
  header.append(controls);
  root.appendChild(header);

  ensureYearPlanData(yearPlanYear);

  const content = document.createElement('div');
  content.className = 'year-plan-content';

  const loading = yearPlanLoadingYears.has(yearPlanYear);
  const error = yearPlanErrors.get(yearPlanYear) || '';
  const items = yearPlanCache.get(yearPlanYear) || [];

  const statusWrap = document.createElement('div');
  statusWrap.className = 'year-plan-status';
  if (loading) { statusWrap.textContent = 'Загрузка…'; }
  else if (error) { statusWrap.textContent = error; statusWrap.classList.add('is-error'); }
  else if (!items.length) { statusWrap.textContent = 'Активностей пока нет'; statusWrap.classList.add('is-empty'); }
  if (statusWrap.textContent) content.appendChild(statusWrap);

  const grid = document.createElement('div');
  grid.className = 'year-plan-grid';
  grid.addEventListener('click', e => {
    if (e.target && typeof e.target.closest === 'function') {
      if (e.target.closest('.year-activity') || e.target.closest('.year-activity--draft')) return;
    }
    if (yearPlanSelectedId !== null) _cb.clearYearPlanSelection?.();
  });

  const semesters = [
    { title: 'Первое полугодие', start: 0, end: 5 },
    { title: 'Второе полугодие', start: 6, end: 11 },
  ];
  const monthsMeta = [];
  for (const semester of semesters) {
    const half = document.createElement('div');
    half.className = 'year-half';
    const halfLabel = document.createElement('div');
    halfLabel.className = 'year-half-label';
    halfLabel.textContent = semester.title;
    const halfMonths = document.createElement('div');
    halfMonths.className = 'year-half-months';
    for (let m = semester.start; m <= semester.end; m++) {
      const month = document.createElement('div');
      month.className = 'year-month';
      const monthTitleEl = document.createElement('div');
      monthTitleEl.className = 'year-month-title';
      monthTitleEl.textContent = MONTH_NAMES[m];
      const monthBody = document.createElement('div');
      monthBody.className = 'year-month-body';
      const daysWrap = document.createElement('div');
      daysWrap.className = 'year-days';
      const daysInMonth = getDaysInMonth(yearPlanYear, m);
      const today = new Date();
      const isCurrentYear = today.getFullYear() === yearPlanYear;
      const currentMonth = isCurrentYear ? today.getMonth() : -1;
      const currentDay = isCurrentYear ? today.getDate() : -1;
      for (let d = 1; d <= YEAR_PLAN_MAX_DAYS; d++) {
        const row = document.createElement('div');
        row.className = 'year-day';
        if (d > daysInMonth) {
          row.classList.add('is-disabled');
        } else {
          const holiday = isHolidayDay(yearPlanYear, m, d);
          if (holiday) row.classList.add('is-holiday');
          if (holiday || isWeekendDay(yearPlanYear, m, d)) row.classList.add('is-weekend');
          if (m === currentMonth && d === currentDay) row.classList.add('is-today');
          const num = document.createElement('span');
          num.className = 'year-day-num';
          num.textContent = String(d);
          row.dataset.day = String(d);
          row.appendChild(num);
        }
        daysWrap.appendChild(row);
      }
      const activitiesLayer = document.createElement('div');
      activitiesLayer.className = 'year-activities';
      const meta = { index: m, layer: activitiesLayer, daysInMonth, daysWrap, body: monthBody };
      monthBody.addEventListener('mousemove', e => { if (!yearPlanDraft || yearPlanDraft.mode !== 'dragging') return; updateYearPlanDraftFromEvent(e); });
      monthBody.addEventListener('mouseup', e => { if (!yearPlanDraft || yearPlanDraft.mode !== 'dragging') return; updateYearPlanDraftFromEvent(e); finalizeYearPlanDraft(); });
      daysWrap.addEventListener('mousedown', e => {
        if (e.button !== 0) return;
        const row = e.target && typeof e.target.closest === 'function' ? e.target.closest('.year-day') : null;
        const dayAttr = row && row.dataset.day;
        if (!dayAttr || row.classList.contains('is-disabled')) return;
        const day = Number(dayAttr);
        if (!Number.isFinite(day)) return;
        setYearPlanSelectedId(null);
        startYearPlanDraft(m, day);
        e.preventDefault();
      });
      monthBody.append(daysWrap, activitiesLayer);
      month.append(monthTitleEl, monthBody);
      halfMonths.appendChild(month);
      monthsMeta.push(meta);
    }
    half.append(halfLabel, halfMonths);
    grid.appendChild(half);
  }

  setYearPlanMonthMeta(monthsMeta);
  renderYearPlanActivities(monthsMeta, items);
  renderYearPlanMovePreview(monthsMeta);
  renderYearPlanDraft(monthsMeta);

  content.appendChild(grid);
  root.appendChild(content);
  container.appendChild(root);
  applyYearPlanFocus();
}
