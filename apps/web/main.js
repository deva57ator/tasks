import { STORAGE_MODES, TIME_PRESETS, DEFAULT_PROJECT_EMOJI, YEAR_PLAN_DEFAULT_TITLE } from './src/config.js';
import { $, $$, uid, isDueToday, filterTree, buildMonthMatrix, formatDuration, formatTimeHM, formatDateDMY } from './src/utils.js';
import { openDuePicker, closeDuePicker, getDueEl, getDueAnchor, registerDuePickerCallbacks } from './src/due-picker.js';
import { buildSprintData, renderSprint, clearSprintFiltersUI, sprintVisibleProjects, registerSprintCallbacks } from './src/sprint.js';
import { formatYearPlanRangeLabel } from './src/yearplan/normalize.js';
import {
  yearPlanYear, setYearPlanYear,
  yearPlanCache, yearPlanLoadingYears, yearPlanErrors,
  yearPlanSelectedId, setYearPlanSelectedId,
  yearPlanHoverId, setYearPlanHoverId,
  yearPlanEditingId,
  yearPlanResizeState, yearPlanMoveState, yearPlanDraft,
  setYearPlanMonthMeta, setYearPlanFocusId,
  ensureYearPlanData,
  resetYearPlanCache, syncYearPlanDataMode,
  registerYearPlanDataCallbacks
} from './src/yearplan/data.js';
import {
  YearPlanCtx, closeYearPlanContextMenu,
  registerYearPlanInteractionsCallbacks
} from './src/yearplan/interactions.js';
import {
  renderYearPlan,
  resetYearPlanEditingState, resetYearPlanResizeState, resetYearPlanMoveState,
  startYearPlanRename,
  registerYearPlanRenderCallbacks,
  updateYearPlanMove, finalizeYearPlanMove,
  updateYearPlanResizeFromEvent, finalizeYearPlanResize,
  updateYearPlanDraftFromEvent, finalizeYearPlanDraft,
} from './src/yearplan/render.js';
import { storageMode, setStorageMode, isServerMode, StorageModeStore, ApiKeyStore, Store, ThemeStore, ThemePaletteStore, FontStore, RadiusStore, ProjectsStore, WorkdayStore, persistLocalWorkdayState, registerStorageCallbacks } from './src/storage.js';
import {
  WorkdayUI, workdayState, setWorkdayState,
  buildWorkdayPayloadForServer, hydrateWorkdayStateFromServer,
  ensureWorkdayInteractionGuards,
  openWorkdayDialog, closeWorkdayDialog, postponePendingTasks, finishWorkday,
  updateWorkdayUI, ensureWorkdayRefreshLoop, updateWorkdayRecIndicator,
  registerWorkdayCallbacks,
} from './src/workday.js';
import { setupSidebarResize, setupMobileSidebar } from './src/sidebar.js';
import {
  tasks, setTasks, pendingServerCreates,
  normalizeTaskTree, ensureTaskParentIds, migrate,
  findTask, walkTasks,
  totalTimeMs, hasActiveTimer, syncTimerLoop,
  stopTaskTimer, stopAllTimersExcept,
  addTask, markTaskDone,
  afterTasksPersisted, restoreActiveTimersFromStore,
  registerTasksDataCallbacks,
} from './src/tasks-data.js';
import {
  projects, setProjects,
  normalizeProjectsList,
  getProjectMeta, getProjectEmoji,
  renderProjects,
  initProjects, registerProjectsCallbacks,
} from './src/projects.js';
import { apiAuthLocked, apiAuthMessage, apiAuthReason, resetApiAuthLock, lockApiAuth, apiRequest, handleApiError, queueTaskUpdate, flushPendingTaskUpdates, handleServerWorkdayWrite, flushPendingWorkdaySync, ApiSettingsUI, apiSettingsBlocking, openApiSettings, closeApiSettings, toggleApiKeyVisibility, saveApiKey, clearApiKey, switchToLocalMode, setActiveSettingsSection, registerApiCallbacks } from './src/api.js';
import {
  Ctx, NotesPanel,
  registerTasksRenderCallbacks,
  renderTaskRow, rowClass, startEdit, buildRenderContext,
  closeContextMenu,
  openNotesPanel, closeNotesPanel, updateNoteIndicator,
  closeAssignSubmenu, openProjectAssignSubmenu, maybeCloseSubmenu,
  closeTimePresetMenu, getTimePresetMenuEl, getTimePresetMenuAnchor,
  updateTimerDisplays,
  setInheritedHover, getVisibleTaskIds,
  hoveredParentTaskId,
} from './src/tasks-render.js';
import { registerKeyboardCallbacks } from './src/keyboard.js';
import { handleTaskCompletionEffects, isMotionReduced, registerEffectsCallbacks } from './src/effects.js';
import {
  isTimeDialogOpen, getTimeDialogTaskId, openTimeEditDialog, closeTimeDialog,
  isTimeUpdatePending, handleInlinePreset,
  getTaskMinutes, minutesToMs, formatPresetLabel,
  registerTimeDialogCallbacks,
} from './src/time-dialog.js';
import { initCalendar } from './src/calendar.js';

let selectedTaskId=null;
let pendingEditId=null;
let currentView='all';
let currentProjectId=null;
const completedOpenByView=new Map();
const recentlyCompletedByView=new Map();
const completedDockHeightByView=new Map();



{const _p=ProjectsStore.read();setProjects(Array.isArray(_p)?_p:[]);}
normalizeProjectsList(projects,{persist:!isServerMode()});


{setTasks(Store.read());migrate(tasks);ensureTaskParentIds(tasks,null);}


const API_DEFAULT_LIMIT=200;
let isDataLoading=false;




function updateStorageToggle({loading=false}={}){const btn=document.getElementById('storageToggle');if(!btn)return;btn.dataset.mode=isServerMode()?'server':'local';btn.classList.toggle('is-loading',loading);if(loading){btn.textContent='…';btn.setAttribute('aria-busy','true')}else{btn.textContent=isServerMode()?'API':'LS';btn.removeAttribute('aria-busy')}const label=isServerMode()?'Режим: серверный API':'Режим: localStorage';btn.title=label;btn.setAttribute('aria-label',loading?`${label}. Загрузка…`:label)}

