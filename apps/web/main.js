import { STORAGE_MODES, MIN_TASK_MINUTES, MAX_TASK_MINUTES, MAX_TASK_TIME_MS, TIME_PRESETS, MONTH_NAMES, DEFAULT_PROJECT_EMOJI, SPRINT_UNASSIGNED_KEY, YEAR_PLAN_DEFAULT_TITLE } from './src/config.js';
import { $, $$, getTaskRowById, isEditableShortcutTarget, uid, isDueToday, filterTree, isoWeekInfo, clampTimeSpentMs } from './src/utils.js';
import { formatYearPlanRangeLabel } from './src/yearplan/normalize.js';
import {
  yearPlanYear, setYearPlanYear,
  yearPlanCache, yearPlanLoadingYears, yearPlanErrors,
  yearPlanSelectedId, setYearPlanSelectedId,
  yearPlanHoverId, setYearPlanHoverId,
  yearPlanEditingId,
  yearPlanResizeState, yearPlanMoveState, yearPlanDraft,
  setYearPlanMonthMeta, setYearPlanFocusId,
  findYearPlanItem,
  ensureYearPlanData, deleteYearPlanItem,
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
import { storageMode, setStorageMode, isServerMode, StorageModeStore, ApiKeyStore, Store, ThemeStore, ProjectsStore, WorkdayStore, persistLocalWorkdayState, ArchiveStore, registerStorageCallbacks } from './src/storage.js';
import {
  WorkdayUI, workdayState, setWorkdayState,
  buildWorkdayPayloadForServer, hydrateWorkdayStateFromServer,
  ensureWorkdayInteractionGuards,
  updateWorkdayCompletionState, syncWorkdayTaskSnapshot,
  openWorkdayDialog, closeWorkdayDialog, postponePendingTasks, finishWorkdayAndArchive,
  updateWorkdayUI, ensureWorkdayRefreshLoop, updateWorkdayRecIndicator,
  registerWorkdayCallbacks,
} from './src/workday.js';
import { setupSidebarResize } from './src/sidebar.js';
import {
  tasks, setTasks, pendingServerCreates,
  normalizeTaskTree, ensureTaskParentIds, migrate,
  findTask, walkTasks,
  getTaskDepth,
  totalTimeMs, hasActiveTimer, syncTimerLoop,
  stopTaskTimer, stopAllTimersExcept, toggleTaskTimer,
  addTask, addSubtask, toggleTask, markTaskDone,
  deleteTask, handleDelete,
  archiveCompletedTasks, afterTasksPersisted, restoreActiveTimersFromStore,
  removeActiveTimerState, registerTasksDataCallbacks,
} from './src/tasks-data.js';
import {
  normalizeArchivedNode, normalizeArchiveList, normalizeArchivePayload,
  renderArchive, registerArchiveCallbacks,
} from './src/archive.js';
import {
  projects, setProjects,
  normalizeProjectsList,
  getProjectTitle, getProjectMeta,
  renderProjects,
  initProjects, registerProjectsCallbacks,
} from './src/projects.js';
import { apiAuthLocked, apiAuthMessage, apiAuthReason, resetApiAuthLock, lockApiAuth, apiRequest, handleApiError, runServerAction, queueTaskUpdate, flushPendingTaskUpdates, handleServerWorkdayWrite, flushPendingWorkdaySync, ApiSettingsUI, apiSettingsBlocking, openApiSettings, closeApiSettings, isApiSettingsOpen, toggleApiKeyVisibility, saveApiKey, clearApiKey, switchToLocalMode, registerApiCallbacks } from './src/api.js';
import {
  Ctx, NotesPanel,
  registerTasksRenderCallbacks,
  renderTaskRow, startEdit, buildRenderContext,
  openContextMenu, closeContextMenu,
  openNotesPanel, closeNotesPanel, updateNoteIndicator,
  closeAssignSubmenu, openProjectAssignSubmenu, maybeCloseSubmenu,
  closeTimePresetMenu, getTimePresetMenuEl, getTimePresetMenuAnchor,
  updateTimerDisplays, updateTimeControlsState,
  setInheritedHover, getVisibleTaskIds,
  hoveredParentTaskId,
} from './src/tasks-render.js';

let archivedTasks=ArchiveStore.read();
let selectedTaskId=null;
let pendingEditId=null;
let currentView='all';
let currentProjectId=null;

const pendingTimeUpdates=new Set();
let sprintVisibleProjects=new Map();


{const _p=ProjectsStore.read();setProjects(Array.isArray(_p)?_p:[]);}
normalizeProjectsList(projects,{persist:!isServerMode()});


{setTasks(Store.read());migrate(tasks);ensureTaskParentIds(tasks,null);}
if(!Array.isArray(archivedTasks))archivedTasks=[];else archivedTasks=normalizeArchiveList(archivedTasks,{persist:!isServerMode()});


const API_DEFAULT_LIMIT=200;
let isDataLoading=false;
let dataInitialized=false;
function minutesToMs(minutes){return clampTimeSpentMs(Math.round(minutes||0)*60000)}
function msToMinutes(ms){return Math.round(clampTimeSpentMs(ms)/60000)}
function isMinutesWithinBounds(minutes){return Number.isFinite(minutes)&&minutes>=MIN_TASK_MINUTES&&minutes<=MAX_TASK_MINUTES}
function normalizeMinutes(value){const minutes=Math.round(Number(value));if(!Number.isFinite(minutes))return null;return isMinutesWithinBounds(minutes)?minutes:null}




function updateStorageToggle({loading=false}={}){const btn=document.getElementById('storageToggle');if(!btn)return;btn.dataset.mode=isServerMode()?'server':'local';btn.classList.toggle('is-loading',loading);if(loading){btn.textContent='…';btn.setAttribute('aria-busy','true')}else{btn.textContent=isServerMode()?'API':'LS';btn.removeAttribute('aria-busy')}const label=isServerMode()?'Режим: серверный API':'Режим: localStorage';btn.title=label;btn.setAttribute('aria-label',loading?`${label}. Загрузка…`:label)}

function finalizeDataLoad(){migrate(tasks);ensureTaskParentIds(tasks,null);normalizeProjectsList(projects,{persist:false});archivedTasks=normalizeArchiveList(archivedTasks,{persist:false});pendingServerCreates.clear();restoreActiveTimersFromStore();renderProjects();render();updateWorkdayUI();ensureWorkdayRefreshLoop();dataInitialized=true}

async function loadDataFromLocal(){setTasks(Store.read());migrate(tasks);ensureTaskParentIds(tasks,null);{const _p=ProjectsStore.read();setProjects(Array.isArray(_p)?_p:[]);}normalizeProjectsList(projects,{persist:!isServerMode()});archivedTasks=normalizeArchiveList(ArchiveStore.read(),{persist:!isServerMode()});{const _wd=WorkdayStore.read();setWorkdayState(!_wd||!_wd.id||typeof _wd.start!=='number'||typeof _wd.end!=='number'?null:_wd)};finalizeDataLoad();updateStorageToggle()}

async function loadDataFromServer({silent=false}={}){if(isDataLoading)return;if(apiAuthLocked&&apiAuthReason){lockApiAuth(apiAuthReason,apiAuthMessage);return}const key=ApiKeyStore.read();if(!key){lockApiAuth('missing','Нужен API key для доступа к API');return}isDataLoading=true;updateStorageToggle({loading:true});try{const [tasksPayload,projectsPayload,archivePayload,workdayPayload]=await Promise.all([apiRequest('/tasks'),apiRequest(`/projects?limit=${API_DEFAULT_LIMIT}`),apiRequest(`/archive?limit=${API_DEFAULT_LIMIT}`),apiRequest('/workday/current')]);const serverTasks=Array.isArray(tasksPayload?.items)?tasksPayload.items:Array.isArray(tasksPayload)?tasksPayload:[];setTasks(normalizeTaskTree(serverTasks,null));setProjects(normalizeProjectsList(projectsPayload&&Array.isArray(projectsPayload.items)?projectsPayload.items:[],{persist:false}));const archiveItems=normalizeArchivePayload(archivePayload&&Array.isArray(archivePayload.items)?archivePayload.items:[]);archivedTasks=normalizeArchiveList(archiveItems,{persist:false});const serverWorkday=workdayPayload&&workdayPayload.workday?workdayPayload.workday:null;setWorkdayState(hydrateWorkdayStateFromServer(serverWorkday));persistLocalWorkdayState(workdayState);finalizeDataLoad();resetApiAuthLock()}catch(err){if(err&&['missing-key','unauthorized','auth-locked','network'].includes(err.code)){return}if(!silent)handleApiError(err,'Не удалось загрузить данные с сервера')}finally{isDataLoading=false;updateStorageToggle({loading:false})}}

async function refreshDataForCurrentMode(options={}){if(isServerMode())return loadDataFromServer(options);return loadDataFromLocal()}

function collectActiveTimerTasks(list=tasks,acc=[]){if(!Array.isArray(list))return acc;for(const item of list){if(!item)continue;if(item.timerActive)acc.push(item);if(Array.isArray(item.children)&&item.children.length)collectActiveTimerTasks(item.children,acc)}return acc}

function finalizeActiveTimersBeforeModeChange(mode=storageMode){const targetMode=mode===STORAGE_MODES.SERVER?STORAGE_MODES.SERVER:STORAGE_MODES.LOCAL;const activeTasks=collectActiveTimerTasks();if(!activeTasks.length)return false;for(const task of activeTasks){stopTaskTimer(task,{silent:true})}Store.write(tasks);if(targetMode===STORAGE_MODES.SERVER){for(const task of activeTasks){if(task&&task.id)queueTaskUpdate(task.id,{timeSpent:task.timeSpent})}}syncTimerLoop();return true}

  async function setStorageModeAndReload(mode,{silent=false,forceReload=false,skipToggleUpdate=false}={}){const nextMode=mode===STORAGE_MODES.SERVER?STORAGE_MODES.SERVER:STORAGE_MODES.LOCAL;const prevMode=storageMode;const changed=prevMode!==nextMode;if(changed)finalizeActiveTimersBeforeModeChange(prevMode);setStorageMode(nextMode);syncYearPlanDataMode();StorageModeStore.write(storageMode);if(!skipToggleUpdate)updateStorageToggle();if(changed){if(storageMode===STORAGE_MODES.LOCAL)resetApiAuthLock();resetYearPlanCache()}flushPendingTaskUpdates();flushPendingWorkdaySync();if(!changed&&!forceReload)return;await refreshDataForCurrentMode({silent})}

function handleServerTaskWrite(){afterTasksPersisted()}
function handleServerProjectsWrite(data){if(Array.isArray(data)){setProjects(data)}}
function handleServerArchiveWrite(data){if(Array.isArray(data))archivedTasks=normalizeArchiveList(data,{persist:false})}

// Регистрируем коллбэки — все зависимости являются function declaration и доступны через hoisting.
registerStorageCallbacks({
  onServerTaskWrite: handleServerTaskWrite,
  onServerProjectsWrite: handleServerProjectsWrite,
  onServerArchiveWrite: handleServerArchiveWrite,
  onServerWorkdayWrite: handleServerWorkdayWrite,
  afterTasksPersisted: afterTasksPersisted
});
registerApiCallbacks({
  toast: toast,
  buildWorkdayPayload: buildWorkdayPayloadForServer,
  refreshData: refreshDataForCurrentMode,
  setStorageModeAndReload: setStorageModeAndReload
});


const EffectsStore={key:'mini-task-tracker:effects',read(){try{return JSON.parse(localStorage.getItem(this.key))||{}}catch{return{}}},write(d){try{localStorage.setItem(this.key,JSON.stringify(d))}catch{}}};
const DEFAULT_EFFECTS_SETTINGS={sound:true,confetti:true};
let effectsSettings={...DEFAULT_EFFECTS_SETTINGS,...EffectsStore.read()};
function updateEffectsSetting(key,value){if(!(key in DEFAULT_EFFECTS_SETTINGS))return;const next={...effectsSettings,[key]:!!value};effectsSettings=next;EffectsStore.write(next)}
function isSoundEnabled(){return effectsSettings.sound!==false}
function isConfettiEnabled(){return effectsSettings.confetti!==false}
if(typeof window!=='undefined'){window.TaskEffectsSettings={get:()=>({...effectsSettings}),set:(key,value)=>updateEffectsSetting(key,value)}}

const prefersReducedMotionQuery=typeof window!=='undefined'&&'matchMedia'in window?window.matchMedia('(prefers-reduced-motion: reduce)'):null;
function isMotionReduced(){return!!(prefersReducedMotionQuery&&prefersReducedMotionQuery.matches)}

let sessionCompletedCount=0;
let audioCtx=null;
function ensureAudioContext(){if(typeof window==='undefined'||typeof window.AudioContext==='undefined')return null;if(!audioCtx){audioCtx=new AudioContext()}if(audioCtx.state==='suspended'){try{audioCtx.resume()}catch{}}return audioCtx}
function playTaskCompleteBell(baseFreq){const ctx=ensureAudioContext();if(!ctx)return;const now=ctx.currentTime;const masterGain=ctx.createGain();masterGain.gain.setValueAtTime(0.0001,now);masterGain.connect(ctx.destination);masterGain.gain.exponentialRampToValueAtTime(0.85,now+0.01);masterGain.gain.exponentialRampToValueAtTime(0.0001,now+1.6);const hits=[{offset:0,freq:baseFreq*0.62,modFreq:3.2,modDepth:14,attack:0.01,sustain:0.16,decay:1.2,peak:0.7,type:'sine'},{offset:0.08,freq:baseFreq*0.94,modFreq:7.5,modDepth:20,attack:0.008,sustain:0.14,decay:1,peak:0.55,type:'triangle'},{offset:0.18,freq:baseFreq*1.36,modFreq:11,modDepth:12,attack:0.006,sustain:0.1,decay:0.9,peak:0.38,type:'triangle'}];for(const hit of hits){const osc=ctx.createOscillator();const mod=ctx.createOscillator();const modGain=ctx.createGain();const env=ctx.createGain();osc.type=hit.type||'sine';osc.frequency.setValueAtTime(hit.freq,now+hit.offset);mod.type='sine';mod.frequency.setValueAtTime(hit.modFreq,now+hit.offset);modGain.gain.setValueAtTime(hit.modDepth,now+hit.offset);mod.connect(modGain);modGain.connect(osc.frequency);const attackEnd=now+hit.offset+hit.attack;const sustainEnd=attackEnd+hit.sustain;const releaseEnd=sustainEnd+hit.decay;env.gain.setValueAtTime(0.0001,now+hit.offset);env.gain.exponentialRampToValueAtTime(Math.max(0.0001,hit.peak),attackEnd);env.gain.exponentialRampToValueAtTime(Math.max(0.0001,hit.peak*0.6),sustainEnd);env.gain.exponentialRampToValueAtTime(0.0001,releaseEnd);osc.connect(env);env.connect(masterGain);osc.start(now+hit.offset);mod.start(now+hit.offset);const stopAt=now+hit.offset+Math.max(hit.attack+hit.sustain+hit.decay+0.2,0.5);osc.stop(stopAt);mod.stop(stopAt)}setTimeout(()=>masterGain.disconnect(),1700)}

const confettiState=new WeakMap();
function ensureTaskCanvas(row){let canvas=row.querySelector('.task-confetti');if(!canvas){canvas=document.createElement('canvas');canvas.className='task-confetti';row.appendChild(canvas)}return canvas}
function spawnTaskConfetti(rowEl,checkboxEl){if(!rowEl||!checkboxEl)return;if(!isConfettiEnabled()||isMotionReduced())return;const rect=rowEl.getBoundingClientRect();if(!rect.width||!rect.height)return;const canvas=ensureTaskCanvas(rowEl);const ctx=canvas.getContext('2d');if(!ctx)return;const dpr=window.devicePixelRatio||1;const width=Math.round(rect.width*dpr);const height=Math.round(rect.height*dpr);if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;canvas.style.width=rect.width+'px';canvas.style.height=rect.height+'px'}const checkboxRect=checkboxEl.getBoundingClientRect();const originX=(checkboxRect.left-rect.left+checkboxRect.width/2)*dpr;const originY=(checkboxRect.top-rect.top+checkboxRect.height/2)*dpr;const style=getComputedStyle(rowEl);const paletteVars=['--confetti-1','--confetti-2','--confetti-3','--confetti-4','--confetti-5','--confetti-6'];let palette=paletteVars.map(name=>style.getPropertyValue(name).trim()).filter(Boolean);if(!palette.length){palette=['#2ecc71','#3498db','#9b59b6','#f1c40f','#e67e22','#e74c3c'];}const duration=0.85;const gravity=900*dpr;const particleCount=26;const particles=[];for(let i=0;i<particleCount;i++){const angle=(Math.random()*Math.PI/1.2)-(Math.PI/2.4);const speed=(260+Math.random()*160)*dpr;particles.push({x:originX,y:originY,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed,life:0,ttl:duration,color:palette[i%palette.length],size:(6+Math.random()*6)*dpr,shape:Math.random()>0.5?'square':'circle',rotation:Math.random()*Math.PI*2,vr:(Math.random()*4-2)})}
const state=confettiState.get(rowEl);if(state&&state.cancel){state.cancel()}let rafId=0;const start=performance.now();let prev=start;ctx.clearRect(0,0,canvas.width,canvas.height);const draw=now=>{const dt=(now-prev)/1000;prev=now;const elapsed=(now-start)/1000;ctx.clearRect(0,0,canvas.width,canvas.height);let active=false;for(const p of particles){p.life=elapsed;const t=Math.min(1,elapsed/p.ttl);if(t>=1)continue;active=true;p.vy+=gravity*dt;p.x+=p.vx*dt;p.y+=p.vy*dt;const alpha=1-t;ctx.save();ctx.globalAlpha=Math.max(0,alpha);ctx.translate(p.x,p.y);p.rotation+=p.vr*dt;ctx.rotate(p.rotation);ctx.fillStyle=p.color.trim()||'#fff';if(p.shape==='circle'){ctx.beginPath();ctx.arc(0,0,p.size/2,0,Math.PI*2);ctx.fill()}else{ctx.fillRect(-p.size/2,-p.size/2,p.size,p.size)}ctx.restore()}if(active){rafId=requestAnimationFrame(draw)}else{ctx.clearRect(0,0,canvas.width,canvas.height);confettiState.delete(rowEl)}};rafId=requestAnimationFrame(draw);confettiState.set(rowEl,{cancel(){if(rafId)cancelAnimationFrame(rafId);ctx.clearRect(0,0,canvas.width,canvas.height);confettiState.delete(rowEl)}})}

