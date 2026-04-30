import { isEditableShortcutTarget, getTaskRowById } from './utils.js';
import { openDuePicker, closeDuePicker } from './due-picker.js';
import { closeContextMenu, closeTimePresetMenu, closeNotesPanel, openNotesPanel, getVisibleTaskIds } from './tasks-render.js';
import { YearPlanCtx, closeYearPlanContextMenu } from './yearplan/interactions.js';
import { yearPlanSelectedId, yearPlanEditingId, findYearPlanItem, deleteYearPlanItem } from './yearplan/data.js';
import { isApiSettingsOpen, apiSettingsBlocking, closeApiSettings } from './api.js';
import { closeWorkdayDialog } from './workday.js';
import { closeProjectDeleteDialog } from './projects.js';
import { addSubtask, handleDelete, toggleTask, toggleTaskTimer, toggleTaskPriority } from './tasks-data.js';

const _cb = {};
export function registerKeyboardCallbacks(cbs) { Object.assign(_cb, cbs); }

window.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeContextMenu();
    closeTimePresetMenu();
    closeYearPlanContextMenu();
    closeNotesPanel();
    closeDuePicker();
    closeWorkdayDialog();
    closeProjectDeleteDialog();
    _cb.closeTimeDialog && _cb.closeTimeDialog();
  }
  if (YearPlanCtx.el.style.display === 'block' && (e.key === 'p' || e.key === 'P' || e.code === 'KeyP')) {
    const itemId = YearPlanCtx.activityId;
    const item = itemId ? findYearPlanItem(itemId) : null;
    const projectId = item ? item.projectId : null;
    if (projectId) {
      e.preventDefault();
      closeYearPlanContextMenu();
      _cb.setCurrentView('project');
      _cb.setCurrentProjectId(projectId);
      _cb.render();
    }
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && _cb.getCurrentView() === 'year' && yearPlanSelectedId) {
    const active = document.activeElement;
    const isInputActive = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
    if (yearPlanEditingId || isInputActive) return;
    e.preventDefault();
    deleteYearPlanItem(yearPlanSelectedId);
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && isApiSettingsOpen() && !apiSettingsBlocking) { closeApiSettings(); }
});

document.addEventListener('keydown', e => {
  if (isEditableShortcutTarget(e.target)) return;
  const selectedTaskId = _cb.getSelectedTaskId();
  if (e.key === 'Tab' && selectedTaskId) { e.preventDefault(); addSubtask(selectedTaskId); return; }
  if ((e.key === 'Backspace' || e.key === 'Delete') && selectedTaskId) {
    e.preventDefault();
    handleDelete(selectedTaskId, { visibleOrder: getVisibleTaskIds() });
  }
});

document.addEventListener('keydown', e => {
  const selectedTaskId = _cb.getSelectedTaskId();
  if (!selectedTaskId) return;
  if (isEditableShortcutTarget(e.target)) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const row = getTaskRowById(selectedTaskId);
  if (e.code === 'KeyD') {
    const anchor = row ? row.querySelector('.due-btn') : null;
    e.preventDefault();
    openDuePicker(selectedTaskId, anchor || null);
    return;
  }
  if (e.code === 'KeyF') { e.preventDefault(); toggleTask(selectedTaskId); return; }
  if (e.code === 'KeyE') { e.preventDefault(); toggleTaskPriority(selectedTaskId); return; }
  if (e.code === 'KeyR') { e.preventDefault(); toggleTaskTimer(selectedTaskId); return; }
  if (e.code === 'KeyC') { e.preventDefault(); openNotesPanel(selectedTaskId); return; }
  if (e.code === 'KeyT') { e.preventDefault(); _cb.openTimeEditDialog(selectedTaskId); }
});