function finalizeDataLoad(){migrate(tasks);ensureTaskParentIds(tasks,null);normalizeProjectsList(projects,{persist:false});pendingServerCreates.clear();restoreActiveTimersFromStore();renderProjects();render();updateWorkdayUI();ensureWorkdayRefreshLoop()}

async function loadDataFromLocal(){setTasks(Store.read());migrate(tasks);ensureTaskParentIds(tasks,null);{const _p=ProjectsStore.read();setProjects(Array.isArray(_p)?_p:[]);}normalizeProjectsList(projects,{persist:!isServerMode()});{const _wd=WorkdayStore.read();setWorkdayState(!_wd||!_wd.id||typeof _wd.start!=='number'||typeof _wd.end!=='number'?null:_wd)};finalizeDataLoad();updateStorageToggle()}

async function loadDataFromServer({silent=false}={}){if(isDataLoading)return;if(apiAuthLocked&&apiAuthReason){lockApiAuth(apiAuthReason,apiAuthMessage);return}const key=ApiKeyStore.read();if(!key){lockApiAuth('missing','Нужен API key для доступа к API');return}isDataLoading=true;updateStorageToggle({loading:true});try{const [tasksPayload,projectsPayload,workdayPayload]=await Promise.all([apiRequest('/tasks'),apiRequest(`/projects?limit=${API_DEFAULT_LIMIT}`),apiRequest('/workday/current')]);const serverTasks=Array.isArray(tasksPayload?.items)?tasksPayload.items:Array.isArray(tasksPayload)?tasksPayload:[];setTasks(normalizeTaskTree(serverTasks,null));setProjects(normalizeProjectsList(projectsPayload&&Array.isArray(projectsPayload.items)?projectsPayload.items:[],{persist:false}));const serverWorkday=workdayPayload&&workdayPayload.workday?workdayPayload.workday:null;setWorkdayState(hydrateWorkdayStateFromServer(serverWorkday));persistLocalWorkdayState(workdayState);finalizeDataLoad();resetApiAuthLock()}catch(err){if(err&&['missing-key','unauthorized','auth-locked','network'].includes(err.code)){return}if(!silent)handleApiError(err,'Не удалось загрузить данные с сервера')}finally{isDataLoading=false;updateStorageToggle({loading:false})}}

async function refreshDataForCurrentMode(options={}){if(isServerMode())return loadDataFromServer(options);return loadDataFromLocal()}

function collectActiveTimerTasks(list=tasks,acc=[]){if(!Array.isArray(list))return acc;for(const item of list){if(!item)continue;if(item.timerActive)acc.push(item);if(Array.isArray(item.children)&&item.children.length)collectActiveTimerTasks(item.children,acc)}return acc}

function finalizeActiveTimersBeforeModeChange(mode=storageMode){const targetMode=mode===STORAGE_MODES.SERVER?STORAGE_MODES.SERVER:STORAGE_MODES.LOCAL;const activeTasks=collectActiveTimerTasks();if(!activeTasks.length)return false;for(const task of activeTasks){stopTaskTimer(task,{silent:true})}Store.write(tasks);if(targetMode===STORAGE_MODES.SERVER){for(const task of activeTasks){if(task&&task.id)queueTaskUpdate(task.id,{timeSpent:task.timeSpent})}}syncTimerLoop();return true}

  async function setStorageModeAndReload(mode,{silent=false,forceReload=false,skipToggleUpdate=false}={}){const nextMode=mode===STORAGE_MODES.SERVER?STORAGE_MODES.SERVER:STORAGE_MODES.LOCAL;const prevMode=storageMode;const changed=prevMode!==nextMode;if(changed)finalizeActiveTimersBeforeModeChange(prevMode);setStorageMode(nextMode);syncYearPlanDataMode();StorageModeStore.write(storageMode);if(!skipToggleUpdate)updateStorageToggle();if(changed){if(storageMode===STORAGE_MODES.LOCAL)resetApiAuthLock();resetYearPlanCache()}flushPendingTaskUpdates();flushPendingWorkdaySync();if(!changed&&!forceReload)return;await refreshDataForCurrentMode({silent})}

function handleServerTaskWrite(){afterTasksPersisted()}
function handleServerProjectsWrite(data){if(Array.isArray(data)){setProjects(data)}}

// Регистрируем коллбэки — все зависимости являются function declaration и доступны через hoisting.
registerStorageCallbacks({
  onServerTaskWrite: handleServerTaskWrite,
  onServerProjectsWrite: handleServerProjectsWrite,
  onServerWorkdayWrite: handleServerWorkdayWrite,
  afterTasksPersisted: afterTasksPersisted
});
registerApiCallbacks({
  toast: toast,
  buildWorkdayPayload: buildWorkdayPayloadForServer,
  refreshData: refreshDataForCurrentMode,
  setStorageModeAndReload: setStorageModeAndReload
});


function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>t.classList.remove('show'),1400)}









window.addEventListener('click',e=>{
  const _due=getDueEl();
  if(_due&&_due.style.display==='block'&&_due.dataset.fromContext==='true'){
    if(_due.contains(e.target))return;
    const anchor=getDueAnchor();
    if(anchor&&anchor.contains(e.target))return;
  }
  if(!Ctx.el.contains(e.target)&&!Ctx.sub.contains(e.target))closeContextMenu();
  const _tpm=getTimePresetMenuEl();
  if(_tpm&&_tpm.style.display==='block'){
    if(_tpm.contains(e.target))return;
    const anchor=getTimePresetMenuAnchor();
    if(anchor&&anchor.contains(e.target))return;
    closeTimePresetMenu();
  }
  if(YearPlanCtx.el.style.display==='block'&&!YearPlanCtx.el.contains(e.target))closeYearPlanContextMenu();
});
window.addEventListener('resize',()=>{closeContextMenu();closeTimePresetMenu();closeYearPlanContextMenu()});
window.addEventListener('scroll',()=>{closeContextMenu();closeTimePresetMenu();closeYearPlanContextMenu()},true);
window.addEventListener('mousemove',e=>{
  if(yearPlanMoveState){
    updateYearPlanMove(e);
    return;
  }
  if(yearPlanResizeState){
    updateYearPlanResizeFromEvent(e);
    return;
  }
  if(yearPlanDraft&&yearPlanDraft.mode==='dragging'){
    updateYearPlanDraftFromEvent(e);
  }
});
window.addEventListener('mouseup',()=>{
  if(yearPlanMoveState){
    finalizeYearPlanMove();
    return;
  }
  if(yearPlanDraft&&yearPlanDraft.mode==='dragging')finalizeYearPlanDraft();
  if(yearPlanResizeState)finalizeYearPlanResize();
});