function animateCheckboxBounce(el){if(!el||isMotionReduced())return;el.classList.remove('is-bouncing');void el.offsetWidth;el.classList.add('is-bouncing')}

function handleTaskCompletionEffects(taskId,{completed=false,undone=false}={}){if(undone){sessionCompletedCount=Math.max(0,sessionCompletedCount-1);return}if(!completed)return;const base=600+sessionCompletedCount*250;sessionCompletedCount=Math.min(sessionCompletedCount+1,Number.MAX_SAFE_INTEGER);if(isSoundEnabled()){try{playTaskCompleteBell(base)}catch{}}
  const rowEl=document.querySelector(`.task[data-id="${taskId}"]`);
  const checkboxEl=rowEl?.querySelector('.task-checkbox');
  if(checkboxEl){requestAnimationFrame(()=>animateCheckboxBounce(checkboxEl));}
  if(rowEl&&checkboxEl){requestAnimationFrame(()=>spawnTaskConfetti(rowEl,checkboxEl));}
}

function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>t.classList.remove('show'),1400)}



let sprintDraggingId=null;
let sprintDropColumn=null;





function formatTimeHM(ms){const d=new Date(ms);if(isNaN(d))return'';return`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`}

function formatDateDMY(ms){const d=new Date(ms);if(isNaN(d))return'';return`${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`}



function getTaskMinutes(task,now=Date.now()){return msToMinutes(totalTimeMs(task,now))}

function isTimeDialogOpen(){return !!(TimeDialog.overlay&&TimeDialog.overlay.classList.contains('is-open'))}

function isTimeUpdatePending(taskId){return pendingTimeUpdates.has(taskId)}

function setTimeUpdatePending(taskId,value){if(!taskId)return;const before=pendingTimeUpdates.has(taskId);if(value){pendingTimeUpdates.add(taskId)}else{pendingTimeUpdates.delete(taskId)}if(before!==value)updateTimeControlsState(taskId)}

function formatPresetLabel(minutes){if(minutes%60===0&&minutes>=60){const hours=minutes/60;return`+${hours}ч`}return`+${minutes} мин`}


function applyTaskTime(task,timeMs,{skipRender=false}={}){if(!task)return;task.timeSpent=clampTimeSpentMs(timeMs);task.timerActive=false;task.timerStart=null;removeActiveTimerState(task.id);Store.write(tasks);syncTimerLoop();updateTimerDisplays();if(!skipRender)updateTimeControlsState(task.id)}

function saveTaskTimeMinutes(taskId,newMinutes,{showSuccessToast=false}={}){const task=findTask(taskId);if(!task)return Promise.reject(new Error('Задача не найдена'));const normalized=normalizeMinutes(newMinutes);if(normalized===null)return Promise.reject(new Error('Неверное значение времени'));const timeMs=minutesToMs(normalized);if(!isServerMode()){applyTaskTime(task,timeMs);if(showSuccessToast)toast(`Время обновлено: ${formatDuration(timeMs)}`);return Promise.resolve()}return runServerAction(()=>apiRequest(`/tasks/${encodeURIComponent(task.id)}`,{method:'PUT',body:{timeSpent:timeMs}}),{silent:true}).then(()=>{applyTaskTime(task,timeMs);if(showSuccessToast)toast(`Время обновлено: ${formatDuration(timeMs)}`)})}

function handleInlinePreset(taskId,delta){const task=findTask(taskId);if(!task)return;if(task.timerActive||isTimeUpdatePending(task.id))return;const currentMinutes=getTaskMinutes(task);const nextMinutes=currentMinutes+delta;if(!isMinutesWithinBounds(nextMinutes))return;setTimeUpdatePending(task.id,true);saveTaskTimeMinutes(task.id,nextMinutes).catch(()=>toast('Не удалось сохранить время. Попробуй ещё раз.')).finally(()=>{setTimeUpdatePending(task.id,false);updateTimerDisplays()})}
function formatDuration(ms){if(!ms)return'0 мин';const totalMinutes=Math.floor(ms/60000);if(totalMinutes<=0)return'0 мин';const hours=Math.floor(totalMinutes/60);const minutes=totalMinutes%60;const parts=[];if(hours>0)parts.push(`${hours} ч`);if(minutes>0||!parts.length)parts.push(`${minutes} мин`);return parts.join(' ')}
function setSprintDropColumn(col){if(sprintDropColumn===col)return;if(sprintDropColumn){sprintDropColumn.classList.remove('is-drop-target')}sprintDropColumn=col||null;if(sprintDropColumn){sprintDropColumn.classList.add('is-drop-target')}}
function clearSprintDragState(){const prev=document.querySelector('.sprint-task.is-dragging');if(prev)prev.classList.remove('is-dragging');setSprintDropColumn(null);sprintDraggingId=null}
function applySprintDrop(targetDate){if(!sprintDraggingId)return;const task=findTask(sprintDraggingId);if(!task)return;const d=new Date(targetDate);if(isNaN(d))return;d.setHours(0,0,0,0);const iso=d.toISOString();if(task.due!==iso){task.due=iso;Store.write(tasks);if(isServerMode())queueTaskUpdate(task.id,{due:iso})}clearSprintDragState();render()}
const TimeDialog={overlay:document.getElementById('timeOverlay'),close:document.getElementById('timeDialogClose'),cancel:document.getElementById('timeDialogCancel'),form:document.getElementById('timeDialogForm'),hours:document.getElementById('timeInputHours'),minutes:document.getElementById('timeInputMinutes'),summary:document.getElementById('timeDialogSummary'),subtitle:document.getElementById('timeDialogSubtitle'),error:document.getElementById('timeDialogError'),save:document.getElementById('timeDialogSave'),presets:document.getElementById('timeDialogPresets')};
let timeDialogTaskId=null;
let timeDialogEditedMinutes=0;
let timeDialogSaving=false;
let timeDialogDeferredTimerSyncTaskId=null;