NotesPanel.overlay&&NotesPanel.overlay.addEventListener('click',()=>closeNotesPanel());
NotesPanel.close&&NotesPanel.close.addEventListener('click',()=>closeNotesPanel());
NotesPanel.input&&NotesPanel.input.addEventListener('input',()=>{if(!NotesPanel.taskId)return;const task=findTask(NotesPanel.taskId);if(!task)return;task.notes=NotesPanel.input.value;Store.write(tasks);if(isServerMode())queueTaskUpdate(task.id,{notes:task.notes},{debounce:true});updateNoteIndicator(task.id)});



function renderYearPlanIfVisible(){if(currentView==='year'||currentView==='project')render()}
registerYearPlanDataCallbacks({render:renderYearPlanIfVisible,toast});
registerYearPlanInteractionsCallbacks({
  renderIfVisible:renderYearPlanIfVisible,
  toast,
  closeContextMenu,
  openProjectAssignSubmenu,
  closeAssignSubmenu,
  maybeCloseSubmenu,
  setYearPlanSelected,
  clearYearPlanSelection,
  setYearPlanHover,
  clearYearPlanHover,
  startYearPlanRename,
  navigateToProject:(projectId)=>{switchView('project',projectId);render()},
});
registerYearPlanRenderCallbacks({
  render,
  renderIfVisible: renderYearPlanIfVisible,
  toast,
  isHolidayDay,
  isWeekendDay,
  clearYearPlanSelection,
  getYearPlanHoverId: () => yearPlanHoverId,
  getProjectEmoji,
});
registerWorkdayCallbacks({
  toast,
  render,
  getTasks: () => tasks,
  findTask,
  walkTasks,
  totalTimeMs,
  hasActiveTimer,
  stopAllTimersExcept,
  syncTimerLoop,
  getProjectMeta,
  isMotionReduced,
  formatDuration,
  formatTimeHM,
  formatDateDMY,
  refreshDataForCurrentMode,
  closeNotesPanel,
  getNotesTaskId: () => NotesPanel.taskId,
  getSelectedTaskId: () => selectedTaskId,
  setSelectedTaskId: (id) => { selectedTaskId = id; },
});
registerProjectsCallbacks({
  toast,
  render,
  renderYearPlanIfVisible,
  getCurrentView: () => currentView,
  setCurrentView: (v) => { switchView(v); },
  getCurrentProjectId: () => currentProjectId,
  setCurrentProjectId: (id) => { if(id!==currentProjectId||currentView==='project')clearRecentlyCompletedForCurrentView(); currentProjectId = id; },
});
initProjects();
function requestYearPlanFocus(id){setYearPlanFocusId(id)}