function setTimeDialogError(msg){if(!TimeDialog.error)return;TimeDialog.error.textContent=msg||''}
function setTimeDialogInputsFromMinutes(minutes){const safe=Math.max(0,Math.round(minutes));const hours=Math.floor(safe/60);const mins=safe%60;if(TimeDialog.hours)TimeDialog.hours.value=String(hours);if(TimeDialog.minutes)TimeDialog.minutes.value=String(mins)}
function getTimeDialogState(){if(!TimeDialog.hours||!TimeDialog.minutes)return{valid:false,totalMinutes:0,hours:0,minutes:0,hoursInvalid:true,minutesInvalid:true,rangeInvalid:true};const rawHours=Number(TimeDialog.hours.value);const rawMinutes=Number(TimeDialog.minutes.value);const hoursInvalid=!Number.isFinite(rawHours)||rawHours<0;const minutesInvalid=!Number.isFinite(rawMinutes)||rawMinutes<0||rawMinutes>59;const hours=Math.floor(Number.isFinite(rawHours)?rawHours:0);const minutes=Math.floor(Number.isFinite(rawMinutes)?rawMinutes:0);const totalMinutes=hours*60+minutes;const rangeInvalid=totalMinutes<MIN_TASK_MINUTES||totalMinutes>MAX_TASK_MINUTES;const valid=!hoursInvalid&&!minutesInvalid&&!rangeInvalid;return{valid,totalMinutes,hours,minutes,hoursInvalid,minutesInvalid,rangeInvalid}}
function updateTimeDialogUI({showValidationError=false,preserveError=false}={}){const state=getTimeDialogState();timeDialogEditedMinutes=state.totalMinutes;if(TimeDialog.summary){const displayMinutes=Math.min(MAX_TASK_MINUTES,Math.max(MIN_TASK_MINUTES,state.totalMinutes));TimeDialog.summary.textContent=formatDuration(minutesToMs(displayMinutes))}if(TimeDialog.save)TimeDialog.save.disabled=!state.valid||timeDialogSaving;if(TimeDialog.hours)TimeDialog.hours.classList.toggle('is-invalid',state.hoursInvalid);if(TimeDialog.minutes)TimeDialog.minutes.classList.toggle('is-invalid',state.minutesInvalid||state.rangeInvalid);if(!preserveError){if(!state.valid||showValidationError){setTimeDialogError('Неверное значение времени')}else if(!timeDialogSaving){setTimeDialogError('')}}return state}
function applyTimeDialogPreset(delta){const next=timeDialogEditedMinutes+delta;setTimeDialogInputsFromMinutes(Math.max(0,next));timeDialogEditedMinutes=next;updateTimeDialogUI({showValidationError:next<MIN_TASK_MINUTES||next>MAX_TASK_MINUTES})}
function openTimeEditDialog(taskId){const task=findTask(taskId);if(!task||!TimeDialog.overlay)return;if(task.timerActive){stopTaskTimer(task,{skipServer:true});timeDialogDeferredTimerSyncTaskId=task.id;syncTimerLoop()}else{timeDialogDeferredTimerSyncTaskId=null}timeDialogTaskId=taskId;const currentMinutes=getTaskMinutes(task);timeDialogEditedMinutes=currentMinutes;if(TimeDialog.subtitle)TimeDialog.subtitle.textContent=currentMinutes?`Текущее значение: ${formatDuration(minutesToMs(currentMinutes))}`:'Текущее значение: 0 мин';setTimeDialogInputsFromMinutes(currentMinutes);setTimeDialogError('');timeDialogSaving=false;updateTimeDialogUI();TimeDialog.overlay.classList.add('is-open');TimeDialog.overlay.setAttribute('aria-hidden','false');document.body.classList.add('time-dialog-open');updateTimeControlsState(taskId);const focusTarget=TimeDialog.minutes||TimeDialog.hours;setTimeout(()=>{if(!focusTarget)return;try{focusTarget.focus({preventScroll:true})}catch{focusTarget.focus()}},60)}
function closeTimeDialog({syncDeferred=true}={}){if(!TimeDialog.overlay)return;const taskId=timeDialogTaskId;const shouldSyncDeferred=syncDeferred&&timeDialogDeferredTimerSyncTaskId&&taskId===timeDialogDeferredTimerSyncTaskId;timeDialogTaskId=null;timeDialogSaving=false;timeDialogEditedMinutes=0;TimeDialog.overlay.classList.remove('is-open');TimeDialog.overlay.setAttribute('aria-hidden','true');document.body.classList.remove('time-dialog-open');setTimeDialogError('');if(TimeDialog.save)TimeDialog.save.disabled=false;if(shouldSyncDeferred){const task=findTask(taskId);if(task&&isServerMode()){queueTaskUpdate(task.id,{timeSpent:task.timeSpent})}}timeDialogDeferredTimerSyncTaskId=null;updateTimeControlsState(taskId)}
function submitTimeDialog(){if(!timeDialogTaskId||timeDialogSaving)return;const task=findTask(timeDialogTaskId);if(!task){closeTimeDialog();return}const state=updateTimeDialogUI({showValidationError:true});if(!state.valid){return}timeDialogSaving=true;updateTimeDialogUI({preserveError:true});setTimeDialogError('');setTimeUpdatePending(task.id,true);saveTaskTimeMinutes(task.id,state.totalMinutes,{showSuccessToast:true}).then(()=>{timeDialogDeferredTimerSyncTaskId=null;closeTimeDialog({syncDeferred:false})}).catch(()=>{setTimeDialogError('Не удалось сохранить. Проверь соединение и попробуй ещё раз.')}).finally(()=>{timeDialogSaving=false;setTimeUpdatePending(task.id,false);updateTimeDialogUI({preserveError:true});updateTimerDisplays()})}
function initTimeDialogPresets(){if(!TimeDialog.presets)return;TimeDialog.presets.innerHTML='';for(const delta of TIME_PRESETS){const btn=document.createElement('button');btn.type='button';btn.className='time-preset-btn';btn.textContent=formatPresetLabel(delta);btn.title=`Добавить ${formatDuration(minutesToMs(delta))}`;btn.onclick=e=>{e.preventDefault();applyTimeDialogPreset(delta)};TimeDialog.presets.appendChild(btn)}}
window.addEventListener('click',e=>{
  if(Due.el&&Due.el.style.display==='block'&&Due.el.dataset.fromContext==='true'){
    if(Due.el.contains(e.target))return;
    const anchor=Due.anchor;
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
window.addEventListener('keydown',e=>{
  if(e.key==='Escape'){
    closeContextMenu();
    closeTimePresetMenu();
    closeYearPlanContextMenu();
    closeNotesPanel();
    closeDuePicker();
    closeWorkdayDialog();
    closeProjectDeleteDialog();
    closeTimeDialog();
  }
  if(YearPlanCtx.el.style.display==='block'&&(e.key==='p'||e.key==='P'||e.code==='KeyP')){
    const itemId=YearPlanCtx.activityId;
    const item=itemId?findYearPlanItem(itemId):null;
    const projectId=item?item.projectId:null;
    if(projectId){
      e.preventDefault();
      closeYearPlanContextMenu();
      currentView='project';
      currentProjectId=projectId;
      render();
    }
  }
  if((e.key==='Delete'||e.key==='Backspace')&&currentView==='year'&&yearPlanSelectedId){
    const active=document.activeElement;
    const isInputActive=active&&(active.tagName==='INPUT'||active.tagName==='TEXTAREA'||active.isContentEditable);
    if(yearPlanEditingId||isInputActive)return;
    e.preventDefault();
    deleteYearPlanItem(yearPlanSelectedId);
  }
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
NotesPanel.input&&NotesPanel.input.addEventListener('input',()=>{if(NotesPanel.mode==='archive')return;if(!NotesPanel.taskId)return;const task=findTask(NotesPanel.taskId);if(!task)return;task.notes=NotesPanel.input.value;Store.write(tasks);if(isServerMode())queueTaskUpdate(task.id,{notes:task.notes},{debounce:true});updateNoteIndicator(task.id)});

TimeDialog.overlay&&TimeDialog.overlay.addEventListener('click',e=>{if(e.target===TimeDialog.overlay)closeTimeDialog()});
TimeDialog.close&&TimeDialog.close.addEventListener('click',()=>closeTimeDialog());
TimeDialog.cancel&&TimeDialog.cancel.addEventListener('click',()=>closeTimeDialog());
TimeDialog.form&&TimeDialog.form.addEventListener('submit',e=>{e.preventDefault();submitTimeDialog()});
for(const input of[TimeDialog.hours,TimeDialog.minutes]){if(!input)continue;input.addEventListener('input',()=>updateTimeDialogUI());input.addEventListener('blur',()=>{const state=getTimeDialogState();if(state.valid)setTimeDialogInputsFromMinutes(state.totalMinutes);updateTimeDialogUI({showValidationError:true})})}
initTimeDialogPresets();


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
  navigateToProject:(projectId)=>{currentView='project';currentProjectId=projectId;render()},
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
  getArchivedTasks: () => archivedTasks,
  setArchivedTasks: (arr) => { archivedTasks = arr; },
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
  archiveCompletedTasks,
  normalizeArchivedNode,
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
  setCurrentView: (v) => { currentView = v; },
  getCurrentProjectId: () => currentProjectId,
  setCurrentProjectId: (id) => { currentProjectId = id; },
});
initProjects();
registerArchiveCallbacks({
  formatDuration,
  formatTimeHM,
  formatDateDMY,
  formatDue,
  openNotesPanel,
  getArchivedTasks: () => archivedTasks,
  getCurrentView: () => currentView,
  render,
});
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
function render(){
  $$('.nav-btn').forEach(b=>b.classList.toggle('is-active',b.dataset.view===currentView));
  if(archiveBtn)archiveBtn.classList.toggle('is-active',currentView==='archive');
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
    const hide=currentView==='sprint'||currentView==='archive'||currentView==='year';
    if(composer.hidden!==hide)composer.hidden=hide;
    composer.setAttribute('aria-hidden',hide?'true':'false');
    document.body.classList.toggle('view-sprint',currentView==='sprint');
  }
  document.body.classList.toggle('view-archive',currentView==='archive');
  document.body.classList.toggle('view-year',currentView==='year');
  const wrap=$('#tasks');wrap.innerHTML='';
  wrap.classList.toggle('is-project-view',currentView==='project');
  if(currentView==='archive'){document.getElementById('viewTitle').textContent='Архив';renderArchive(wrap);updateWorkdayUI();return}
  if(currentView==='sprint'){document.getElementById('viewTitle').textContent='Спринт';renderSprint(wrap);syncTimerLoop();return}
  if(currentView==='year'){document.getElementById('viewTitle').textContent='План года';renderYearPlan(wrap);updateWorkdayUI();return}
  if(currentView==='project'){
    const proj=projects.find(p=>p.id===currentProjectId);
    document.getElementById('viewTitle').textContent=proj?proj.title:'Проект';
    const layout=document.createElement('div');
    layout.className='project-layout';
    const tasksWrap=document.createElement('div');
    tasksWrap.className='project-tasks';
    const yearSide=document.createElement('div');
    yearSide.className='year-side';
    const yearHeader=document.createElement('div');
    yearHeader.className='year-side-header';
    yearHeader.textContent='Год';
    const yearList=document.createElement('div');
    yearList.className='year-side-list';
    yearSide.append(yearHeader,yearList);
    layout.append(tasksWrap,yearSide);
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
      status.textContent='Нет инициатив';
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
          currentView='year';
          render();
        };
        yearList.appendChild(row);
      }
    }
    const dataList=filterTree(tasks,t=>t.project===currentProjectId);
    const renderContext=buildRenderContext(dataList);
    if(!dataList.length){
      const empty=document.createElement('div');
      empty.className='task';
      empty.innerHTML='<div></div><div class="task-title">Нет задач этого проекта.</div><div></div>';
      tasksWrap.appendChild(empty);
      syncTimerLoop();
      return;
    }
    for(const t of dataList){renderTaskRow(t,0,tasksWrap,renderContext)}
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
  const renderContext=buildRenderContext(dataList);
  if(!dataList.length){const empty=document.createElement('div');empty.className='task';empty.innerHTML='<div></div><div class="task-title">Здесь пусто.</div><div></div>';wrap.appendChild(empty);syncTimerLoop();return}
  for(const t of dataList){renderTaskRow(t,0,wrap,renderContext)}
  if(pendingEditId){const rowEl=document.querySelector(`[data-id="${pendingEditId}"]`);const taskObj=findTask(pendingEditId);if(rowEl&&taskObj)startEdit(rowEl,taskObj);pendingEditId=null}
  if(hoveredParentTaskId)setInheritedHover(hoveredParentTaskId);
  syncTimerLoop();
  updateWorkdayUI()
}


function applyTheme(mode){const dark=mode==='dark';document.body.classList.toggle('theme-dark',dark);document.body.setAttribute('data-theme',dark?'dark':'light');const btn=$('#themeToggle');if(btn){const label=dark?'Переключить на светлую тему':'Переключить на тёмную тему';btn.dataset.mode=dark?'dark':'light';btn.setAttribute('aria-pressed',String(dark));btn.setAttribute('aria-label',label);btn.title=label}}
const themeToggle=$('#themeToggle');
function toggleTheme(){const dark=!document.body.classList.contains('theme-dark');applyTheme(dark?'dark':'light');ThemeStore.write(dark?'dark':'light')}
if(themeToggle){themeToggle.addEventListener('click',toggleTheme)}

const cal={track:null,curr:null,nextbuf:null,title:null,legend:null,toggle:null,prev:null,next:null,today:null,month:null,year:null,collapsed:false,focusDate:null,monthWeeks:[],activeWeekIndex:0};
const archiveBtn=document.getElementById('archiveBtn');
function normalizeDate(value){const d=new Date(value);d.setHours(0,0,0,0);return d}
function sameDay(a,b){return!!(a&&b)&&a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate()}
function isoWeekNumber(d){const date=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));const dayNum=(date.getUTCDay()+6)%7;date.setUTCDate(date.getUTCDate()-dayNum+3);const firstThursday=new Date(Date.UTC(date.getUTCFullYear(),0,4));const diff=date-firstThursday;return 1+Math.round(diff/(7*24*3600*1000))}
function buildMonthMatrix(y,m,{minVisibleDays=1,maxWeeks=6}={}){const first=new Date(y,m,1);const startDay=(first.getDay()+6)%7;const weeks=[];let day=1-startDay;const today=normalizeDate(new Date());while(true){const week={weekNum:null,days:[]};for(let i=0;i<7;i++){const d=new Date(y,m,day);const inMonth=d.getMonth()===m;const isToday=sameDay(d,today);week.days.push({d,inMonth,isToday});day++}const thursday=new Date(week.days[3].d);week.weekNum=isoWeekNumber(thursday);weeks.push(week);const lastDay=week.days[6].d;if(lastDay.getMonth()>m||(y<lastDay.getFullYear()&&lastDay.getMonth()===0))break;if(weeks.length>6)break}const countInMonth=week=>week.days.reduce((acc,cell)=>acc+(cell.inMonth?1:0),0);while(weeks.length&&countInMonth(weeks[0])<minVisibleDays)weeks.shift();while(weeks.length&&countInMonth(weeks[weeks.length-1])<minVisibleDays)weeks.pop();if(maxWeeks&&weeks.length>maxWeeks){while(weeks.length>maxWeeks){const firstCount=countInMonth(weeks[0]);const lastCount=countInMonth(weeks[weeks.length-1]);if(firstCount<=lastCount){weeks.shift()}else{weeks.pop()}}}return weeks}
function renderMonthInto(container,y,m,options){const weeks=buildMonthMatrix(y,m,options);const wrap=document.createElement('div');wrap.className='cal-grid';weeks.forEach(week=>{const row=document.createElement('div');row.className='cal-week';const wn=document.createElement('div');wn.className='cal-weeknum';wn.textContent=String(week.weekNum).padStart(2,'0');row.appendChild(wn);for(const cell of week.days){const el=document.createElement('div');el.className='cal-day';if(!cell.inMonth)el.classList.add('is-out');if(cell.isToday)el.classList.add('is-today');el.textContent=cell.d.getDate();row.appendChild(el)}wrap.appendChild(row)});container.innerHTML='';container.appendChild(wrap);return weeks}
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
function monthTitle(y,m){return`${MONTH_NAMES[m]} ${y}`}
function weekTitle(date){const info=isoWeekInfo(date);return`Неделя ${String(info.week).padStart(2,'0')} · ${monthTitle(date.getFullYear(),date.getMonth())}`}
function findWeekIndexForDate(weeks,date){if(!date)return-1;for(let i=0;i<weeks.length;i++){if(weeks[i].days.some(cell=>sameDay(cell.d,date)))return i}return-1}
function ensureFocusDateVisible(weeks){if(!cal.focusDate)return;if(findWeekIndexForDate(weeks,cal.focusDate)!==-1)return;for(const week of weeks){const inMonthDay=week.days.find(cell=>cell.inMonth);if(inMonthDay){cal.focusDate=normalizeDate(inMonthDay.d);return}}}
function highlightWeeks(){if(!cal.curr)return;const weekEls=cal.curr.querySelectorAll('.cal-week');weekEls.forEach((el,idx)=>{el.classList.toggle('is-active',idx===cal.activeWeekIndex)})}
function applyCollapsedState(){const root=document.getElementById('calendar');if(!root)return;root.classList.toggle('is-collapsed',cal.collapsed);if(cal.legend)cal.legend.setAttribute('aria-hidden',cal.collapsed?'true':'false');highlightWeeks();if(cal.prev){const prevLabel=cal.collapsed?'Предыдущая неделя':'Предыдущий месяц';cal.prev.setAttribute('aria-label',prevLabel);cal.prev.title=prevLabel}if(cal.next){const nextLabel=cal.collapsed?'Следующая неделя':'Следующий месяц';cal.next.setAttribute('aria-label',nextLabel);cal.next.title=nextLabel}if(cal.today){const todayLabel=cal.collapsed?'Текущая неделя':'Текущий месяц';const todayTitle=cal.collapsed?'Перейти к текущей неделе':'Перейти к текущему месяцу';cal.today.setAttribute('aria-label',todayLabel);cal.today.title=todayTitle}if(cal.toggle){const toggleLabel=cal.collapsed?'Развернуть календарь':'Свернуть календарь';cal.toggle.setAttribute('aria-pressed',cal.collapsed?'true':'false');cal.toggle.setAttribute('aria-label',toggleLabel);cal.toggle.title=toggleLabel;cal.toggle.textContent=cal.collapsed?'▴':'▾'}}
function updateCalendarTitle(){if(!cal.title)return;const baseDate=cal.focusDate||new Date(cal.year||new Date().getFullYear(),cal.month||0,1);cal.title.textContent=cal.collapsed?weekTitle(baseDate):monthTitle(cal.year,cal.month)}
function setMonth(y,m,{animateDir=null,focusDate=null,keepFocus=false}={}){let targetFocus=focusDate?normalizeDate(focusDate):cal.focusDate;if((!targetFocus||(targetFocus.getFullYear()!==y||targetFocus.getMonth()!==m))&&!keepFocus){targetFocus=new Date(y,m,1);targetFocus=normalizeDate(targetFocus)}cal.focusDate=targetFocus;if(animateDir&&!cal.collapsed){const weeks=renderMonthInto(cal.nextbuf,y,m,{minVisibleDays:2,maxWeeks:5});cal.track.style.transition='none';cal.track.style.transform=animateDir>0?'translateX(0%)':'translateX(-100%)';requestAnimationFrame(()=>{requestAnimationFrame(()=>{cal.track.style.transition='transform .24s ease';cal.track.style.transform=animateDir>0?'translateX(-100%)':'translateX(0%)'})});const onEnd=()=>{cal.track.removeEventListener('transitionend',onEnd);cal.curr.innerHTML=cal.nextbuf.innerHTML;cal.track.style.transition='none';cal.track.style.transform='translateX(0%)';cal.year=y;cal.month=m;cal.monthWeeks=weeks;ensureFocusDateVisible(cal.monthWeeks);cal.activeWeekIndex=findWeekIndexForDate(cal.monthWeeks,cal.focusDate);if(cal.activeWeekIndex===-1)cal.activeWeekIndex=0;applyCollapsedState();updateCalendarTitle()};cal.track.addEventListener('transitionend',onEnd,{once:true})}else{const weeks=renderMonthInto(cal.curr,y,m,{minVisibleDays:2,maxWeeks:5});cal.year=y;cal.month=m;cal.monthWeeks=weeks;ensureFocusDateVisible(cal.monthWeeks);cal.activeWeekIndex=findWeekIndexForDate(cal.monthWeeks,cal.focusDate);if(cal.activeWeekIndex===-1)cal.activeWeekIndex=0;if(cal.track){cal.track.style.transition='none';cal.track.style.transform='translateX(0%)';}applyCollapsedState();updateCalendarTitle()}}
function setFocusDate(date){const normalized=normalizeDate(date);cal.focusDate=normalized;const fy=normalized.getFullYear();const fm=normalized.getMonth();if(fy!==cal.year||fm!==cal.month){setMonth(fy,fm,{focusDate:normalized})}else{ensureFocusDateVisible(cal.monthWeeks);cal.activeWeekIndex=findWeekIndexForDate(cal.monthWeeks,cal.focusDate);if(cal.activeWeekIndex===-1)cal.activeWeekIndex=0;applyCollapsedState();updateCalendarTitle()}}
function shiftMonth(dir){let y=cal.year,m=cal.month+dir;if(m<0){m=11;y--}else if(m>11){m=0;y++}setMonth(y,m,{animateDir:dir,focusDate:new Date(y,m,1)})}
function shiftWeek(dir){if(!cal.focusDate)cal.focusDate=normalizeDate(new Date(cal.year,cal.month,1));const nextDate=new Date(cal.focusDate);nextDate.setDate(nextDate.getDate()+dir*7);setFocusDate(nextDate)}
function jumpToToday(){const now=normalizeDate(new Date());if(cal.collapsed){setFocusDate(now);return}const ty=now.getFullYear();const tm=now.getMonth();const dir=ty===cal.year&&tm===cal.month?null:(ty>cal.year||(ty===cal.year&&tm>cal.month))?1:-1;setMonth(ty,tm,{animateDir:dir,focusDate:now})}
function setCollapsed(state){const nextState=!!state;if(cal.collapsed===nextState)return;cal.collapsed=nextState;if(!cal.focusDate){cal.focusDate=normalizeDate(new Date(cal.year||new Date().getFullYear(),cal.month||0,1))}if(!cal.collapsed){const fy=cal.focusDate.getFullYear();const fm=cal.focusDate.getMonth();if(fy!==cal.year||fm!==cal.month){setMonth(fy,fm,{focusDate:cal.focusDate});return}}applyCollapsedState();updateCalendarTitle()}
function initCalendar(){cal.track=$('#calTrack');cal.curr=$('#calCurr');cal.nextbuf=$('#calNextBuf');cal.title=$('#calTitle');cal.legend=document.querySelector('#calendar .cal-legend');cal.toggle=$('#calToggle');cal.prev=$('#calPrev');cal.next=$('#calNext');cal.today=$('#calToday');const now=normalizeDate(new Date());cal.month=now.getMonth();cal.year=now.getFullYear();cal.focusDate=now;setMonth(cal.year,cal.month,{focusDate:now});applyCollapsedState();if(cal.prev)cal.prev.addEventListener('click',()=>{cal.collapsed?shiftWeek(-1):shiftMonth(-1)});if(cal.next)cal.next.addEventListener('click',()=>{cal.collapsed?shiftWeek(1):shiftMonth(1)});if(cal.today)cal.today.addEventListener('click',()=>jumpToToday());if(cal.toggle)cal.toggle.addEventListener('click',()=>setCollapsed(!cal.collapsed))}

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
$$('.nav-btn').forEach(btn=>btn.onclick=()=>{const view=btn.dataset.view;if(view==='today'){currentView='today';render();return}if(view==='sprint'){currentView='sprint';render();return}if(view==='year'){currentView='year';render();return}currentView='all';render()});
if(archiveBtn){archiveBtn.addEventListener('click',()=>{currentView='archive';render()})}