function setYearPlanSelected(id){
  if(yearPlanSelectedId===id)return;
  if(yearPlanResizeState&&yearPlanResizeState.id!==id)resetYearPlanResizeState({render:false});
  setYearPlanSelectedId(id);
  renderYearPlanIfVisible();
}
function clearYearPlanSelection(){
  if(yearPlanSelectedId===null)return;
  resetYearPlanResizeState({render:false});
  setYearPlanSelectedId(null);
  renderYearPlanIfVisible();
}
function setYearPlanHover(id){
  if(yearPlanHoverId===id)return;
  setYearPlanHoverId(id);
  if(!yearPlanEditingId)renderYearPlanIfVisible();
}
function clearYearPlanHover(id){
  if(yearPlanHoverId!==id)return;
  setYearPlanHoverId(null);
  if(!yearPlanEditingId)renderYearPlanIfVisible();
}
function cloneTaskForView(task,children){
  return {...task,children};
}
function splitCompletedTasks(list){
  const active=[];
  const completed=[];
  if(!Array.isArray(list))return{active,completed};
  for(const task of list){
    if(!task||typeof task!=='object')continue;
    const childSplit=splitCompletedTasks(task.children||[]);
    if(task.done&&!shouldKeepCompletedVisible(task)){
      completed.push(cloneTaskForView(task,childSplit.completed));
      if(childSplit.active.length)active.push(...childSplit.active);
    }else{
      active.push(cloneTaskForView(task,childSplit.active));
      if(childSplit.completed.length)completed.push(...childSplit.completed);
    }
  }
  return{active,completed};
}
function countTaskNodes(list){
  if(!Array.isArray(list))return 0;
  let total=0;
  for(const task of list){if(!task)continue;total+=1+countTaskNodes(task.children||[])}
  return total;
}
function completedViewKey(){
  return currentView==='project'?`project:${currentProjectId||''}`:currentView;
}
function clearRecentlyCompletedForCurrentView(){
  recentlyCompletedByView.delete(completedViewKey());
}
function markRecentlyCompletedInCurrentView(id){
  if(!id)return;
  const key=completedViewKey();
  const ids=recentlyCompletedByView.get(key)||new Set();
  ids.add(id);
  recentlyCompletedByView.set(key,ids);
}
function unmarkRecentlyCompleted(id){
  if(!id)return;
  for(const ids of recentlyCompletedByView.values()){ids.delete(id)}
}
function shouldKeepCompletedVisible(task){
  if(!task||!task.done)return false;
  return recentlyCompletedByView.get(completedViewKey())?.has(task.id)===true;
}
function switchView(nextView,nextProjectId=currentProjectId,{forceRefresh=false}={}){
  const projectChanged=nextView==='project'&&nextProjectId!==currentProjectId;
  if(forceRefresh||nextView!==currentView||projectChanged)clearRecentlyCompletedForCurrentView();
  currentView=nextView;
  if(nextView==='project')currentProjectId=nextProjectId;
}
function isCompletedOpen(){
  return completedOpenByView.get(completedViewKey())===true;
}
function setCompletedOpen(open){
  completedOpenByView.set(completedViewKey(),open===true);
}
function getCompletedDockHeight(){
  return completedDockHeightByView.get(completedViewKey())||null;
}
function setCompletedDockHeight(height){
  completedDockHeightByView.set(completedViewKey(),height);
}
function getProjectVisibleTimeSpent(projectId){
  let currentTasksTime = 0;
  walkTasks(tasks,item=>{
    if(item&&item.project===projectId)currentTasksTime+=totalTimeMs(item);
  });
  return currentTasksTime;
}
function updateProjectSummaryDisplay(){
  if(currentView!=='project'||!currentProjectId)return;
  const value=document.querySelector('.project-summary-value');
  if(value)value.textContent=formatDuration(getProjectVisibleTimeSpent(currentProjectId));
}
function syncDisplays(){
  updateTimerDisplays();
  updateWorkdayRecIndicator();
}
function renderEmptyTask(container,text){
  const empty=document.createElement('div');
  empty.className='task';
  empty.innerHTML=`<div></div><div class="task-title">${text}</div><div></div>`;
  container.appendChild(empty);
}
function renderTaskTree(list,container){
  const renderContext=buildRenderContext(list);
  for(const t of list){renderTaskRow(t,0,container,renderContext)}
}
function renderTasksWithCompleted(sourceList,container,{emptyText='Пусто'}={}){
  const split=splitCompletedTasks(sourceList);
  const completedCount=countTaskNodes(split.completed);
  if(split.active.length)renderTaskTree(split.active,container);
  else renderEmptyTask(container,completedCount?'Нет активных задач.':emptyText);
  return { completed: split.completed, completedCount };
}
function renderCompletedDock(completedList,completedCount){
  const dock=document.getElementById('completedDock');
  if(!dock)return;
  dock.innerHTML='';
  const shouldShow=currentView!=='sprint'&&currentView!=='year'&&completedCount>0;
  dock.hidden=!shouldShow;
  dock.setAttribute('aria-hidden',shouldShow?'false':'true');
  dock.classList.toggle('is-open',shouldShow&&isCompletedOpen());
  if(!shouldShow)return;
  const btn=document.createElement('button');
  btn.type='button';
  btn.className='completed-toggle';
  btn.setAttribute('aria-expanded',isCompletedOpen()?'true':'false');
  const chevron=document.createElement('span');
  chevron.className='completed-toggle-chevron';
  chevron.setAttribute('aria-hidden','true');
  chevron.textContent='›';
  const label=document.createElement('span');
  label.className='completed-toggle-label';
  label.textContent='Завершённые';
  const count=document.createElement('span');
  count.className='completed-toggle-count';
  count.textContent=String(completedCount);
  btn.append(chevron,label,count);
  dock.appendChild(btn);
  btn.onclick=()=>{setCompletedOpen(!isCompletedOpen());render()};
  if(completedCount){
    if(isCompletedOpen()){
      const resizer=document.createElement('div');
      resizer.className='completed-resizer';
      resizer.setAttribute('role','separator');
      resizer.setAttribute('aria-orientation','horizontal');
      resizer.setAttribute('aria-label','Изменить высоту выполненных задач');
      const list=document.createElement('div');
      list.className='completed-list';
      renderTaskTree(completedList,list);
      dock.append(resizer,list);
      const savedHeight=getCompletedDockHeight();
      if(savedHeight)dock.style.setProperty('--completed-dock-height',`${savedHeight}px`);
      else dock.style.removeProperty('--completed-dock-height');
      resizer.addEventListener('pointerdown',event=>{
        event.preventDefault();
        const startY=event.clientY;
        const startHeight=dock.getBoundingClientRect().height;
        const maxHeight=Math.min(420,Math.max(180,Math.round((window.innerHeight-32)*0.5)));
        const minHeight=btn.getBoundingClientRect().height+88;
        resizer.setPointerCapture?.(event.pointerId);
        const onMove=moveEvent=>{
          const next=Math.max(minHeight,Math.min(maxHeight,startHeight+(startY-moveEvent.clientY)));
          dock.style.setProperty('--completed-dock-height',`${next}px`);
          setCompletedDockHeight(next);
        };
        const onUp=()=>{
          resizer.removeEventListener('pointermove',onMove);
          resizer.removeEventListener('pointerup',onUp);
          resizer.removeEventListener('pointercancel',onUp);
        };
        resizer.addEventListener('pointermove',onMove);
        resizer.addEventListener('pointerup',onUp);
        resizer.addEventListener('pointercancel',onUp);
      });
    }
  }
}
function render(){
  $$('.nav-btn').forEach(b=>b.classList.toggle('is-active',b.dataset.view===currentView));
  renderCompletedDock([],0);
  if(currentView!=='year'){
    closeYearPlanContextMenu();
    resetYearPlanEditingState();
    setYearPlanSelectedId(null);
    if(yearPlanResizeState)resetYearPlanResizeState({render:false});
    if(yearPlanMoveState)resetYearPlanMoveState({render:false});
    setYearPlanMonthMeta([]);
  }
  if(currentView!=='sprint'){
    if(sprintVisibleProjects.size)sprintVisibleProjects.clear();
    clearSprintFiltersUI();
  }
  const composer=$('.composer');
  if(composer){
    const hide=currentView==='sprint'||currentView==='year';
    if(composer.hidden!==hide)composer.hidden=hide;
    composer.setAttribute('aria-hidden',hide?'true':'false');
    document.body.classList.toggle('view-sprint',currentView==='sprint');
  }
  document.body.classList.toggle('view-year',currentView==='year');
  const wrap=$('#tasks');wrap.innerHTML='';
  wrap.classList.toggle('is-project-view',currentView==='project');
  if(currentView==='sprint'){document.getElementById('viewTitle').textContent='Спринт';renderSprint(wrap);syncTimerLoop();return}
  if(currentView==='year'){document.getElementById('viewTitle').textContent='Год';renderYearPlan(wrap);updateWorkdayUI();return}
  if(currentView==='project'){
    const proj=projects.find(p=>p.id===currentProjectId);
    document.getElementById('viewTitle').textContent=proj?proj.title:'Проект';
    const layout=document.createElement('div');
    layout.className='project-layout';
    const tasksWrap=document.createElement('div');
    tasksWrap.className='project-tasks';
    const projectHeader=document.createElement('div');
    projectHeader.className='project-summary';
    const projectTimeLabel=document.createElement('div');
    projectTimeLabel.className='project-summary-label';
    projectTimeLabel.textContent='Потрачено';
    const projectTimeValue=document.createElement('div');
    projectTimeValue.className='project-summary-value';
    projectTimeValue.textContent=formatDuration(getProjectVisibleTimeSpent(currentProjectId));
    projectHeader.append(projectTimeLabel,projectTimeValue);
    tasksWrap.appendChild(projectHeader);
    const yearSide=document.createElement('div');
    yearSide.className='year-side';
    const yearHeader=document.createElement('div');
    yearHeader.className='year-side-header';
    yearHeader.textContent='Год';
    const yearList=document.createElement('div');
    yearList.className='year-side-list';
    yearSide.append(yearHeader,yearList);
    const todaySide=document.createElement('div');
    todaySide.className='year-side';
    const todayHeader=document.createElement('div');
    todayHeader.className='year-side-header';
    todayHeader.textContent='Сегодня';
    const todayList=document.createElement('div');
    todayList.className='year-side-list';
    todaySide.append(todayHeader,todayList);
    const rightCol=document.createElement('div');
    rightCol.className='project-right-col';
    rightCol.append(todaySide,yearSide);
    layout.append(tasksWrap,rightCol);
    wrap.appendChild(layout);
    ensureYearPlanData(yearPlanYear);
    const loading=yearPlanLoadingYears.has(yearPlanYear);
    const error=yearPlanErrors.get(yearPlanYear)||'';
    const items=(yearPlanCache.get(yearPlanYear)||[]).filter(item=>item&&item.projectId===currentProjectId);
    items.sort((a,b)=>a.startMonth-b.startMonth||a.startDay-b.startDay||a.endMonth-b.endMonth||a.endDay-b.endDay||String(a.id).localeCompare(String(b.id)));
    if(loading){
      const status=document.createElement('div');
      status.className='year-side-status';
      status.textContent='Загрузка…';
      yearList.appendChild(status);
    }else if(error){
      const status=document.createElement('div');
      status.className='year-side-status is-error';
      status.textContent=error;
      yearList.appendChild(status);
    }else if(!items.length){
      const status=document.createElement('div');
      status.className='year-side-status';
      status.textContent='Инициатив нет';
      yearList.appendChild(status);
    }else{
      for(const item of items){
        const row=document.createElement('button');
        row.type='button';
        row.className='year-side-item';
        const title=document.createElement('div');
        title.className='year-side-item-title';
        title.textContent=item.title||YEAR_PLAN_DEFAULT_TITLE;
        const dates=document.createElement('div');
        dates.className='year-side-item-dates';
        dates.textContent=formatYearPlanRangeLabel(item);
        row.append(title,dates);
        row.onclick=()=>{
          setYearPlanYear(item.year||yearPlanYear);
          setYearPlanSelectedId(item.id);
          requestYearPlanFocus(item.id);
          switchView('year');
          render();
        };
        yearList.appendChild(row);
      }
    }
    const todayTasks=[];
    walkTasks(tasks,t=>{if(t&&!t.done&&t.project===currentProjectId&&isDueToday(t.due))todayTasks.push(t)});
    if(!todayTasks.length){
      const status=document.createElement('div');
      status.className='year-side-status';
      status.textContent='Нет задач на сегодня';
      todayList.appendChild(status);
    }else{
      for(const task of todayTasks){
        const row=document.createElement('button');
        row.type='button';
        row.className='year-side-item today-side-item'+(selectedTaskId===task.id?' is-selected':'');
        const title=document.createElement('div');
        title.className='year-side-item-title';
        title.textContent=task.title;
        row.append(title);
        row.onclick=()=>{
          selectedTaskId=task.id;
          render();
          requestAnimationFrame(()=>{const el=document.querySelector(`[data-id="${task.id}"]`);if(el)el.scrollIntoView({block:'center',behavior:'smooth'})});
        };
        todayList.appendChild(row);
      }
    }
    const dataList=filterTree(tasks,t=>t.project===currentProjectId);
    const completedState=renderTasksWithCompleted(dataList,tasksWrap,{emptyText:'Задач нет'});
    renderCompletedDock(completedState.completed,completedState.completedCount);
    if(pendingEditId){
      const rowEl=document.querySelector(`[data-id="${pendingEditId}"]`);
      const taskObj=findTask(pendingEditId);
      if(rowEl&&taskObj)startEdit(rowEl,taskObj);
      pendingEditId=null;
    }
    if(hoveredParentTaskId)setInheritedHover(hoveredParentTaskId);
    syncTimerLoop();
    return
  }
  document.getElementById('viewTitle').textContent=currentView==='today'?'Сегодня':'Все задачи';
  const dataList=currentView==='today'?filterTree(tasks,t=>isDueToday(t.due)):tasks;
  const completedState=renderTasksWithCompleted(dataList,wrap,{emptyText:'Пусто'});
  renderCompletedDock(completedState.completed,completedState.completedCount);
  if(pendingEditId){const rowEl=document.querySelector(`[data-id="${pendingEditId}"]`);const taskObj=findTask(pendingEditId);if(rowEl&&taskObj)startEdit(rowEl,taskObj);pendingEditId=null}
  if(hoveredParentTaskId)setInheritedHover(hoveredParentTaskId);
  syncTimerLoop();
  updateWorkdayUI()
}