const storageToggleBtn=document.getElementById('storageToggle');
if(storageToggleBtn){storageToggleBtn.addEventListener('click',async()=>{if(isDataLoading)return;const switchingToServer=!isServerMode();updateStorageToggle({loading:true});try{if(!switchingToServer){await setStorageModeAndReload(STORAGE_MODES.LOCAL,{forceReload:true,skipToggleUpdate:true});toast('Режим: localStorage');return}await setStorageModeAndReload(STORAGE_MODES.SERVER,{forceReload:true,skipToggleUpdate:true});const key=ApiKeyStore.read();if(!key){lockApiAuth('missing','Нужен API key для доступа к API');return}toast('Режим: API')}catch(err){console.error(err);if(switchingToServer){lockApiAuth('network','API недоступен')}}finally{updateStorageToggle({loading:false})}})}

if(ApiSettingsUI.openBtn){ApiSettingsUI.openBtn.addEventListener('click',()=>{const needsKey=isServerMode()&&!ApiKeyStore.read();const shouldBlock=needsKey||apiAuthLocked;const reason=apiAuthReason||(needsKey?'missing':null);openApiSettings({blocking:shouldBlock,reason,message:apiAuthMessage||null})})}
if(ApiSettingsUI.closeBtn){ApiSettingsUI.closeBtn.addEventListener('click',()=>closeApiSettings())}
if(ApiSettingsUI.overlay){ApiSettingsUI.overlay.addEventListener('click',e=>{if(e.target===ApiSettingsUI.overlay&&!apiSettingsBlocking)closeApiSettings()})}
if(ApiSettingsUI.toggle){ApiSettingsUI.toggle.addEventListener('click',toggleApiKeyVisibility)}
if(ApiSettingsUI.form){ApiSettingsUI.form.addEventListener('submit',saveApiKey)}
if(ApiSettingsUI.clearBtn){ApiSettingsUI.clearBtn.addEventListener('click',clearApiKey)}
if(ApiSettingsUI.toLocalBtn){ApiSettingsUI.toLocalBtn.addEventListener('click',()=>switchToLocalMode())}
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&isApiSettingsOpen()&&!apiSettingsBlocking){closeApiSettings()}});

if(WorkdayUI.button){WorkdayUI.button.addEventListener('click',()=>{if(WorkdayUI.button.disabled)return;openWorkdayDialog()})}
if(WorkdayUI.closeBtn){WorkdayUI.closeBtn.setAttribute('data-allow-closed-day','true');WorkdayUI.closeBtn.addEventListener('click',()=>closeWorkdayDialog());}
if(WorkdayUI.closeAction)WorkdayUI.closeAction.addEventListener('click',()=>finishWorkdayAndArchive());
if(WorkdayUI.overlay)WorkdayUI.overlay.addEventListener('click',e=>{if(e.target===WorkdayUI.overlay)closeWorkdayDialog()});
if(WorkdayUI.postponeBtn)WorkdayUI.postponeBtn.addEventListener('click',()=>postponePendingTasks());


document.addEventListener('keydown',e=>{
  if(isEditableShortcutTarget(e.target))return;
  if(e.key==='Tab'&&selectedTaskId){e.preventDefault();addSubtask(selectedTaskId);return}
  if((e.key==='Backspace'||e.key==='Delete')&&selectedTaskId){e.preventDefault();handleDelete(selectedTaskId,{visibleOrder:getVisibleTaskIds()})}
});

document.addEventListener('keydown',e=>{
  if(!selectedTaskId)return;
  if(isEditableShortcutTarget(e.target))return;
  if(e.metaKey||e.ctrlKey||e.altKey)return;
  const row=getTaskRowById(selectedTaskId);
  if(e.code==='KeyD'){
    const anchor=row?row.querySelector('.due-btn'):null;
    e.preventDefault();
    openDuePicker(selectedTaskId,anchor||null);
    return;
  }
  if(e.code==='KeyF'){
    e.preventDefault();
    toggleTask(selectedTaskId);
    return;
  }
  if(e.code==='KeyR'){
    e.preventDefault();
    toggleTaskTimer(selectedTaskId);
    return;
  }
  if(e.code==='KeyC'){
    e.preventDefault();
    openNotesPanel(selectedTaskId);
    return;
  }
  if(e.code==='KeyT'){
    e.preventDefault();
    openTimeEditDialog(selectedTaskId);
  }
});