const THEME_PALETTES={
  light:[
    {id:'base',name:'Ясный день',swatches:['#f6f7f9','#ffffff','#3a82f6']},
    {id:'garden',name:'Сад после дождя',swatches:['#f4f8f3','#ffffff','#2f8f69']},
    {id:'berry',name:'Ягодная бумага',swatches:['#f8f3f6','#ffffff','#b64a75']},
  ],
  dark:[
    {id:'base',name:'Глубокий фокус',swatches:['#0f1115','#171b22','#7da6ff']},
    {id:'graphite',name:'Зелёный графит',swatches:['#101312','#171d1a','#67c39b']},
    {id:'ember',name:'Тёплая ночь',swatches:['#151111','#1e1715','#e29b69']},
    {id:'radar',name:'Неоновый радар',swatches:['#0b1118','#ff3c78','#ffd600']},
  ],
};
let themePalettePrefs=readThemePalettePrefs();

function readThemePalettePrefs(){
  const raw=ThemePaletteStore.read();
  if(!raw)return {light:'base',dark:'base'};
  try{
    const parsed=JSON.parse(raw);
    if(parsed&&typeof parsed==='object')return {light:parsed.light||'base',dark:parsed.dark||'base'};
  }catch{}
  return {light:raw||'base',dark:'base'};
}
function writeThemePalettePrefs(){ThemePaletteStore.write(JSON.stringify(themePalettePrefs))}
function getThemePalette(mode,palette){
  const list=THEME_PALETTES[mode]||THEME_PALETTES.light;
  return list.some(item=>item.id===palette)?palette:list[0].id;
}
function renderThemeSettings(mode,palette){
  $$('[data-theme-mode]').forEach(btn=>{
    const active=btn.dataset.themeMode===mode;
    btn.classList.toggle('is-active',active);
    btn.setAttribute('aria-pressed',String(active));
  });
  const list=THEME_PALETTES[mode]||THEME_PALETTES.light;
  const paletteContainer=$('#themePaletteChoices');
  if(!paletteContainer)return;
  paletteContainer.replaceChildren(...list.map(item=>{
    const btn=document.createElement('button');
    btn.type='button';
    btn.className='settings-palette';
    btn.dataset.paletteChoice=item.id;
    btn.setAttribute('aria-label',item.name);
    btn.setAttribute('aria-pressed',String(item.id===palette));
    btn.classList.toggle('is-active',item.id===palette);
    const swatches=document.createElement('span');
    swatches.className='settings-palette-swatch';
    swatches.setAttribute('aria-hidden','true');
    item.swatches.forEach(color=>{
      const swatch=document.createElement('span');
      swatch.style.background=color;
      swatches.appendChild(swatch);
    });
    const name=document.createElement('span');
    name.className='settings-palette-name';
    name.textContent=item.name;
    btn.append(swatches,name);
    return btn;
  }));
}
function applyTheme(mode,requestedPalette){
  const nextMode=mode==='dark'?'dark':'light';
  const palette=getThemePalette(nextMode,requestedPalette||themePalettePrefs[nextMode]);
  themePalettePrefs[nextMode]=palette;
  const dark=nextMode==='dark';
  document.body.classList.toggle('theme-dark',dark);
  document.body.setAttribute('data-theme',nextMode);
  document.body.setAttribute('data-palette',palette);
  const btn=$('#themeToggle');
  if(btn){const label=dark?'Переключить на светлую тему':'Переключить на тёмную тему';btn.dataset.mode=nextMode;btn.setAttribute('aria-pressed',String(dark));btn.setAttribute('aria-label',label);btn.title=label}
  renderThemeSettings(nextMode,palette);
}
const themeToggle=$('#themeToggle');
function setTheme(mode,palette){applyTheme(mode,palette);ThemeStore.write(mode==='dark'?'dark':'light');writeThemePalettePrefs()}
function toggleTheme(){const dark=!document.body.classList.contains('theme-dark');const mode=dark?'dark':'light';setTheme(mode,themePalettePrefs[mode])}
if(themeToggle){themeToggle.addEventListener('click',toggleTheme)}
$$('[data-theme-mode]').forEach(btn=>{btn.addEventListener('click',()=>{const mode=btn.dataset.themeMode==='dark'?'dark':'light';setTheme(mode,themePalettePrefs[mode])})})
const themePaletteChoices=$('#themePaletteChoices');
if(themePaletteChoices){themePaletteChoices.addEventListener('click',event=>{const btn=event.target.closest('[data-palette-choice]');if(!btn||!themePaletteChoices.contains(btn))return;const mode=document.body.dataset.theme==='dark'?'dark':'light';setTheme(mode,btn.dataset.paletteChoice||'base')})}