if(!tasks.length&&!isServerMode()){const rootId=uid();const childId=uid();setTasks([{id:rootId,title:'Добавь несколько задач',done:false,collapsed:false,due:null,project:null,notes:'',timeSpent:0,timerActive:false,timerStart:null,parentId:null,children:[{id:childId,title:'Пример подзадачи',done:false,collapsed:false,due:null,project:null,notes:'',timeSpent:0,timerActive:false,timerStart:null,parentId:rootId,children:[]} ]},{id:uid(),title:'ПКМ по строке → «Редактировать»',done:false,collapsed:false,due:null,project:null,notes:'',timeSpent:0,timerActive:false,timerStart:null,parentId:null,children:[]},{id:uid(),title:'Отметь как выполненную — увидишь зачёркивание',done:true,collapsed:false,due:null,project:null,notes:'',timeSpent:0,timerActive:false,timerStart:null,parentId:null,children:[] }]);ensureTaskParentIds(tasks,null);Store.write(tasks)}
if(!projects.length&&!isServerMode()){setProjects([{id:uid(),title:'Личный',emoji:DEFAULT_PROJECT_EMOJI},{id:uid(),title:'Работа',emoji:'💼'}]);ProjectsStore.write(projects)}

renderProjects();

function sprintProjectKey(id){return id==null?SPRINT_UNASSIGNED_KEY:id}
function isSprintProjectVisible(projectId){const key=sprintProjectKey(projectId);return!sprintVisibleProjects.has(key)||sprintVisibleProjects.get(key)!==false}
function syncSprintFilterState(keys){const set=new Set(keys);for(const key of keys){if(!sprintVisibleProjects.has(key))sprintVisibleProjects.set(key,true)}for(const key of Array.from(sprintVisibleProjects.keys())){if(!set.has(key))sprintVisibleProjects.delete(key)}}
function clearSprintFiltersUI(){const bar=document.getElementById('sprintFilters');if(!bar)return;bar.innerHTML='';bar.classList.remove('is-active');bar.setAttribute('aria-hidden','true')}
function renderSprintFiltersBar(entries){
  const bar=document.getElementById('sprintFilters');
  if(!bar)return;
  bar.innerHTML='';
  if(!entries.length){
    bar.classList.remove('is-active');
    bar.setAttribute('aria-hidden','true');
    return
  }
  bar.classList.add('is-active');
  bar.setAttribute('aria-hidden','false');
  for(const entry of entries){
    const active=isSprintProjectVisible(entry.projectId);
    const btn=document.createElement('button');
    btn.type='button';
    btn.className='sprint-filter-btn'+(active?' is-active':'');
    btn.setAttribute('aria-pressed',active?'true':'false');
    btn.dataset.projectKey=entry.key;
    btn.title=active?'Скрыть задачи проекта в спринте':'Показать задачи проекта в спринте';
    const emoji=document.createElement('span');
    emoji.className='sprint-filter-emoji';
    emoji.textContent=entry.emoji;
    const title=document.createElement('span');
    title.className='sprint-filter-title';
    title.textContent=entry.title;
    btn.append(emoji,title);
    btn.onclick=()=>{
      const key=entry.key;
      const next=!isSprintProjectVisible(entry.projectId);
      sprintVisibleProjects.set(key,next);
      render()
    };
    bar.appendChild(btn)
  }
}

try{console.assert(monthTitle(2025,0)==='Январь 2025');const weeks=buildMonthMatrix(2025,0,{minVisibleDays:2,maxWeeks:5});console.assert(weeks.length>=4&&weeks.length<=5);console.assert(rowClass({collapsed:false,done:false,id:'x'})==='task');const sprintSample=buildSprintData([{id:'a',title:'t',due:new Date().toISOString(),children:[]}]);console.assert(Array.isArray(sprintSample));}catch(e){console.warn('Self-tests failed:',e)}