const FONT_OPTIONS={
  plex:'"IBM Plex Sans",system-ui,-apple-system,Segoe UI,Roboto,Inter,"Noto Sans",Ubuntu,Cantarell,"Helvetica Neue",Arial,sans-serif',
  inter:'Inter,system-ui,-apple-system,Segoe UI,Roboto,"Noto Sans",Ubuntu,Cantarell,"Helvetica Neue",Arial,sans-serif',
  manrope:'Manrope,system-ui,-apple-system,Segoe UI,Roboto,"Noto Sans",Ubuntu,Cantarell,"Helvetica Neue",Arial,sans-serif',
  nunito:'"Nunito Sans",system-ui,-apple-system,Segoe UI,Roboto,"Noto Sans",Ubuntu,Cantarell,"Helvetica Neue",Arial,sans-serif',
  pt:'"PT Sans",system-ui,-apple-system,Segoe UI,Roboto,"Noto Sans",Ubuntu,Cantarell,"Helvetica Neue",Arial,sans-serif',
};
function getFontId(fontId){return Object.prototype.hasOwnProperty.call(FONT_OPTIONS,fontId)?fontId:'plex'}
function applyFont(fontId){
  const nextFont=getFontId(fontId);
  document.body.dataset.font=nextFont;
  document.documentElement.style.setProperty('--font-ui',FONT_OPTIONS[nextFont]);
  const select=$('#fontSelect');
  if(select)select.value=nextFont;
}
const fontSelect=$('#fontSelect');
if(fontSelect){fontSelect.addEventListener('change',()=>{const fontId=getFontId(fontSelect.value);applyFont(fontId);FontStore.write(fontId)})}

const RADIUS_OPTIONS={
  none:{
    '--radius':'0px',
    '--radius-control':'0px',
    '--radius-card':'0px',
    '--radius-panel':'0px',
    '--context-menu-radius':'0px',
  },
  compact:{
    '--radius':'10px',
    '--radius-control':'8px',
    '--radius-card':'12px',
    '--radius-panel':'14px',
    '--context-menu-radius':'8px',
  },
  round:{
    '--radius':'18px',
    '--radius-control':'12px',
    '--radius-card':'18px',
    '--radius-panel':'20px',
    '--context-menu-radius':'12px',
  },
};
function getRadiusId(radiusId){
  if(radiusId==='balanced')return 'compact';
  if(radiusId==='soft')return 'round';
  return Object.prototype.hasOwnProperty.call(RADIUS_OPTIONS,radiusId)?radiusId:'compact';
}
function renderRadiusSettings(radiusId){
  $$('[data-radius-level]').forEach(btn=>{
    const active=btn.dataset.radiusLevel===radiusId;
    btn.classList.toggle('is-active',active);
    btn.setAttribute('aria-pressed',String(active));
  });
}
function applyRadius(radiusId){
  const nextRadius=getRadiusId(radiusId);
  document.body.dataset.radius=nextRadius;
  const vars=RADIUS_OPTIONS[nextRadius];
  Object.entries(vars).forEach(([name,value])=>{document.documentElement.style.setProperty(name,value)});
  renderRadiusSettings(nextRadius);
}
$$('[data-radius-level]').forEach(btn=>{
  btn.addEventListener('click',()=>{
    const radiusId=getRadiusId(btn.dataset.radiusLevel);
    applyRadius(radiusId);
    RadiusStore.write(radiusId);
  });
});