function isoWeekStartDate(year,week){const simple=new Date(year,0,4);const day=(simple.getDay()+6)%7;const monday=new Date(simple);monday.setDate(simple.getDate()-day+(week-1)*7);return normalizeDate(monday)}
function buildSprintData(list){const map=new Map();function visit(t){if(t.due){const d=new Date(t.due);if(!isNaN(d)){const wd=d.getDay();if(wd>=1&&wd<=5){const{week,year}=isoWeekInfo(d);const key=year+':'+week;if(!map.has(key))map.set(key,{week,year,startDate:isoWeekStartDate(year,week),days:{1:[],2:[],3:[],4:[],5:[]}});map.get(key).days[wd].push(t)}}}for(const c of t.children||[])visit(c)}for(const t of list)visit(t);return Array.from(map.values()).sort((a,b)=>a.year===b.year?a.week-b.week:a.year-b.year)}
function renderSprint(container){
  const sprints=buildSprintData(tasks);
  if(!sprints.length){
    renderSprintFiltersBar([]);
    sprintVisibleProjects.clear();
    const hint=document.createElement('div');
    hint.className='sprint-empty';
    hint.textContent='Нет задач с дедлайном — спринты появятся автоматически.';
    container.appendChild(hint);
    return
  }
  const projectMap=new Map();
  for(const sp of sprints){
    for(let i=1;i<=5;i++){
      for(const task of sp.days[i]||[]){
        const key=sprintProjectKey(task.project);
        if(!projectMap.has(key)){
          const meta=getProjectMeta(task.project);
          projectMap.set(key,{key,projectId:task.project??null,emoji:meta.emoji,title:meta.title})
        }
      }
    }
  }
  const projectEntries=Array.from(projectMap.values());
  syncSprintFilterState(projectEntries.map(entry=>entry.key));
  renderSprintFiltersBar(projectEntries);
  const todayDate=normalizeDate(new Date());
  const wrap=document.createElement('div');
  wrap.className='sprint';
  const dayNames=['Пн','Вт','Ср','Чт','Пт'];
  let renderedWeeks=0;
  for(const sp of sprints){
    const hasVisibleTasks=[1,2,3,4,5].some(idx=>(sp.days[idx]||[]).some(task=>isSprintProjectVisible(task.project)));
    if(!hasVisibleTasks)continue;
    renderedWeeks++;
    const row=document.createElement('div');
    row.className='sprint-row';
    const label=document.createElement('div');
    label.className='sprint-week';
    label.textContent='Неделя '+String(sp.week).padStart(2,'0');
    const grid=document.createElement('div');
    grid.className='sprint-grid';
    const startDate=sp.startDate?new Date(sp.startDate):isoWeekStartDate(sp.year,sp.week);
    for(let i=1;i<=5;i++){
      const col=document.createElement('div');
      col.className='sprint-col';
      const title=document.createElement('div');
      title.className='col-title';
      const dayDate=new Date(startDate);
      dayDate.setDate(dayDate.getDate()+i-1);
      dayDate.setHours(0,0,0,0);
      const dd=String(dayDate.getDate()).padStart(2,'0');
      const mm=String(dayDate.getMonth()+1).padStart(2,'0');
      title.textContent=`${dayNames[i-1]} ${dd}.${mm}`;
      col.dataset.date=dayDate.toISOString();
      if(sameDay(dayDate,todayDate))col.classList.add('is-today');
      col.appendChild(title);
      col.addEventListener('dragenter',e=>{if(!sprintDraggingId)return;const rel=e.relatedTarget;if(rel&&col.contains(rel))return;setSprintDropColumn(col)});
      col.addEventListener('dragover',e=>{if(!sprintDraggingId)return;e.preventDefault();if(e.dataTransfer)e.dataTransfer.dropEffect='move';setSprintDropColumn(col)});
      col.addEventListener('dragleave',e=>{if(!sprintDraggingId)return;const rel=e.relatedTarget;if(rel&&col.contains(rel))return;setSprintDropColumn(null)});
      col.addEventListener('drop',e=>{if(!sprintDraggingId)return;e.preventDefault();const targetDate=col.dataset.date;if(targetDate)applySprintDrop(targetDate);else clearSprintDragState()});
      const items=sp.days[i]||[];
      const visibleItems=items.filter(task=>isSprintProjectVisible(task.project));
      if(!visibleItems.length){
        const empty=document.createElement('div');
        empty.className='sprint-empty';
        empty.textContent='—';
        col.appendChild(empty);
        grid.appendChild(col);
        continue
      }
      const groups=[];const map=new Map();
      for(const t of visibleItems){const key=sprintProjectKey(t.project);if(!map.has(key)){const meta=getProjectMeta(t.project);const group={id:key,emoji:meta.emoji,title:meta.title,tasks:[]};map.set(key,group);groups.push(group)}map.get(key).tasks.push(t)}
      for(const grp of groups){
        const groupEl=document.createElement('div');
        groupEl.className='sprint-project-group';
        const tag=document.createElement('div');
        tag.className='sprint-project-tag';
        const emoji=document.createElement('span');
        emoji.className='sprint-project-emoji';
        emoji.textContent=grp.emoji;
        const name=document.createElement('span');
        name.className='sprint-project-name';
        name.textContent=grp.title;
        tag.append(emoji,name);
        groupEl.appendChild(tag);
        for(const t of grp.tasks){
          const it=document.createElement('div');
          it.className='sprint-task';
          it.setAttribute('draggable','true');
          if(t.done)it.classList.add('is-done');
          it.addEventListener('dragstart',e=>{sprintDraggingId=t.id;it.classList.add('is-dragging');setSprintDropColumn(null);try{e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',t.id)}catch{}closeContextMenu();closeDuePicker()});
          it.addEventListener('dragend',()=>{clearSprintDragState()});
          it.addEventListener('contextmenu',e=>{e.preventDefault();openContextMenu(t.id,e.clientX,e.clientY)});
          const taskTitle=document.createElement('div');
          taskTitle.className='sprint-task-title';
          taskTitle.textContent=t.title;
          it.append(taskTitle);
          groupEl.appendChild(it)
        }
        col.appendChild(groupEl)
      }
      grid.appendChild(col)
    }
    row.append(label,grid);
    wrap.appendChild(row)
  }
  if(renderedWeeks===0){
    const empty=document.createElement('div');
    empty.className='sprint-empty';
    empty.textContent='Нет задач для выбранных проектов.';
    container.appendChild(empty);
    return
  }
  container.appendChild(wrap)
}

function formatDue(iso){const d=new Date(iso);if(isNaN(d))return'';const dd=String(d.getDate()).padStart(2,'0');const mm=String(d.getMonth()+1).padStart(2,'0');return`${dd}.${mm}`}

const Due={el:document.getElementById('dueMenu'),taskId:null,y:null,m:null,anchor:null};
if(Due.el){Due.el.dataset.fromContext='false';Due.el.addEventListener('mouseleave',()=>{if(Due.el.dataset.fromContext==='true'){setTimeout(()=>{const anchor=Due.anchor;if(anchor&&anchor.matches(':hover'))return;if(Due.el.matches(':hover'))return;closeDuePicker()},80)}})}
let duePickerMinWidth=null;
function ensureDuePickerWidth(container){if(!container)return;if(duePickerMinWidth!==null){container.style.width=`${duePickerMinWidth}px`;return;}const title=container.querySelector('.cal-title');if(!title)return;const original=title.textContent;const prevVisibility=container.style.visibility;container.style.visibility='hidden';const sampleYear='8888';let maxWidth=Math.ceil(container.offsetWidth);for(const monthName of MONTH_NAMES){title.textContent=`${monthName} ${sampleYear}`;const width=Math.ceil(container.offsetWidth);if(width>maxWidth)maxWidth=width}title.textContent=original;if(prevVisibility)container.style.visibility=prevVisibility;else container.style.removeProperty('visibility');duePickerMinWidth=maxWidth;container.style.width=`${duePickerMinWidth}px`}
function buildDuePicker(y,m){const cont=document.createElement('div');cont.className='due-picker';const header=document.createElement('div');header.className='cal-header';const todayBtn=document.createElement('button');todayBtn.className='cal-today';todayBtn.title='К текущему месяцу';const title=document.createElement('div');title.className='cal-title';title.textContent=monthTitle(y,m);const ctrls=document.createElement('div');ctrls.className='cal-ctrls';const prev=document.createElement('button');prev.className='cal-arrow';prev.textContent='‹';const next=document.createElement('button');next.className='cal-arrow';next.textContent='›';header.append(todayBtn,title,ctrls);ctrls.append(prev,next);const legend=document.createElement('div');legend.className='cal-legend';legend.innerHTML='<div>Wk</div><div>Пн</div><div>Вт</div><div>Ср</div><div>Чт</div><div>Пт</div><div>Сб</div><div>Вс</div>';const viewport=document.createElement('div');viewport.className='cal-viewport';const monthEl=document.createElement('div');monthEl.className='cal-month';const track=document.createElement('div');track.className='cal-track';track.appendChild(monthEl);viewport.appendChild(track);cont.append(header,legend,viewport);function renderLocal(){renderMonthInto(monthEl,Due.y,Due.m);title.textContent=monthTitle(Due.y,Due.m)}prev.onclick=()=>{let ny=Due.y,nm=Due.m-1;if(nm<0){nm=11;ny--}Due.y=ny;Due.m=nm;renderLocal()};next.onclick=()=>{let ny=Due.y,nm=Due.m+1;if(nm>11){nm=0;ny++}Due.y=ny;Due.m=nm;renderLocal()};todayBtn.onclick=()=>{const now=new Date();Due.y=now.getFullYear();Due.m=now.getMonth();renderLocal()};renderLocal();cont.addEventListener('click',e=>{const dayEl=e.target.closest('.cal-day');if(!dayEl)return;const day=Number(dayEl.textContent);if(!Number.isFinite(day))return;const d=new Date(Due.y,Due.m,day);if(isNaN(d))return;d.setHours(0,0,0,0);const iso=d.toISOString();const t=findTask(Due.taskId);if(!t)return;t.due=iso;Store.write(tasks);if(isServerMode())queueTaskUpdate(t.id,{due:iso});if(Due.el&&Due.el.dataset.fromContext==='true')closeContextMenu();closeDuePicker();render()});return cont}
function openDuePicker(taskId,anchor,options={}){
  Due.taskId=taskId;
  if(Due.anchor&&Due.anchor!==anchor&&Due.anchor.classList){Due.anchor.classList.remove('is-submenu-open')}
  Due.anchor=anchor||null;
  const existing=findTask(taskId);
  if(existing&&existing.due){
    const dueDate=new Date(existing.due);
    if(!isNaN(dueDate)){
      Due.y=dueDate.getFullYear();
      Due.m=dueDate.getMonth();
    }else{
      const now=new Date();
      Due.y=now.getFullYear();
      Due.m=now.getMonth();
    }
  }else{
    const now=new Date();
    Due.y=now.getFullYear();
    Due.m=now.getMonth();
  }
  const menu=Due.el;
  if(!menu)return;
  menu.innerHTML='';
  const content=buildDuePicker(Due.y,Due.m);
  menu.appendChild(content);
  menu.style.display='block';
  menu.setAttribute('aria-hidden','false');
  ensureDuePickerWidth(content);
  if(content.style.width){
    menu.style.minWidth=content.style.width;
    menu.style.width=content.style.width;
  }else{
    menu.style.removeProperty('min-width');
    menu.style.removeProperty('width');
  }
  const fromContext=!!options.fromContext;
  menu.dataset.fromContext=fromContext?'true':'false';
  if(fromContext&&anchor&&anchor.classList){anchor.classList.add('is-submenu-open')}
  const r=anchor&&anchor.getBoundingClientRect?anchor.getBoundingClientRect():{left:0,right:0,top:0,bottom:0};
  menu.style.position='fixed';
  const mw=menu.offsetWidth||(duePickerMinWidth||300);
  const mh=menu.offsetHeight||320;
  if(fromContext){
    let px=r.right+8;
    let py=r.top;
    if(px+mw>window.innerWidth-8)px=Math.max(8,window.innerWidth-mw-8);
    if(py+mh>window.innerHeight-8)py=Math.max(8,window.innerHeight-mh-8);
    menu.style.left=px+'px';
    menu.style.top=py+'px';
  }else{
    const px=Math.min(r.left,window.innerWidth-mw-8);
    let py=r.bottom+6;
    if(py+mh>window.innerHeight-8)py=Math.max(8,window.innerHeight-mh-8);
    menu.style.left=px+'px';
    menu.style.top=py+'px';
  }
}
function closeDuePicker(){
  if(Due.anchor&&Due.anchor.classList){Due.anchor.classList.remove('is-submenu-open')}
  Due.taskId=null;
  Due.anchor=null;
  if(Due.el){Due.el.style.display='none';Due.el.setAttribute('aria-hidden','true');Due.el.dataset.fromContext='false'}
}
window.addEventListener('click',e=>{if(Due.el.style.display==='block'&&!Due.el.contains(e.target)&&!(Due.anchor&&Due.anchor.contains(e.target))&&!e.target.closest('.due-btn'))closeDuePicker()},true);

registerTasksDataCallbacks({
  syncDisplays: updateTimerDisplays,
  toast: toast,
  getArchivedTasks: ()=>archivedTasks,
  getTaskMinutes: getTaskMinutes,
  isTimeUpdatePending: isTimeUpdatePending,
  isTimeDialogOpen: isTimeDialogOpen,
  getTimeDialogTaskId: ()=>timeDialogTaskId,
  getCurrentView: ()=>currentView,
  getCurrentProjectId: ()=>currentProjectId,
  getProjects: ()=>projects,
  render: render,
  handleTaskCompletionEffects: handleTaskCompletionEffects,
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
  getTimeDialogTaskId: ()=>timeDialogTaskId,
  openDuePicker: openDuePicker,
  closeDuePicker: closeDuePicker,
  getDueEl: ()=>Due.el,
  getDueAnchor: ()=>Due.anchor,
  markTaskDone: markTaskDone,
  openTimeEditDialog: openTimeEditDialog,
  getTimePresets: ()=>TIME_PRESETS,
  formatPresetLabel: formatPresetLabel,
  minutesToMs: minutesToMs,
  handleInlinePreset: handleInlinePreset,
});

setupSidebarResize();

ensureWorkdayInteractionGuards();

(function(){applyTheme(ThemeStore.read());initCalendar();updateStorageToggle();refreshDataForCurrentMode()})();