const YEAR_PLAN_HOLIDAYS_2026=new Set([
  '2026-01-01',
  '2026-01-02',
  '2026-01-03',
  '2026-01-04',
  '2026-01-05',
  '2026-01-06',
  '2026-01-07',
  '2026-01-08',
  '2026-02-23',
  '2026-03-08',
  '2026-03-09',
  '2026-05-01',
  '2026-05-09',
  '2026-05-11',
  '2026-06-12',
  '2026-11-04'
]);
function isHolidayDay(year,monthIndex,day){
  if(year!==2026)return false;
  const key=`${year}-${String(monthIndex+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  return YEAR_PLAN_HOLIDAYS_2026.has(key);
}
function isWeekendDay(year,monthIndex,day){const dow=new Date(year,monthIndex,day,12,0,0).getDay();return dow===0||dow===6}

const taskInput=$('#taskInput');
const addBtn=$('#addBtn');
const composer=$('.composer');
let taskInputDirty=false;

function commitTaskInput(){
  if(!taskInput)return false;
  const value=(taskInput.value||'').trim();
  if(!value){
    taskInputDirty=false;
    return false;
  }
  addTask(value);
  taskInput.value='';
  taskInputDirty=false;
  return true;
}

function cancelTaskInput({blur=false}={}){
  if(!taskInput)return;
  taskInput.value='';
  taskInputDirty=false;
  if(blur){
    try{taskInput.blur();}catch{}
  }
}

if(addBtn){
  addBtn.addEventListener('click',()=>{
    commitTaskInput();
  });
}

if(taskInput){
  const syncDirtyState=()=>{
    taskInputDirty=!!(taskInput.value&&taskInput.value.trim());
  };
  taskInput.addEventListener('input',syncDirtyState);
  taskInput.addEventListener('focus',syncDirtyState);
  taskInput.addEventListener('keydown',event=>{
    if(event.key==='Enter'){
      event.preventDefault();
      commitTaskInput();
    }else if(event.key==='Escape'||event.key==='Esc'){
      event.preventDefault();
      cancelTaskInput({blur:true});
    }
  });

  document.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;
    if(!taskInputDirty&&document.activeElement!==taskInput)return;
    const target=event.target;
    if(target===taskInput)return;
    if(target&&typeof target.closest==='function'){
      if(target.closest('#addBtn'))return;
      if(composer&&composer.contains(target)&&target.closest('#taskInput'))return;
    }
    commitTaskInput();
  });
}
$$('.nav-btn').forEach(btn=>btn.onclick=()=>{const view=btn.dataset.view;if(view==='today'){switchView('today',currentProjectId,{forceRefresh:currentView==='today'});render();return}if(view==='sprint'){switchView('sprint',currentProjectId,{forceRefresh:currentView==='sprint'});render();return}if(view==='year'){switchView('year',currentProjectId,{forceRefresh:currentView==='year'});render();return}switchView('all',currentProjectId,{forceRefresh:currentView==='all'});render()});

const storageToggleBtn=document.getElementById('storageToggle');
if(storageToggleBtn){storageToggleBtn.addEventListener('click',async()=>{if(isDataLoading)return;const switchingToServer=!isServerMode();updateStorageToggle({loading:true});try{if(!switchingToServer){await setStorageModeAndReload(STORAGE_MODES.LOCAL,{forceReload:true,skipToggleUpdate:true});toast('Режим: localStorage');return}await setStorageModeAndReload(STORAGE_MODES.SERVER,{forceReload:true,skipToggleUpdate:true});const key=ApiKeyStore.read();if(!key){lockApiAuth('missing','Нужен API key для доступа к API');return}toast('Режим: API')}catch(err){console.error(err);if(switchingToServer){lockApiAuth('network','API недоступен')}}finally{updateStorageToggle({loading:false})}})}

if(ApiSettingsUI.openBtn){ApiSettingsUI.openBtn.addEventListener('click',()=>{const needsKey=isServerMode()&&!ApiKeyStore.read();const shouldBlock=needsKey||apiAuthLocked;const reason=apiAuthReason||(needsKey?'missing':null);openApiSettings({blocking:shouldBlock,reason,message:apiAuthMessage||null})})}
if(ApiSettingsUI.closeBtn){ApiSettingsUI.closeBtn.addEventListener('click',()=>closeApiSettings())}
if(ApiSettingsUI.overlay){ApiSettingsUI.overlay.addEventListener('click',e=>{if(e.target===ApiSettingsUI.overlay&&!apiSettingsBlocking)closeApiSettings()})}
ApiSettingsUI.navItems.forEach(item=>{item.addEventListener('click',()=>setActiveSettingsSection(item.dataset.settingsSection||'server'))})
if(ApiSettingsUI.toggle){ApiSettingsUI.toggle.addEventListener('click',toggleApiKeyVisibility)}
if(ApiSettingsUI.form){ApiSettingsUI.form.addEventListener('submit',saveApiKey)}
if(ApiSettingsUI.clearBtn){ApiSettingsUI.clearBtn.addEventListener('click',clearApiKey)}
if(ApiSettingsUI.toLocalBtn){ApiSettingsUI.toLocalBtn.addEventListener('click',()=>switchToLocalMode())}

if(WorkdayUI.button){WorkdayUI.button.addEventListener('click',()=>{if(WorkdayUI.button.disabled)return;openWorkdayDialog()})}
if(WorkdayUI.closeBtn){WorkdayUI.closeBtn.setAttribute('data-allow-closed-day','true');WorkdayUI.closeBtn.addEventListener('click',()=>closeWorkdayDialog());}
if(WorkdayUI.closeAction)WorkdayUI.closeAction.addEventListener('click',()=>finishWorkday());
if(WorkdayUI.overlay)WorkdayUI.overlay.addEventListener('click',e=>{if(e.target===WorkdayUI.overlay)closeWorkdayDialog()});
if(WorkdayUI.postponeBtn)WorkdayUI.postponeBtn.addEventListener('click',()=>postponePendingTasks());



if(!tasks.length&&!isServerMode()){const rootId=uid();const childId=uid();setTasks([{id:rootId,title:'Добавь несколько задач',done:false,collapsed:false,due:null,project:null,notes:'',timeSpent:0,timerActive:false,timerStart:null,parentId:null,children:[{id:childId,title:'Пример подзадачи',done:false,collapsed:false,due:null,project:null,notes:'',timeSpent:0,timerActive:false,timerStart:null,parentId:rootId,children:[]} ]},{id:uid(),title:'ПКМ по строке → «Переименовать»',done:false,collapsed:false,due:null,project:null,notes:'',timeSpent:0,timerActive:false,timerStart:null,parentId:null,children:[]},{id:uid(),title:'Отметь как выполненную — увидишь зачёркивание',done:true,collapsed:false,due:null,project:null,notes:'',timeSpent:0,timerActive:false,timerStart:null,parentId:null,children:[] }]);ensureTaskParentIds(tasks,null);Store.write(tasks)}
if(!projects.length&&!isServerMode()){setProjects([{id:uid(),title:'Личный',emoji:DEFAULT_PROJECT_EMOJI},{id:uid(),title:'Работа',emoji:'💼'}]);ProjectsStore.write(projects)}

renderProjects();


try{const weeks=buildMonthMatrix(2025,0,{minVisibleDays:2,maxWeeks:5});console.assert(weeks.length>=4&&weeks.length<=5);console.assert(rowClass({collapsed:false,done:false,id:'x'})==='task');const sprintSample=buildSprintData([{id:'a',title:'t',due:new Date().toISOString(),children:[]}]);console.assert(Array.isArray(sprintSample));}catch(e){console.warn('Self-tests failed:',e)}


registerTasksDataCallbacks({
  syncDisplays: syncDisplays,
  toast: toast,
  getTaskMinutes: getTaskMinutes,
  isTimeUpdatePending: isTimeUpdatePending,
  isTimeDialogOpen: isTimeDialogOpen,
  getTimeDialogTaskId: getTimeDialogTaskId,
  getCurrentView: ()=>currentView,
  getCurrentProjectId: ()=>currentProjectId,
  getProjects: ()=>projects,
  render: render,
  handleTaskCompletionEffects: handleTaskCompletionEffects,
  markRecentlyCompleted: markRecentlyCompletedInCurrentView,
  unmarkRecentlyCompleted: unmarkRecentlyCompleted,
  setSelectedTaskId: id=>{selectedTaskId=id},
  setPendingEditId: id=>{pendingEditId=id},
  getVisibleTaskIds: getVisibleTaskIds,
  getNotesTaskId: ()=>NotesPanel.taskId,
  closeNotesPanel: closeNotesPanel,
  updateNotePanelTitle: (id,v)=>{if(NotesPanel.title&&NotesPanel.taskId===id)NotesPanel.title.textContent=v},
});
registerTasksRenderCallbacks({
  toast: toast,
  render: render,
  formatDuration: formatDuration,
  getSelectedTaskId: ()=>selectedTaskId,
  setSelectedTaskId: id=>{selectedTaskId=id},
  isTimeUpdatePending: isTimeUpdatePending,
  isTimeDialogOpen: isTimeDialogOpen,
  getTimeDialogTaskId: getTimeDialogTaskId,
  openDuePicker: openDuePicker,
  closeDuePicker: closeDuePicker,
  getDueEl: getDueEl,
  getDueAnchor: getDueAnchor,
  markTaskDone: markTaskDone,
  openTimeEditDialog: openTimeEditDialog,
  getTimePresets: ()=>TIME_PRESETS,
  formatPresetLabel: formatPresetLabel,
  minutesToMs: minutesToMs,
  handleInlinePreset: handleInlinePreset,
  updateProjectSummaryDisplay: updateProjectSummaryDisplay,
});
registerDuePickerCallbacks({
  render: render,
});
registerSprintCallbacks({
  render: render,
});
registerKeyboardCallbacks({
  closeTimeDialog: closeTimeDialog,
  getCurrentView: ()=>currentView,
  setCurrentView: v=>{switchView(v)},
  getCurrentProjectId: ()=>currentProjectId,
  setCurrentProjectId: v=>{if(v!==currentProjectId||currentView==='project')clearRecentlyCompletedForCurrentView();currentProjectId=v},
  render: render,
  getSelectedTaskId: ()=>selectedTaskId,
  openTimeEditDialog: openTimeEditDialog,
});
registerEffectsCallbacks({ toast });
registerTimeDialogCallbacks({ toast });

setupSidebarResize();
setupMobileSidebar();

ensureWorkdayInteractionGuards();

(function(){applyTheme(ThemeStore.read());applyFont(FontStore.read());applyRadius(RadiusStore.read());initCalendar();updateStorageToggle();refreshDataForCurrentMode()})();
