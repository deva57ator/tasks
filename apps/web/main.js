const StorageModeStore={key:'mini-task-tracker:storage-mode',read(){return localStorage.getItem(this.key)||'local'},write(mode){localStorage.setItem(this.key,mode)}};
const STORAGE_MODES={LOCAL:'local',SERVER:'server'};
const ApiSettingsStore={key:'mini-task-tracker:api-settings',read(){try{const raw=JSON.parse(localStorage.getItem(this.key)||'{}');if(!raw||typeof raw!=='object')return{};return raw}catch{return{}}},write(settings){try{localStorage.setItem(this.key,JSON.stringify(settings||{}))}catch{}}};

const DEFAULT_API_BASE='/api';

let storageMode=StorageModeStore.read();
if(storageMode!==STORAGE_MODES.SERVER)storageMode=STORAGE_MODES.LOCAL;

const storedApiSettings=ApiSettingsStore.read();
let apiSettings={apiKey:storedApiSettings.apiKey,baseUrl:DEFAULT_API_BASE};
if(typeof apiSettings.apiKey!=='string')apiSettings.apiKey='';

function isServerMode(){return storageMode===STORAGE_MODES.SERVER}
function getApiSettings(){return apiSettings}
function setApiSettings(next){apiSettings={...apiSettings,...(next||{}),baseUrl:DEFAULT_API_BASE};ApiSettingsStore.write(apiSettings)}

const ApiSettingsDialog={overlay:document.getElementById('apiSettingsOverlay'),dialog:document.getElementById('apiSettingsDialog'),form:document.getElementById('apiSettingsForm'),apiKey:document.getElementById('apiSettingsKey'),error:document.getElementById('apiSettingsError'),close:document.getElementById('apiSettingsClose'),cancel:document.getElementById('apiSettingsCancel')};

function setApiSettingsError(msg){if(!ApiSettingsDialog.error)return;ApiSettingsDialog.error.textContent=msg||'';}
function openApiSettingsDialog(){if(!ApiSettingsDialog.overlay)return;const settings=getApiSettings();if(ApiSettingsDialog.apiKey)ApiSettingsDialog.apiKey.value=typeof settings.apiKey==='string'?settings.apiKey:'';setApiSettingsError('');ApiSettingsDialog.overlay.classList.add('is-open');ApiSettingsDialog.overlay.setAttribute('aria-hidden','false');if(ApiSettingsDialog.dialog)ApiSettingsDialog.dialog.setAttribute('aria-hidden','false');document.body.classList.add('api-settings-open');const focusTarget=ApiSettingsDialog.apiKey;setTimeout(()=>{if(!focusTarget)return;try{focusTarget.focus({preventScroll:true})}catch{focusTarget.focus();}},60);}
function closeApiSettingsDialog(){if(!ApiSettingsDialog.overlay)return;ApiSettingsDialog.overlay.classList.remove('is-open');ApiSettingsDialog.overlay.setAttribute('aria-hidden','true');if(ApiSettingsDialog.dialog)ApiSettingsDialog.dialog.setAttribute('aria-hidden','true');document.body.classList.remove('api-settings-open');setApiSettingsError('');}
function submitApiSettingsForm(event){if(event)event.preventDefault();const keyRaw=ApiSettingsDialog.apiKey?ApiSettingsDialog.apiKey.value:'';const apiKey=typeof keyRaw==='string'?keyRaw.trim():'';setApiSettings({apiKey});closeApiSettingsDialog();const refreshPromise=isServerMode()?refreshDataForCurrentMode({silent:true}):null;if(refreshPromise&&typeof refreshPromise.catch==='function')refreshPromise.catch(()=>{});toast('Настройки API сохранены');}

const Store={key:'mini-task-tracker:text:min:v14',read(){try{return JSON.parse(localStorage.getItem(this.key))||[]}catch{return[]}},write(d){if(isServerMode()){handleServerTaskWrite(d);return}localStorage.setItem(this.key,JSON.stringify(d));afterTasksPersisted()}};
const ThemeStore={key:'mini-task-tracker:theme',read(){return localStorage.getItem(this.key)||'light'},write(v){localStorage.setItem(this.key,v)}};
const ProjectsStore={key:'mini-task-tracker:projects',read(){try{return JSON.parse(localStorage.getItem(this.key))||[]}catch{return[]}},write(d){if(isServerMode()){handleServerProjectsWrite(d);return}localStorage.setItem(this.key,JSON.stringify(d))}};
function normalizeWorkdayState(raw){
  if(!raw||typeof raw!=='object'||!raw.id)return null;
  const normalized={...raw};
  if(typeof normalized.start!=='number'||!isFinite(normalized.start))normalized.start=null;
  if(typeof normalized.end!=='number'||!isFinite(normalized.end))normalized.end=null;
  if(typeof normalized.closedAt!=='number'||!isFinite(normalized.closedAt))normalized.closedAt=null;
  if(typeof normalized.finalTimeMs!=='number'||!isFinite(normalized.finalTimeMs))normalized.finalTimeMs=0;
  if(typeof normalized.finalDoneCount!=='number'||!isFinite(normalized.finalDoneCount))normalized.finalDoneCount=0;
  if(!normalized.baseline||typeof normalized.baseline!=='object')normalized.baseline={};
  if(!normalized.completed||typeof normalized.completed!=='object')normalized.completed={};
  const manualStats=normalized.manualClosedStats;
  const manualTime=manualStats&&typeof manualStats.timeMs==='number'&&isFinite(manualStats.timeMs)?Math.max(0,manualStats.timeMs):0;
  const manualDone=manualStats&&typeof manualStats.doneCount==='number'&&isFinite(manualStats.doneCount)?Math.max(0,Math.round(manualStats.doneCount)):0;
  normalized.manualClosedStats={timeMs:manualTime,doneCount:manualDone};
  normalized.closedManually=normalized.closedManually===true;
  return normalized;
}

const WORKDAY_STORAGE_KEY='mini-task-tracker:workday';
const WORKDAY_SERVER_STORAGE_KEY=`${WORKDAY_STORAGE_KEY}:server`;
const WorkdayStore={
  key:WORKDAY_STORAGE_KEY,
  serverKey:WORKDAY_SERVER_STORAGE_KEY,
  getKey(mode=storageMode){return mode===STORAGE_MODES.SERVER?this.serverKey:this.key},
  read({mode,allowLegacyFallback=true}={}){
    const targetMode=mode===STORAGE_MODES.SERVER?STORAGE_MODES.SERVER:mode===STORAGE_MODES.LOCAL?STORAGE_MODES.LOCAL:storageMode;
    const key=this.getKey(targetMode);
    try{
      const raw=localStorage.getItem(key);
      if(raw){
        const parsed=normalizeWorkdayState(JSON.parse(raw));
        if(parsed)return parsed;
      }
    }catch{}
    if(targetMode===STORAGE_MODES.SERVER&&allowLegacyFallback){
      try{
        const legacyRaw=localStorage.getItem(this.key);
        if(legacyRaw){
          const legacyState=normalizeWorkdayState(JSON.parse(legacyRaw));
          if(legacyState){
            this.write(legacyState,{mode:STORAGE_MODES.SERVER,skipServerSync:true});
            return legacyState;
          }
        }
      }catch{}
    }
    return null;
  },
  write(state,{mode,skipServerSync=false}={}){
    const targetMode=mode===STORAGE_MODES.SERVER?STORAGE_MODES.SERVER:mode===STORAGE_MODES.LOCAL?STORAGE_MODES.LOCAL:storageMode;
    const key=this.getKey(targetMode);
    if(!state){
      localStorage.removeItem(key);
      if(targetMode===STORAGE_MODES.SERVER&&!skipServerSync&&storageMode===STORAGE_MODES.SERVER){
        handleServerWorkdayWrite(null);
      }
      return;
    }
    try{localStorage.setItem(key,JSON.stringify(state));}catch{}
    if(targetMode===STORAGE_MODES.SERVER&&!skipServerSync&&storageMode===STORAGE_MODES.SERVER){
      handleServerWorkdayWrite(state);
    }
  }
};

function persistLocalWorkdayState(state,{mode}={}){
  const targetMode=mode===STORAGE_MODES.SERVER?STORAGE_MODES.SERVER:mode===STORAGE_MODES.LOCAL?STORAGE_MODES.LOCAL:storageMode;
  try{
    const normalized=normalizeWorkdayState(state);
    if(!normalized){
      WorkdayStore.write(null,{mode:targetMode,skipServerSync:true});
    }else{
      WorkdayStore.write(normalized,{mode:targetMode,skipServerSync:true});
    }
  }catch{
    WorkdayStore.write(null,{mode:targetMode,skipServerSync:true});
  }
}
const ArchiveStore={key:'mini-task-tracker:archive:v1',read(){try{const raw=JSON.parse(localStorage.getItem(this.key));if(!Array.isArray(raw))return[];return raw.filter(item=>item&&typeof item==='object')}catch{return[]}},write(d){if(isServerMode()){handleServerArchiveWrite(d);return}localStorage.setItem(this.key,JSON.stringify(d))}};

let tasks=Store.read();
let archivedTasks=ArchiveStore.read();
let selectedTaskId=null;
let pendingEditId=null;
let currentView='all';
let currentProjectId=null;
let activeEditId=null;
let activeInputEl=null;
let projects=ProjectsStore.read();
if(!Array.isArray(projects))projects=[];
const DEFAULT_PROJECT_EMOJI='📁';
const SPRINT_UNASSIGNED_KEY='__none__';
let sprintVisibleProjects=new Map();

function normalizeProjectsList(list,{persist=false}={}){
  if(!Array.isArray(list))return[];
  let patched=false;
  for(const proj of list){
    if(!proj||typeof proj!=='object')continue;
    if(!('emoji'in proj)||proj.emoji===undefined){proj.emoji=null;patched=true;continue}
    if(proj.emoji!==null&&typeof proj.emoji!=='string'){proj.emoji=null;patched=true;continue}
    if(typeof proj.emoji==='string'){
      const trimmed=proj.emoji.trim();
      if(!trimmed){proj.emoji=null;patched=true}
      else if(trimmed!==proj.emoji){proj.emoji=trimmed;patched=true}
    }
  }
  if(patched&&persist){ProjectsStore.write(list)}
  return list
}

normalizeProjectsList(projects,{persist:!isServerMode()});

let workdayState=WorkdayStore.read();
if(workdayState&&(!workdayState.id||typeof workdayState.start!=='number'||typeof workdayState.end!=='number'))workdayState=null;

const WorkdayUI={
  bar:document.getElementById('workdayBar'),
  done:document.getElementById('workdayDone'),
  time:document.getElementById('workdayTime'),
  button:document.getElementById('workdayFinishBtn'),
  overlay:document.getElementById('workdayOverlay'),
  range:document.getElementById('workdayDialogRange'),
  summaryTime:document.getElementById('workdaySummaryTime'),
  summaryDone:document.getElementById('workdaySummaryDone'),
  completedSection:document.getElementById('workdayCompletedSection'),
  completedList:document.getElementById('workdayCompletedList'),
  completedEmpty:document.getElementById('workdayDialogCompletedEmpty'),
  pendingList:document.getElementById('workdayPendingList'),
  emptyState:document.getElementById('workdayDialogEmpty'),
  postponeBtn:document.getElementById('workdayPostponeBtn'),
  closeBtn:document.getElementById('workdayDialogClose'),
  closeAction:document.getElementById('workdayDialogDone'),
  title:document.getElementById('workdayDialogTitle')
};

const WORKDAY_REFRESH_INTERVAL=60000;

const $=s=>document.querySelector(s),$$=s=>Array.from(document.querySelectorAll(s));
const uid=()=>Math.random().toString(36).slice(2,10)+Date.now().toString(36).slice(-4);
function normalizeArchivedNode(node){if(!node||typeof node!=='object')return null;const normalized={id:typeof node.id==='string'&&node.id.trim()?node.id.trim():uid(),title:typeof node.title==='string'?node.title:'',done:true,due:typeof node.due==='string'&&node.due?node.due:null,project:typeof node.project==='string'&&node.project?node.project:null,notes:typeof node.notes==='string'?node.notes:'',timeSpent:typeof node.timeSpent==='number'&&isFinite(node.timeSpent)?Math.max(0,node.timeSpent):0,archivedAt:typeof node.archivedAt==='number'&&isFinite(node.archivedAt)?node.archivedAt:0,completedAt:typeof node.completedAt==='number'&&isFinite(node.completedAt)?node.completedAt:null,children:[]};if(Array.isArray(node.children)){const kids=[];for(const child of node.children){const normalizedChild=normalizeArchivedNode(child);if(normalizedChild)kids.push(normalizedChild)}normalized.children=kids}return normalized}
function normalizeArchiveList(list,{persist=false}={}){if(!Array.isArray(list))return[];const normalizedArchive=[];let patched=false;for(const entry of list){const normalized=normalizeArchivedNode(entry);if(normalized){normalizedArchive.push(normalized);if(normalized!==entry)patched=true}else patched=true}if((patched||normalizedArchive.length!==list.length)&&persist){ArchiveStore.write(normalizedArchive)}return normalizedArchive}
if(!Array.isArray(archivedTasks))archivedTasks=[];else archivedTasks=normalizeArchiveList(archivedTasks,{persist:!isServerMode()});
const MAX_TASK_DEPTH=2;
const MONTH_NAMES=['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const TIME_UPDATE_INTERVAL=1000;

const API_DEFAULT_LIMIT=200;
let isDataLoading=false;
let dataInitialized=false;
const pendingTaskUpdates=new Map();
const pendingServerCreates=new Set();
let pendingWorkdaySync=null;
let workdaySyncTimer=null;
let workdaySyncInFlight=false;
let lastWorkdaySyncPayload=null;

function getApiBaseUrl(){const base=(getApiSettings().baseUrl||'/api').trim();if(!base)return'/api';return base.endsWith('/')?base.slice(0,-1):base}
function getApiKey(){const key=getApiSettings().apiKey;return typeof key==='string'?key.trim():''}

async function apiRequest(path,{method='GET',body,headers}={}){const base=getApiBaseUrl();const url=base+path;const init={method,headers:{Accept:'application/json',...(headers||{})}};if(body!==undefined){init.body=typeof body==='string'?body:JSON.stringify(body);if(!init.headers['Content-Type'])init.headers['Content-Type']='application/json'}const apiKey=getApiKey();if(!apiKey)throw new Error('API ключ не задан');init.headers['x-api-key']=apiKey;let response;try{response=await fetch(url,init)}catch(err){throw new Error('Нет соединения с API')}if(!response.ok){let message=`Ошибка API (${response.status})`;try{const errBody=await response.json();if(errBody&&errBody.error&&errBody.error.message)message=errBody.error.message}catch{}throw new Error(message)}if(response.status===204)return null;const text=await response.text();if(!text)return null;try{return JSON.parse(text)}catch{return null}}

function handleApiError(err,fallback){const message=err&&err.message?err.message:fallback||'Ошибка при работе с API';console.error(err);toast(message)}

function runServerAction(fn,{onSuccess,onError,silent=false}={}){const promise=Promise.resolve().then(fn);promise.then(result=>{if(typeof onSuccess==='function')onSuccess(result)}).catch(err=>{if(!silent)handleApiError(err);if(typeof onError==='function')onError(err)});return promise}

function mapTaskForServer(task){return{id:task.id,title:task.title||'',done:task.done===true,due:task.due||null,project:task.project||null,notes:task.notes||'',timeSpent:Number.isFinite(Number(task.timeSpent))?Math.max(0,Number(task.timeSpent)):0,parentId:task.parentId||null}}

function normalizeTaskPatch(patch){const payload={};if(patch.title!==undefined)payload.title=String(patch.title);if(patch.done!==undefined)payload.done=!!patch.done;if(patch.due!==undefined)payload.due=patch.due||null;if(patch.project!==undefined)payload.project=patch.project||null;if(patch.notes!==undefined)payload.notes=patch.notes||'';if(patch.timeSpent!==undefined)payload.timeSpent=Math.max(0,Number(patch.timeSpent)||0);if(patch.parentId!==undefined)payload.parentId=patch.parentId||null;if(patch.completedAt!==undefined)payload.completedAt=patch.completedAt;return payload}

function normalizeTaskTree(list,parentId=null){if(!Array.isArray(list))return[];const normalized=[];for(const item of list){if(!item||typeof item!=='object')continue;const node={id:typeof item.id==='string'?item.id:uid(),title:typeof item.title==='string'?item.title:'',done:item.done===true,due:typeof item.due==='string'&&item.due?item.due:null,project:typeof item.project==='string'&&item.project?item.project:null,notes:typeof item.notes==='string'?item.notes:'',timeSpent:Number.isFinite(Number(item.timeSpent))?Math.max(0,Number(item.timeSpent)):0,parentId:parentId,children:normalizeTaskTree(item.children||[],typeof item.id==='string'?item.id:null),collapsed:item.collapsed===true,timerActive:false,timerStart:null};normalized.push(node)}return normalized}

function ensureTaskParentIds(list,parentId=null){if(!Array.isArray(list))return;for(const item of list){if(!item||typeof item!=='object')continue;item.parentId=parentId;if(Array.isArray(item.children))ensureTaskParentIds(item.children,item.id)}}

function normalizeProjectPayload(project){return{id:project.id,title:project.title||'',emoji:typeof project.emoji==='string'&&project.emoji.trim()?project.emoji.trim():null}}

function normalizeArchivePayload(items){if(!Array.isArray(items))return[];return items.map(entry=>entry&&entry.payload?entry.payload:entry).filter(Boolean)}

function updateStorageToggle({loading=false}={}){const btn=document.getElementById('storageToggle');if(!btn)return;btn.dataset.mode=isServerMode()?'server':'local';btn.classList.toggle('is-loading',loading);if(loading){btn.textContent='…';btn.setAttribute('aria-busy','true')}else{btn.textContent=isServerMode()?'API':'LS';btn.removeAttribute('aria-busy')}const label=isServerMode()?'Режим: серверный API':'Режим: localStorage';btn.title=label;btn.setAttribute('aria-label',loading?`${label}. Загрузка…`:label)}

function finalizeDataLoad(){tasks=migrate(tasks);ensureTaskParentIds(tasks,null);normalizeProjectsList(projects,{persist:false});archivedTasks=normalizeArchiveList(archivedTasks,{persist:false});pendingServerCreates.clear();renderProjects();render();updateWorkdayUI();ensureWorkdayRefreshLoop();dataInitialized=true}

async function loadDataFromLocal(){tasks=Store.read();tasks=migrate(tasks);ensureTaskParentIds(tasks,null);projects=ProjectsStore.read();if(!Array.isArray(projects))projects=[];normalizeProjectsList(projects,{persist:!isServerMode()});archivedTasks=normalizeArchiveList(ArchiveStore.read(),{persist:!isServerMode()});workdayState=WorkdayStore.read();if(workdayState&&(!workdayState.id||typeof workdayState.start!=='number'||typeof workdayState.end!=='number'))workdayState=null;finalizeDataLoad();updateStorageToggle()}

async function loadDataFromServer({silent=false}={}){if(isDataLoading)return;isDataLoading=true;updateStorageToggle({loading:true});try{const [tasksPayload,projectsPayload,archivePayload,workdayPayload]=await Promise.all([apiRequest('/tasks'),apiRequest(`/projects?limit=${API_DEFAULT_LIMIT}`),apiRequest(`/archive?limit=${API_DEFAULT_LIMIT}`),apiRequest('/workday/current')]);const serverTasks=Array.isArray(tasksPayload?.items)?tasksPayload.items:Array.isArray(tasksPayload)?tasksPayload:[];tasks=normalizeTaskTree(serverTasks,null);projects=normalizeProjectsList(projectsPayload&&Array.isArray(projectsPayload.items)?projectsPayload.items:[],{persist:false});const archiveItems=normalizeArchivePayload(archivePayload&&Array.isArray(archivePayload.items)?archivePayload.items:[]);archivedTasks=normalizeArchiveList(archiveItems,{persist:false});const serverWorkday=workdayPayload&&workdayPayload.workday?workdayPayload.workday:null;workdayState=hydrateWorkdayStateFromServer(serverWorkday);persistLocalWorkdayState(workdayState);finalizeDataLoad()}catch(err){if(!silent)handleApiError(err,'Не удалось загрузить данные с сервера');storageMode=STORAGE_MODES.LOCAL;StorageModeStore.write(storageMode);updateStorageToggle();await loadDataFromLocal()}finally{isDataLoading=false;updateStorageToggle({loading:false})}}

async function refreshDataForCurrentMode(options={}){if(isServerMode())return loadDataFromServer(options);return loadDataFromLocal()}

function flushPendingTaskUpdates(){for(const [id,entry]of pendingTaskUpdates.entries()){if(entry&&entry.timer)clearTimeout(entry.timer);if(entry&&entry.patch){runServerAction(()=>apiRequest(`/tasks/${encodeURIComponent(id)}`,{method:'PUT',body:entry.patch}),{silent:true,onError:()=>refreshDataForCurrentMode({silent:true})})}}pendingTaskUpdates.clear()}

function ensureApiCredentials(){const key=getApiKey();if(key)return true;const input=prompt('Введите API ключ','');if(input===null)return false;const trimmed=input.trim();if(!trimmed){toast('API ключ обязателен для работы с сервером');return false}setApiSettings({apiKey:trimmed});return true}

async function setStorageModeAndReload(mode,{silent=false}={}){const nextMode=mode===STORAGE_MODES.SERVER?STORAGE_MODES.SERVER:STORAGE_MODES.LOCAL;if(storageMode===nextMode&&!silent)return;storageMode=nextMode;StorageModeStore.write(storageMode);updateStorageToggle();flushPendingTaskUpdates();flushPendingWorkdaySync();await refreshDataForCurrentMode({silent})}

function handleServerTaskWrite(){afterTasksPersisted()}
function handleServerProjectsWrite(data){if(Array.isArray(data)){projects=data}}
function handleServerArchiveWrite(data){if(Array.isArray(data))archivedTasks=normalizeArchiveList(data,{persist:false})}

function cloneWorkdayStateForTransport(state){if(!state||typeof state!=='object')return null;try{return JSON.parse(JSON.stringify(state))}catch{return{...state}}}

function buildWorkdayPayloadForServer(state){if(!state||!state.id)return null;const summary=computeAggregatedWorkdayStats(Date.now(),{persist:false,allowBaselineUpdate:false})||{timeMs:0,doneCount:0};const payloadState=cloneWorkdayStateForTransport(state);if(!payloadState)return null;return{id:state.id,startTs:typeof state.start==='number'&&isFinite(state.start)?state.start:null,endTs:typeof state.end==='number'&&isFinite(state.end)?state.end:null,summaryTimeMs:Math.max(0,Number(summary.timeMs)||0),summaryDone:Math.max(0,Number(summary.doneCount)||0),payload:payloadState,closedAt:typeof state.closedAt==='number'&&isFinite(state.closedAt)?state.closedAt:null}}

function stringifyWorkdayPayload(payload){try{return JSON.stringify(payload)}catch{return null}}

function hydrateWorkdayStateFromServer(record){
  if(!record){
    const fallback=WorkdayStore.read();
    return fallback?normalizeWorkdayState(cloneWorkdayStateForTransport(fallback)):null;
  }
  const payloadState=normalizeWorkdayState(record.payload);
  const summaryTimeMs=Math.max(0,Number(record.summaryTimeMs)||0);
  const summaryDone=Math.max(0,Math.round(Number(record.summaryDone)||0));
  const closedAt=typeof record.closedAt==='number'&&isFinite(record.closedAt)?record.closedAt:null;
  const startTs=Number.isFinite(Number(record.startTs))?Number(record.startTs):null;
  const endTs=Number.isFinite(Number(record.endTs))?Number(record.endTs):null;
  let state=payloadState;
  if(!state){
    const localSnapshot=WorkdayStore.read();
    if(localSnapshot&&(!record.id||localSnapshot.id===record.id)){
      state=normalizeWorkdayState(cloneWorkdayStateForTransport(localSnapshot));
    }
  }
  if(!state){
    if(!record.id)return null;
    state={id:record.id,start:startTs,end:endTs,baseline:{},completed:{},closedAt:closedAt,finalTimeMs:summaryTimeMs,finalDoneCount:summaryDone,locked:closedAt!==null,closedManually:false,manualClosedStats:{timeMs:0,doneCount:0}};
  }else{
    if(record.id&&typeof state.id!=='string')state.id=String(record.id);
    if(startTs!==null)state.start=startTs;else if(state.start===undefined)state.start=null;
    if(endTs!==null)state.end=endTs;else if(state.end===undefined)state.end=null;
    if(closedAt!==null)state.closedAt=closedAt;
    state.locked=state.locked===true||closedAt!==null;
    if(typeof state.finalTimeMs!=='number'||!isFinite(state.finalTimeMs))state.finalTimeMs=0;
    if(typeof state.finalDoneCount!=='number'||!isFinite(state.finalDoneCount))state.finalDoneCount=0;
    if(!state.manualClosedStats||typeof state.manualClosedStats!=='object')state.manualClosedStats={timeMs:0,doneCount:0};
  }
  if(!state.baseline||typeof state.baseline!=='object')state.baseline={};
  if(!state.completed||typeof state.completed!=='object')state.completed={};
  const isClosed=state.locked===true||closedAt!==null;
  if(isClosed){
    state.finalTimeMs=Math.max(state.finalTimeMs,summaryTimeMs);
    state.finalDoneCount=Math.max(state.finalDoneCount,summaryDone);
    return state;
  }
  const hasBaseline=Object.keys(state.baseline).length>0;
  if(!hasBaseline){
    const baseline={};
    walkTasks(tasks,item=>{baseline[item.id]=totalTimeMs(item);});
    state.baseline=baseline;
    state.completed={};
    state.manualClosedStats={timeMs:summaryTimeMs,doneCount:summaryDone};
    state.finalTimeMs=Math.max(state.finalTimeMs,summaryTimeMs);
    state.finalDoneCount=Math.max(state.finalDoneCount,summaryDone);
  }
  return state;
}

function scheduleWorkdaySync(delay=400){if(workdaySyncTimer)clearTimeout(workdaySyncTimer);workdaySyncTimer=setTimeout(()=>{workdaySyncTimer=null;if(workdaySyncInFlight){scheduleWorkdaySync(delay);return}sendPendingWorkdaySync()},delay)}

function sendPendingWorkdaySync(){if(workdaySyncInFlight||!pendingWorkdaySync)return;const entry=pendingWorkdaySync;workdaySyncInFlight=true;runServerAction(()=>apiRequest('/workday/sync',{method:'POST',body:{workday:entry.payload}}),{silent:true,onSuccess:()=>{if(pendingWorkdaySync===entry)pendingWorkdaySync=null;lastWorkdaySyncPayload=entry.serialized;workdaySyncInFlight=false;if(pendingWorkdaySync){scheduleWorkdaySync(150)}},onError:()=>{workdaySyncInFlight=false;if(pendingWorkdaySync){scheduleWorkdaySync(2000)}else{lastWorkdaySyncPayload=null}}})}

function flushPendingWorkdaySync(){if(workdaySyncTimer){clearTimeout(workdaySyncTimer);workdaySyncTimer=null}if(workdaySyncInFlight)return;sendPendingWorkdaySync()}

function resetWorkdaySyncState(){if(workdaySyncTimer){clearTimeout(workdaySyncTimer);workdaySyncTimer=null}pendingWorkdaySync=null;workdaySyncInFlight=false;lastWorkdaySyncPayload=null}

function handleServerWorkdayWrite(state){if(!isServerMode())return;if(!state||!state.id){resetWorkdaySyncState();return}const payload=buildWorkdayPayloadForServer(state);if(!payload)return;const serialized=stringifyWorkdayPayload(payload);if(!serialized)return;if(serialized===lastWorkdaySyncPayload&&!pendingWorkdaySync)return;if(pendingWorkdaySync&&pendingWorkdaySync.serialized===serialized)return;pendingWorkdaySync={payload,serialized};if(!workdaySyncInFlight){scheduleWorkdaySync()}}

function queueTaskCreate(task){if(!isServerMode())return;const payload=mapTaskForServer(task);runServerAction(()=>apiRequest('/tasks',{method:'POST',body:payload}),{onError:()=>refreshDataForCurrentMode({silent:true})})}

function queueTaskUpdate(id,patch,{debounce=false}={}){if(!isServerMode()||!id)return;const payload=normalizeTaskPatch(patch||{});if(debounce){const entry=pendingTaskUpdates.get(id)||{patch:{},timer:null};entry.patch={...entry.patch,...payload};if(entry.timer)clearTimeout(entry.timer);entry.timer=setTimeout(()=>{pendingTaskUpdates.delete(id);runServerAction(()=>apiRequest(`/tasks/${encodeURIComponent(id)}`,{method:'PUT',body:entry.patch}),{silent:true,onError:()=>refreshDataForCurrentMode({silent:true})})},320);pendingTaskUpdates.set(id,entry);return}runServerAction(()=>apiRequest(`/tasks/${encodeURIComponent(id)}`,{method:'PUT',body:payload}),{onError:()=>refreshDataForCurrentMode({silent:true})})}

function queueTaskDelete(id){if(!isServerMode()||!id)return;runServerAction(()=>apiRequest(`/tasks/${encodeURIComponent(id)}`,{method:'DELETE'}),{onError:()=>refreshDataForCurrentMode({silent:true})})}

function queueProjectCreate(project){if(!isServerMode())return;const payload=normalizeProjectPayload(project);runServerAction(()=>apiRequest('/projects',{method:'POST',body:payload}),{onError:()=>refreshDataForCurrentMode({silent:true})})}

function queueProjectUpdate(id,patch){if(!isServerMode()||!id)return;const payload={};if(patch.title!==undefined)payload.title=String(patch.title);if(patch.emoji!==undefined)payload.emoji=typeof patch.emoji==='string'&&patch.emoji.trim()?patch.emoji.trim():null;runServerAction(()=>apiRequest(`/projects/${encodeURIComponent(id)}`,{method:'PUT',body:payload}),{onError:()=>refreshDataForCurrentMode({silent:true})})}

function queueProjectDelete(id){if(!isServerMode()||!id)return;runServerAction(()=>apiRequest(`/projects/${encodeURIComponent(id)}`,{method:'DELETE'}),{onError:()=>refreshDataForCurrentMode({silent:true})})}

function queueArchiveDelete(id){if(!isServerMode()||!id)return;runServerAction(()=>apiRequest(`/archive/${encodeURIComponent(id)}`,{method:'DELETE'}),{onError:()=>refreshDataForCurrentMode({silent:true})})}

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
function migrate(list,depth=0){const extras=[];for(const t of list){if(!Array.isArray(t.children)) t.children=[];if(typeof t.collapsed!=='boolean') t.collapsed=false;if(typeof t.done!=='boolean') t.done=false;if(!('due' in t)) t.due=null;if(!('project' in t)) t.project=null;if(typeof t.notes!=='string') t.notes='';if(typeof t.timeSpent!=='number'||!isFinite(t.timeSpent)||t.timeSpent<0)t.timeSpent=0;if(typeof t.timerActive!=='boolean')t.timerActive=false;if(typeof t.timerStart!=='number'||!isFinite(t.timerStart))t.timerStart=null;if(t.children.length){migrate(t.children,depth+1);if(depth>=MAX_TASK_DEPTH){extras.push(...t.children);t.children=[]}}}if(extras.length) list.push(...extras);return list}
tasks=migrate(tasks);
ensureTaskParentIds(tasks,null);

function findTask(id,list=tasks){for(const t of list){if(t.id===id) return t;const r=findTask(id,t.children||[]);if(r) return r}return null}
function findArchivedTask(id,list=archivedTasks){if(!Array.isArray(list))return null;for(const item of list){if(item&&item.id===id)return item;const nested=findArchivedTask(id,item?.children||[]);if(nested)return nested}return null}
function removeArchivedTask(id,list=archivedTasks){if(!Array.isArray(list))return null;const index=list.findIndex(item=>item&&item.id===id);if(index!==-1){const [removed]=list.splice(index,1);return removed||null}for(const item of list){if(item&&Array.isArray(item.children)&&item.children.length){const removed=removeArchivedTask(id,item.children);if(removed){return removed}}}return null}
function getTaskDepth(id,list=tasks,depth=0){for(const t of list){if(t.id===id) return depth;const childDepth=getTaskDepth(id,t.children||[],depth+1);if(childDepth!==-1) return childDepth}return-1}
function getSubtreeDepth(task){if(!task||!Array.isArray(task.children)||!task.children.length)return 0;let max=0;for(const child of task.children){const childDepth=1+getSubtreeDepth(child);if(childDepth>max)max=childDepth}return max}
function containsTask(root,targetId){if(!root||!targetId)return false;if(root.id===targetId)return true;if(!Array.isArray(root.children))return false;for(const child of root.children){if(containsTask(child,targetId))return true}return false}
function detachTaskFromTree(id,list=tasks){if(!Array.isArray(list))return null;for(let i=0;i<list.length;i++){const item=list[i];if(item.id===id){const pulled=list.splice(i,1)[0];if(pulled)pulled.parentId=null;return pulled}const pulled=detachTaskFromTree(id,item.children||[]);if(pulled){if(item.children&&item.children.length===0)item.collapsed=false;return pulled}}return null}
let draggingTaskId=null;
let dropTargetId=null;
let sprintDraggingId=null;
let sprintDropColumn=null;
let timerInterval=null;

const WORKDAY_START_HOUR=6;
const WORKDAY_END_HOUR=3;

function afterTasksPersisted(){syncWorkdayTaskSnapshot();updateWorkdayUI()}

function walkTasks(list,cb){if(!Array.isArray(list))return;for(const item of list){if(!item)continue;cb(item);if(Array.isArray(item.children)&&item.children.length)walkTasks(item.children,cb)}}

function workdayDateKey(value){const d=value instanceof Date?value:new Date(value);if(isNaN(d))return null;return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}

function getWorkdayInfo(now=Date.now()){const current=new Date(now);const hour=current.getHours();if(hour<WORKDAY_END_HOUR){const start=new Date(current);start.setDate(start.getDate()-1);start.setHours(WORKDAY_START_HOUR,0,0,0);const end=new Date(start);end.setDate(end.getDate()+1);end.setHours(WORKDAY_END_HOUR,0,0,0);return{state:'active',start:start.getTime(),end:end.getTime(),id:workdayDateKey(start)}}if(hour>=WORKDAY_START_HOUR){const start=new Date(current);start.setHours(WORKDAY_START_HOUR,0,0,0);const end=new Date(start);end.setDate(end.getDate()+1);end.setHours(WORKDAY_END_HOUR,0,0,0);return{state:'active',start:start.getTime(),end:end.getTime(),id:workdayDateKey(start)}}const prevStart=new Date(current);prevStart.setDate(prevStart.getDate()-1);prevStart.setHours(WORKDAY_START_HOUR,0,0,0);const prevEnd=new Date(prevStart);prevEnd.setDate(prevEnd.getDate()+1);prevEnd.setHours(WORKDAY_END_HOUR,0,0,0);const nextStart=new Date(current);nextStart.setHours(WORKDAY_START_HOUR,0,0,0);return{state:'waiting',start:prevStart.getTime(),end:prevEnd.getTime(),id:workdayDateKey(prevStart),nextStart:nextStart.getTime()}}

function createWorkdaySnapshot(info){const baseline={};walkTasks(tasks,item=>{baseline[item.id]=totalTimeMs(item,info.start)});return{id:info.id,start:info.start,end:info.end,baseline,completed:{},closedAt:null,finalTimeMs:0,finalDoneCount:0,locked:false,closedManually:false,manualClosedStats:{timeMs:0,doneCount:0}}}

function syncWorkdayTaskSnapshot(){if(!workdayState||workdayState.locked)return;let changed=false;const baseline=workdayState.baseline||(workdayState.baseline={});const seen=new Set();walkTasks(tasks,item=>{seen.add(item.id);if(!(item.id in baseline)){baseline[item.id]=totalTimeMs(item,workdayState.start);changed=true}else{const current=totalTimeMs(item);if(current<baseline[item.id]){baseline[item.id]=current;changed=true}}});for(const id of Object.keys(baseline)){if(!seen.has(id)){delete baseline[id];changed=true}}const completed=workdayState.completed||(workdayState.completed={});for(const id of Object.keys(completed)){const task=findTask(id);if(!task||!task.done){delete completed[id];changed=true}}if(changed)WorkdayStore.write(workdayState)}

function computeWorkdayProgress(now=Date.now(),{persist=true,allowBaselineUpdate=true}={}){if(!workdayState)return{timeMs:0,doneCount:0};const baseline=workdayState.baseline||(workdayState.baseline={});const seen=new Set();let total=0;let changed=false;walkTasks(tasks,item=>{const id=item.id;seen.add(id);let baseValue=baseline[id];if(baseValue===undefined){if(!allowBaselineUpdate)return;baseValue=totalTimeMs(item,workdayState.start);baseline[id]=baseValue;changed=true}let current=totalTimeMs(item,now);if(allowBaselineUpdate&&current<baseValue){baseline[id]=current;baseValue=current;changed=true}const diff=current-baseValue;if(diff>0)total+=diff});if(allowBaselineUpdate){for(const id of Object.keys(baseline)){if(!seen.has(id)){delete baseline[id];changed=true}}}const completed=workdayState.completed||(workdayState.completed={});let doneCount=0;for(const id of Object.keys(completed)){const task=findTask(id);if(task&&task.done){doneCount++}else if(allowBaselineUpdate){delete completed[id];changed=true}}if(persist&&changed)WorkdayStore.write(workdayState);return{timeMs:total,doneCount}}

function getManualWorkdayStats(){if(!workdayState||!workdayState.manualClosedStats)return{timeMs:0,doneCount:0};const timeMs=typeof workdayState.manualClosedStats.timeMs==='number'&&isFinite(workdayState.manualClosedStats.timeMs)?Math.max(0,workdayState.manualClosedStats.timeMs):0;const doneCount=typeof workdayState.manualClosedStats.doneCount==='number'&&isFinite(workdayState.manualClosedStats.doneCount)?Math.max(0,Math.round(workdayState.manualClosedStats.doneCount)):0;return{timeMs,doneCount}}

function computeAggregatedWorkdayStats(now=Date.now(),options){const base=getManualWorkdayStats();let delta={timeMs:0,doneCount:0};const includeDelta=!workdayState||workdayState.closedManually!==true;if(includeDelta){delta=computeWorkdayProgress(now,options)}return{timeMs:base.timeMs+delta.timeMs,doneCount:base.doneCount+delta.doneCount,base,delta}}

function updateWorkdayCompletionState(task,done,now=Date.now()){if(!task)return;const info=ensureWorkdayState(now);if(!workdayState)return;const completed=workdayState.completed||(workdayState.completed={});let changed=false;if(done){if(info.state==='active'&&workdayState.id===info.id&&!completed[task.id]){completed[task.id]=now;changed=true}}else if(completed[task.id]){delete completed[task.id];changed=true}if(changed)WorkdayStore.write(workdayState)}

function ensureWorkdayState(now=Date.now()){const info=getWorkdayInfo(now);if(info.state==='active'){if(!workdayState||workdayState.id!==info.id){workdayState=createWorkdaySnapshot(info);WorkdayStore.write(workdayState)}else{if(workdayState.start!==info.start||workdayState.end!==info.end){workdayState.start=info.start;workdayState.end=info.end;workdayState.locked=false;workdayState.closedManually=false;workdayState.manualClosedStats={timeMs:0,doneCount:0};WorkdayStore.write(workdayState)}if(workdayState.closedAt&&now<workdayState.end&&!workdayState.closedManually){workdayState.closedAt=null;workdayState.finalTimeMs=0;workdayState.finalDoneCount=0;workdayState.locked=false;workdayState.closedManually=false;workdayState.manualClosedStats={timeMs:0,doneCount:0};WorkdayStore.write(workdayState)}}}else if(workdayState&&now>=workdayState.end&&(!workdayState.locked||workdayState.closedManually)){const summary=computeAggregatedWorkdayStats(workdayState.end,{persist:true,allowBaselineUpdate:true});workdayState.finalTimeMs=summary.timeMs;workdayState.finalDoneCount=summary.doneCount;workdayState.locked=true;workdayState.closedAt=now;workdayState.closedManually=false;workdayState.manualClosedStats={timeMs:summary.timeMs,doneCount:summary.doneCount};WorkdayStore.write(workdayState);if(hasActiveTimer()){stopAllTimersExcept(null);Store.write(tasks);syncTimerLoop()}}return info}

function formatTimeHM(ms){const d=new Date(ms);if(isNaN(d))return'';return`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`}

function formatDateDMY(ms){const d=new Date(ms);if(isNaN(d))return'';return`${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`}

function formatWorkdayRangeShort(start,end){if(typeof start!=='number'||typeof end!=='number')return'';const startTime=formatTimeHM(start);const endTime=formatTimeHM(end);return`${startTime} — ${endTime}`}

function formatWorkdayRangeLong(start,end){if(typeof start!=='number'||typeof end!=='number')return'';const startDate=formatDateDMY(start);const endDate=formatDateDMY(end);const startTime=formatTimeHM(start);const endTime=formatTimeHM(end);if(startDate===endDate)return`${startDate} ${startTime} — ${endTime}`;return`${startDate} ${startTime} — ${endDate} ${endTime}`}

function collectWorkdayCompletedTasks(state){if(!state||!state.completed)return[];const result=[];const start=typeof state.start==='number'?state.start:null;const end=typeof state.end==='number'?state.end:null;for(const [id,stamp]of Object.entries(state.completed)){if(typeof stamp!=='number'||(start!==null&&stamp<start)||(end!==null&&stamp>end))continue;const task=findTask(id);if(!task||!task.done)continue;const projectMeta=task.project?getProjectMeta(task.project):null;result.push({id,title:task.title||'Без названия',completedAt:stamp,project:projectMeta})}result.sort((a,b)=>a.completedAt-b.completedAt||a.title.localeCompare(b.title,'ru',{sensitivity:'base'}));return result}

function collectWorkdayPendingTasks(state){if(!state)return[];const key=workdayDateKey(state.start);const result=[];walkTasks(tasks,item=>{if(!item||item.done||!item.due)return;const dueDate=new Date(item.due);if(isNaN(dueDate))return;const dueKey=workdayDateKey(dueDate);if(dueKey&&dueKey===key){const projectMeta=item.project?getProjectMeta(item.project):null;result.push({id:item.id,title:item.title||'Без названия',due:dueDate,project:projectMeta})}});result.sort((a,b)=>a.due-b.due||a.title.localeCompare(b.title,'ru',{sensitivity:'base'}));return result}

function updateWorkdayDialogContent(){if(!WorkdayUI.overlay)return;const now=Date.now();const info=ensureWorkdayState(now);const hasState=!!workdayState;let stats={timeMs:0,doneCount:0};if(hasState){if(info.state==='active'&&workdayState.id===info.id){const aggregated=computeAggregatedWorkdayStats(now,{persist:true,allowBaselineUpdate:true});stats={timeMs:aggregated.timeMs,doneCount:aggregated.doneCount}}else{stats={timeMs:workdayState.finalTimeMs||0,doneCount:workdayState.finalDoneCount||0}}}if(WorkdayUI.summaryTime)WorkdayUI.summaryTime.textContent=formatDuration(stats.timeMs);if(WorkdayUI.summaryDone)WorkdayUI.summaryDone.textContent=String(stats.doneCount);if(WorkdayUI.range)WorkdayUI.range.textContent=hasState?formatWorkdayRangeLong(workdayState.start,workdayState.end):'';const pending=hasState?collectWorkdayPendingTasks(workdayState):[];const manuallyClosed=hasState&&workdayState.closedManually;const activeNow=hasState&&info.state==='active'&&workdayState.id===info.id&&!manuallyClosed;const completed=activeNow&&hasState?collectWorkdayCompletedTasks(workdayState):[];if(WorkdayUI.title){WorkdayUI.title.textContent=activeNow?'Промежуточные итоги':'Итоги рабочего дня'}if(WorkdayUI.completedSection)WorkdayUI.completedSection.style.display=activeNow?'block':'none';if(WorkdayUI.completedList){WorkdayUI.completedList.innerHTML='';if(activeNow&&completed.length){for(const item of completed){const li=document.createElement('li');const title=document.createElement('div');title.className='workday-dialog-task-title';title.textContent=item.title;li.appendChild(title);const meta=document.createElement('div');meta.className='workday-dialog-task-meta';const parts=[];const completedDate=new Date(item.completedAt);parts.push(`Завершено в ${formatTimeHM(completedDate)}`);if(item.project&&item.project.title){const emoji=item.project.emoji?`${item.project.emoji} `:'';parts.push(`Проект: ${emoji}${item.project.title}`.trim())}meta.textContent=parts.join(' • ');li.appendChild(meta);WorkdayUI.completedList.appendChild(li)}}if(WorkdayUI.completedEmpty)WorkdayUI.completedEmpty.style.display=activeNow&&!completed.length?'block':'none';WorkdayUI.completedList.style.display=activeNow&&completed.length?'flex':'none'}if(WorkdayUI.pendingList){
  WorkdayUI.pendingList.innerHTML='';
  if(pending.length){
    for(const item of pending){
      const li=document.createElement('li');
      const title=document.createElement('div');
      title.className='workday-dialog-task-title';
      title.textContent=item.title;
      li.appendChild(title);
      const meta=document.createElement('div');
      meta.className='workday-dialog-task-meta';
      const parts=[];
      parts.push(`Дедлайн: ${formatDateDMY(item.due)}`);
      if(item.project&&item.project.title){
        const emoji=item.project.emoji?`${item.project.emoji} `:'';
        parts.push(`Проект: ${emoji}${item.project.title}`.trim());
      }
      meta.textContent=parts.join(' • ');
      li.appendChild(meta);
      WorkdayUI.pendingList.appendChild(li);
    }
  }
  if(WorkdayUI.emptyState)WorkdayUI.emptyState.style.display=pending.length?'none':'block';
  WorkdayUI.pendingList.style.display=pending.length?'flex':'none';
}
  if(WorkdayUI.postponeBtn)WorkdayUI.postponeBtn.disabled=!pending.length;
  return pending
}

function openWorkdayDialog(){if(!WorkdayUI.overlay)return;const pending=updateWorkdayDialogContent();WorkdayUI.overlay.classList.add('is-open');WorkdayUI.overlay.setAttribute('aria-hidden','false');document.body.classList.add('workday-dialog-open');if(WorkdayUI.postponeBtn)WorkdayUI.postponeBtn.disabled=!pending.length;setTimeout(()=>{if(WorkdayUI.postponeBtn&&!WorkdayUI.postponeBtn.disabled){try{WorkdayUI.postponeBtn.focus({preventScroll:true})}catch{WorkdayUI.postponeBtn.focus()}}},80)}

function closeWorkdayDialog(){if(!WorkdayUI.overlay)return;WorkdayUI.overlay.classList.remove('is-open');WorkdayUI.overlay.setAttribute('aria-hidden','true');document.body.classList.remove('workday-dialog-open')}

function postponePendingTasks(){if(!workdayState)return;const pending=collectWorkdayPendingTasks(workdayState);if(!pending.length){toast('Все задачи уже перенесены');return}const nextDay=new Date(workdayState.start);nextDay.setDate(nextDay.getDate()+1);nextDay.setHours(0,0,0,0);const nextIso=nextDay.toISOString();let changed=false;const updatedIds=[];for(const item of pending){const task=findTask(item.id);if(!task)continue;task.due=nextIso;changed=true;if(isServerMode())updatedIds.push(task.id)}if(changed){Store.write(tasks);if(updatedIds.length){updatedIds.forEach(id=>queueTaskUpdate(id,{due:nextIso}))}render();toast('Дедлайны перенесены на следующий день');updateWorkdayDialogContent()}}
function finishWorkdayAndArchive(){
  if(!workdayState){closeWorkdayDialog();return}
  const now=Date.now();
  ensureWorkdayState(now);
  const aggregated=computeAggregatedWorkdayStats(now,{persist:true,allowBaselineUpdate:true});
  workdayState.manualClosedStats={timeMs:aggregated.timeMs,doneCount:aggregated.doneCount};
  workdayState.finalTimeMs=aggregated.timeMs;
  workdayState.finalDoneCount=aggregated.doneCount;
  workdayState.closedAt=now;
  workdayState.closedManually=true;
  workdayState.locked=false;
  WorkdayStore.write(workdayState);
  if(hasActiveTimer()){
    stopAllTimersExcept(null);
    Store.write(tasks);
    syncTimerLoop()
  }
  const archived=archiveCompletedTasks(now);
  let normalizedArchived=[];
  if(archived.length){
    normalizedArchived=archived.map(item=>normalizeArchivedNode(item)).filter(Boolean);
    if(normalizedArchived.length){
      archivedTasks=[...normalizedArchived,...archivedTasks];
      ArchiveStore.write(archivedTasks);
      if(workdayState&&workdayState.completed){
        let removedAny=false;
        const stack=[...normalizedArchived];
        while(stack.length){
          const entry=stack.pop();
          if(entry&&workdayState.completed[entry.id]){
            delete workdayState.completed[entry.id];
            removedAny=true
          }
          if(entry&&Array.isArray(entry.children)&&entry.children.length){
            for(const child of entry.children)stack.push(child)
          }
        }
        if(removedAny)WorkdayStore.write(workdayState)
      }
    }
  }
  if(NotesPanel.taskId&&!findTask(NotesPanel.taskId)){closeNotesPanel()}
  if(selectedTaskId&&!findTask(selectedTaskId)){selectedTaskId=null}
  Store.write(tasks);
  if(isServerMode()){
    const completedIds=normalizedArchived.map(item=>item.id);
    const workdayPayload={
      id:workdayState.id,
      startTs:workdayState.start||null,
      endTs:workdayState.end||null,
      summaryTimeMs:aggregated.timeMs,
      summaryDone:aggregated.doneCount,
      payload:{...workdayState},
      closedAt:new Date(now).toISOString()
    };
    runServerAction(()=>apiRequest('/workday/close',{method:'POST',body:{workday:workdayPayload,completedTaskIds:completedIds}}),{
      onSuccess:()=>refreshDataForCurrentMode({silent:true}),
      onError:()=>refreshDataForCurrentMode({silent:true})
    });
  }
  closeWorkdayDialog();
  render();
  updateWorkdayUI();
  if(normalizedArchived.length){toast('Выполненные задачи отправлены в архив')}else{toast('Рабочий день закрыт')}
}

let workdayRefreshTimer=null;

function updateWorkdayUI(){if(!WorkdayUI.bar)return;const now=Date.now();const info=ensureWorkdayState(now);let datasetState='inactive';let stats={timeMs:0,doneCount:0};const hasState=!!workdayState;const isCurrent=hasState&&info.state==='active'&&workdayState.id===info.id;const isLocked=hasState&&workdayState.locked;const manuallyClosed=hasState&&workdayState.closedManually;if(isCurrent){const aggregated=computeAggregatedWorkdayStats(now,{persist:true,allowBaselineUpdate:true});stats={timeMs:aggregated.timeMs,doneCount:aggregated.doneCount};datasetState=manuallyClosed?'closed':'active'}else if(hasState){if(!isLocked&&now<workdayState.end){const aggregated=computeAggregatedWorkdayStats(now,{persist:true,allowBaselineUpdate:true});stats={timeMs:aggregated.timeMs,doneCount:aggregated.doneCount}}else{stats={timeMs:workdayState.finalTimeMs||0,doneCount:workdayState.finalDoneCount||0}}if(info.state==='waiting'){datasetState='waiting'}else{datasetState='inactive'}}if(WorkdayUI.done)WorkdayUI.done.textContent=String(stats.doneCount);if(WorkdayUI.time)WorkdayUI.time.textContent=formatDuration(stats.timeMs);WorkdayUI.bar.dataset.state=datasetState;if(WorkdayUI.button){const canInteract=!!workdayState;WorkdayUI.button.disabled=!canInteract;WorkdayUI.button.setAttribute('aria-disabled',canInteract?'false':'true')}}

function ensureWorkdayRefreshLoop(){if(workdayRefreshTimer)return;workdayRefreshTimer=setInterval(()=>updateWorkdayUI(),WORKDAY_REFRESH_INTERVAL)}

function totalTimeMs(task,now=Date.now()){if(!task)return 0;const base=typeof task.timeSpent==='number'&&isFinite(task.timeSpent)?Math.max(0,task.timeSpent):0;if(task.timerActive&&typeof task.timerStart==='number'&&isFinite(task.timerStart)){const diff=Math.max(0,now-task.timerStart);return base+diff}return base}
function formatDuration(ms){if(!ms)return'0 мин';const totalMinutes=Math.floor(ms/60000);if(totalMinutes<=0)return'0 мин';const hours=Math.floor(totalMinutes/60);const minutes=totalMinutes%60;const parts=[];if(hours>0)parts.push(`${hours} ч`);if(minutes>0||!parts.length)parts.push(`${minutes} мин`);return parts.join(' ')}
function hasActiveTimer(list=tasks){if(!Array.isArray(list))return false;for(const item of list){if(item&&item.timerActive)return true;if(item&&Array.isArray(item.children)&&item.children.length&&hasActiveTimer(item.children))return true}return false}
function ensureTimerLoop(){if(timerInterval)return;timerInterval=setInterval(()=>updateTimerDisplays(),TIME_UPDATE_INTERVAL)}
function stopTimerLoop(){if(timerInterval){clearInterval(timerInterval);timerInterval=null}}
function syncTimerLoop(){if(hasActiveTimer())ensureTimerLoop();else stopTimerLoop();updateTimerDisplays()}
function updateTimerDisplays(){const rows=$$('#tasks .task[data-id]');const now=Date.now();for(const row of rows){const id=row.dataset.id;const task=findTask(id);if(!task)continue;const timeEl=row.querySelector('.time-spent');if(timeEl){const timeSpentMs=totalTimeMs(task,now);if(timeSpentMs>0){timeEl.textContent=formatDuration(timeSpentMs);timeEl.hidden=false;}else{timeEl.textContent='';timeEl.hidden=true;}}const timerBtn=row.querySelector('.timer-btn');if(timerBtn){timerBtn.dataset.active=task.timerActive?'true':'false';timerBtn.title=task.timerActive?'Остановить таймер':'Запустить таймер';timerBtn.setAttribute('aria-pressed',task.timerActive?'true':'false')}}updateWorkdayUI()}
function stopTaskTimer(task,{silent=false}={}){if(!task||!task.timerActive)return;const now=Date.now();if(typeof task.timerStart==='number'&&isFinite(task.timerStart)){task.timeSpent=totalTimeMs(task,now)}if(typeof task.timeSpent!=='number'||!isFinite(task.timeSpent))task.timeSpent=0;task.timerActive=false;task.timerStart=null;if(!silent){Store.write(tasks);if(isServerMode())queueTaskUpdate(task.id,{timeSpent:task.timeSpent})}}
function stopAllTimersExcept(activeId,list=tasks){if(!Array.isArray(list))return;for(const item of list){if(!item)continue;if(item.timerActive&&item.id!==activeId){stopTaskTimer(item,{silent:true})}if(Array.isArray(item.children)&&item.children.length){stopAllTimersExcept(activeId,item.children)}}}
function startTaskTimer(task){if(!task)return;if(task.timerActive)return;stopAllTimersExcept(task.id);task.timerActive=true;task.timerStart=Date.now();Store.write(tasks);syncTimerLoop()}
function toggleTaskTimer(id){const task=findTask(id);if(!task)return;if(task.timerActive){stopTaskTimer(task,{silent:true});Store.write(tasks);if(isServerMode())queueTaskUpdate(task.id,{timeSpent:task.timeSpent});syncTimerLoop()}else{startTaskTimer(task)}}
function setSprintDropColumn(col){if(sprintDropColumn===col)return;if(sprintDropColumn){sprintDropColumn.classList.remove('is-drop-target')}sprintDropColumn=col||null;if(sprintDropColumn){sprintDropColumn.classList.add('is-drop-target')}}
function clearSprintDragState(){const prev=document.querySelector('.sprint-task.is-dragging');if(prev)prev.classList.remove('is-dragging');setSprintDropColumn(null);sprintDraggingId=null}
function applySprintDrop(targetDate){if(!sprintDraggingId)return;const task=findTask(sprintDraggingId);if(!task)return;const d=new Date(targetDate);if(isNaN(d))return;d.setHours(0,0,0,0);const iso=d.toISOString();if(task.due!==iso){task.due=iso;Store.write(tasks);if(isServerMode())queueTaskUpdate(task.id,{due:iso})}clearSprintDragState();render()}
function setDropTarget(id){if(dropTargetId===id||dropTargetId===null&&id===null)return;if(dropTargetId){const prev=document.querySelector(`.task[data-id="${dropTargetId}"]`);prev&&prev.classList.remove('is-drop-target')}dropTargetId=id||null;if(dropTargetId){const el=document.querySelector(`.task[data-id="${dropTargetId}"]`);el&&el.classList.add('is-drop-target')}}
function clearDragIndicators(){if(draggingTaskId){const dragEl=document.querySelector(`.task[data-id="${draggingTaskId}"]`);dragEl&&dragEl.classList.remove('is-dragging')}setDropTarget(null);draggingTaskId=null}
function rowClass(t){return'task'+(selectedTaskId===t.id?' is-selected':'')+(t.done?' done':'')}
function getVisibleTaskIds(){return $$('#tasks .task[data-id]').map(el=>el.dataset.id)}
function addTask(title){
  title=String(title||'').trim();
  if(!title) return;
  let assignedProject=null;
  if(currentView==='project'&&currentProjectId){
    const exists=projects.some(p=>p&&p.id===currentProjectId);
    if(exists)assignedProject=currentProjectId;
  }
  let dueDate=null;
  if(currentView==='today'){
    const today=new Date();
    today.setHours(0,0,0,0);
    dueDate=today.toISOString();
  }
  const task={id:uid(),title,done:false,children:[],collapsed:false,due:dueDate,project:assignedProject,notes:'',timeSpent:0,timerActive:false,timerStart:null,parentId:null};
  tasks.unshift(task);
  Store.write(tasks);
  if(isServerMode())queueTaskCreate(task);
  render()
}
function addSubtask(parentId){const p=findTask(parentId);if(!p) return;const depth=getTaskDepth(parentId);if(depth===-1||depth>=MAX_TASK_DEPTH){toast('Максимальная вложенность — три уровня');return}const inheritedProject=typeof p.project==='undefined'?null:p.project;const child={id:uid(),title:'',done:false,children:[],collapsed:false,due:null,project:inheritedProject,notes:'',timeSpent:0,timerActive:false,timerStart:null,parentId:parentId};p.children.push(child);p.collapsed=false;Store.write(tasks);if(isServerMode())pendingServerCreates.add(child.id);pendingEditId=child.id;render()}
function toggleTask(id){const t=findTask(id);if(!t) return;const now=Date.now();const wasDone=t.done;const nextDone=!wasDone;t.done=nextDone;updateWorkdayCompletionState(t,nextDone,now);if(nextDone)stopTaskTimer(t,{silent:true});Store.write(tasks);if(isServerMode()){const payload={done:nextDone};if(nextDone&&typeof t.timeSpent==='number')payload.timeSpent=t.timeSpent;queueTaskUpdate(id,payload)}syncTimerLoop();render();handleTaskCompletionEffects(id,{completed:!wasDone&&nextDone,undone:wasDone&&!nextDone});toast(nextDone?'Отмечено как выполнено':'Снята отметка выполнения')}
function markTaskDone(id){const t=findTask(id);if(!t)return;if(t.done){toast('Задача уже выполнена');return}const now=Date.now();t.done=true;updateWorkdayCompletionState(t,true,now);stopTaskTimer(t,{silent:true});Store.write(tasks);if(isServerMode()){const payload={done:true};if(typeof t.timeSpent==='number')payload.timeSpent=t.timeSpent;queueTaskUpdate(id,payload)}syncTimerLoop();render();handleTaskCompletionEffects(id,{completed:true});toast('Отмечено как выполнено')}
function cloneTaskForArchive(task,{archivedAt,completedLookup,children=[]}){
  const completedAt=completedLookup&&typeof completedLookup[task.id]==='number'&&isFinite(completedLookup[task.id])?completedLookup[task.id]:null;
  return{
    id:task.id,
    title:task.title||'',
    done:true,
    due:typeof task.due==='string'&&task.due?task.due:null,
    project:typeof task.project==='string'&&task.project?task.project:null,
    notes:typeof task.notes==='string'?task.notes:'',
    timeSpent:totalTimeMs(task,archivedAt),
    archivedAt,
    completedAt,
    children
  }
}
function partitionTasksForArchive(list,completedLookup,archivedAt){
  const remaining=[];
  const archived=[];
  if(!Array.isArray(list))return{remaining,archived};
  for(const task of list){
    if(!task||typeof task!=='object')continue;
    const childList=Array.isArray(task.children)?task.children:[];
    const{remaining:childRemaining,archived:childArchived}=partitionTasksForArchive(childList,completedLookup,archivedAt);
    task.children=childRemaining;
    if(task.done){
      const clone=cloneTaskForArchive(task,{archivedAt,completedLookup,children:childArchived});
      archived.push(clone)
    }else{
      if(childArchived.length)archived.push(...childArchived);
      remaining.push(task)
    }
  }
  return{remaining,archived}
}
function archiveCompletedTasks(now=Date.now()){
  const lookup=workdayState&&workdayState.completed?workdayState.completed:null;
  const{remaining,archived}=partitionTasksForArchive(tasks,lookup,now);
  if(!archived.length)return[];
  tasks=remaining;
  return archived
}
function deleteTask(id,list=tasks){if(!Array.isArray(list))return null;for(let i=0;i<list.length;i++){const item=list[i];if(item.id===id){const removed=list.splice(i,1)[0];return removed||null}const childRemoved=deleteTask(id,item.children||[]);if(childRemoved)return childRemoved}return null}
function handleDelete(id,{visibleOrder=null}={}){
  if(!Array.isArray(visibleOrder))visibleOrder=getVisibleTaskIds();
  const target=findTask(id);
  if(target)stopTaskTimer(target,{silent:true});
  const removed=deleteTask(id,tasks);
  if(!removed)return;
  const wasPendingCreate=pendingServerCreates.delete(id);
  if(NotesPanel.taskId===id)closeNotesPanel();
  let nextId=null;
  if(visibleOrder){
    const idx=visibleOrder.indexOf(id);
    if(idx!==-1){
      for(let i=idx+1;i<visibleOrder.length;i++){const cand=visibleOrder[i];if(cand&&cand!==id&&findTask(cand)){nextId=cand;break}}
      if(!nextId){for(let i=idx-1;i>=0;i--){const cand=visibleOrder[i];if(cand&&cand!==id&&findTask(cand)){nextId=cand;break}}}
    }
  }
  if(nextId){selectedTaskId=nextId}else if(selectedTaskId===id){selectedTaskId=null}
  Store.write(tasks);
  if(isServerMode()&&!wasPendingCreate)queueTaskDelete(id);
  syncTimerLoop();
  render()
}
function renameTask(id,title){const t=findTask(id);if(!t) return;const v=String(title||'').trim();if(v&&v!==t.title){t.title=v;if(NotesPanel.taskId===id&&NotesPanel.title)NotesPanel.title.textContent=t.title;Store.write(tasks);if(isServerMode()){if(pendingServerCreates.has(id)){queueTaskCreate(t);pendingServerCreates.delete(id);}else queueTaskUpdate(id,{title:v});}}render()}
function toggleCollapse(id){const t=findTask(id);if(!t) return;t.collapsed=!t.collapsed;Store.write(tasks);render()}

const Ctx={el:$('#ctxMenu'),taskId:null,sub:document.getElementById('ctxSub'),submenuAnchor:null};
const NotesPanel={panel:document.getElementById('notesSidebar'),overlay:document.getElementById('notesOverlay'),close:document.getElementById('notesClose'),title:document.getElementById('notesTaskTitle'),input:document.getElementById('notesInput'),taskId:null,mode:'tasks'};
const TimeDialog={overlay:document.getElementById('timeOverlay'),close:document.getElementById('timeDialogClose'),cancel:document.getElementById('timeDialogCancel'),form:document.getElementById('timeDialogForm'),hours:document.getElementById('timeInputHours'),minutes:document.getElementById('timeInputMinutes'),summary:document.getElementById('timeDialogSummary'),subtitle:document.getElementById('timeDialogSubtitle'),error:document.getElementById('timeDialogError'),save:document.getElementById('timeDialogSave')};
let timeDialogTaskId=null;

function updateNoteIndicator(taskId){const btn=document.querySelector(`.task[data-id="${taskId}"] .note-btn`);if(btn){const t=findTask(taskId);btn.dataset.hasNotes=t&&t.notes&&t.notes.trim()? 'true':'false'}}

function openNotesPanel(taskId,{source='tasks'}={}){if(!NotesPanel.panel||!NotesPanel.overlay||!NotesPanel.input)return;closeContextMenu();const isArchive=source==='archive';const task=isArchive?findArchivedTask(taskId):findTask(taskId);if(!task)return;NotesPanel.taskId=taskId;NotesPanel.mode=isArchive?'archive':'tasks';if(NotesPanel.title)NotesPanel.title.textContent=task.title||'';NotesPanel.input.value=task.notes||'';NotesPanel.input.readOnly=isArchive;NotesPanel.input.classList.toggle('is-readonly',isArchive);if(isArchive){NotesPanel.input.setAttribute('aria-readonly','true')}else{NotesPanel.input.removeAttribute('aria-readonly')}NotesPanel.overlay.classList.add('is-visible');NotesPanel.overlay.setAttribute('aria-hidden','false');NotesPanel.panel.classList.add('is-open');NotesPanel.panel.setAttribute('aria-hidden','false');document.body.classList.add('notes-open');if(!isArchive){setTimeout(()=>{try{NotesPanel.input.focus({preventScroll:true})}catch{NotesPanel.input.focus()}},60);updateNoteIndicator(taskId)}}

function closeNotesPanel(){if(!NotesPanel.panel||!NotesPanel.overlay)return;NotesPanel.taskId=null;NotesPanel.mode='tasks';NotesPanel.overlay.classList.remove('is-visible');NotesPanel.overlay.setAttribute('aria-hidden','true');NotesPanel.panel.classList.remove('is-open');NotesPanel.panel.setAttribute('aria-hidden','true');document.body.classList.remove('notes-open');if(NotesPanel.title)NotesPanel.title.textContent='';if(NotesPanel.input){NotesPanel.input.value='';NotesPanel.input.readOnly=false;NotesPanel.input.classList.remove('is-readonly');NotesPanel.input.removeAttribute('aria-readonly')}}
function parseTimeDialogInput({normalize=false}={}){if(!TimeDialog.hours||!TimeDialog.minutes)return{valid:false,totalMinutes:0,hours:0,minutes:0};let hours=Number.parseInt(TimeDialog.hours.value,10);let minutes=Number.parseInt(TimeDialog.minutes.value,10);if(!Number.isFinite(hours))hours=0;if(!Number.isFinite(minutes))minutes=0;if(hours<0||minutes<0)return{valid:false,totalMinutes:0,hours,minutes};if(normalize){hours=Math.max(0,Math.floor(hours));minutes=Math.max(0,Math.floor(minutes));if(minutes>=60){hours+=Math.floor(minutes/60);minutes%=60}TimeDialog.hours.value=String(hours);TimeDialog.minutes.value=String(minutes)}const totalMinutes=Math.max(0,hours*60+minutes);return{valid:true,totalMinutes,hours,minutes}}
function setTimeDialogError(msg){if(!TimeDialog.error)return;TimeDialog.error.textContent=msg||''}
function updateTimeDialogSummary(){const{valid,totalMinutes}=parseTimeDialogInput({normalize:false});if(TimeDialog.summary)TimeDialog.summary.textContent=formatDuration(Math.max(0,totalMinutes)*60000);if(TimeDialog.save)TimeDialog.save.disabled=!valid;if(valid)setTimeDialogError('')}
function openTimeEditDialog(taskId){const task=findTask(taskId);if(!task||!TimeDialog.overlay)return;timeDialogTaskId=taskId;const currentMinutes=Math.max(0,Math.round(totalTimeMs(task)/60000));const hours=Math.floor(currentMinutes/60);const minutes=currentMinutes%60;if(TimeDialog.hours)TimeDialog.hours.value=String(hours);if(TimeDialog.minutes)TimeDialog.minutes.value=String(minutes);if(TimeDialog.subtitle)TimeDialog.subtitle.textContent=currentMinutes?`Текущее значение: ${formatDuration(currentMinutes*60000)}`:'Текущее значение: 0 мин';setTimeDialogError('');updateTimeDialogSummary();TimeDialog.overlay.classList.add('is-open');TimeDialog.overlay.setAttribute('aria-hidden','false');document.body.classList.add('time-dialog-open');const focusTarget=TimeDialog.minutes||TimeDialog.hours;setTimeout(()=>{if(!focusTarget)return;try{focusTarget.focus({preventScroll:true})}catch{focusTarget.focus()}},60)}
function closeTimeDialog(){if(!TimeDialog.overlay)return;timeDialogTaskId=null;TimeDialog.overlay.classList.remove('is-open');TimeDialog.overlay.setAttribute('aria-hidden','true');document.body.classList.remove('time-dialog-open');setTimeDialogError('');if(TimeDialog.save)TimeDialog.save.disabled=false}
function submitTimeDialog(){if(!timeDialogTaskId)return;const task=findTask(timeDialogTaskId);if(!task){closeTimeDialog();return}const{valid,totalMinutes}=parseTimeDialogInput({normalize:true});if(!valid){setTimeDialogError('Введите неотрицательные значения');return}const minutes=Math.round(totalMinutes);task.timeSpent=Math.max(0,minutes)*60000;task.timerActive=false;task.timerStart=null;Store.write(tasks);if(isServerMode())queueTaskUpdate(task.id,{timeSpent:task.timeSpent});syncTimerLoop();render();toast(`Время обновлено: ${formatDuration(task.timeSpent)}`);closeTimeDialog()}
function openContextMenu(taskId,x,y){
  Ctx.taskId=taskId;const menu=Ctx.el;menu.innerHTML='';closeAssignSubmenu();closeDuePicker();
  const btnEdit=document.createElement('div');btnEdit.className='context-item';btnEdit.textContent='Редактировать';
  btnEdit.onclick=()=>{closeContextMenu();const row=document.querySelector(`.task[data-id="${taskId}"]`);const t=findTask(taskId);if(!t)return;if(row)startEdit(row,t);else{const next=prompt('Название задачи',t.title||'');if(next!==null)renameTask(taskId,next)}};
  const btnComplete=document.createElement('div');btnComplete.className='context-item';btnComplete.textContent='Отметить выполненной';
  btnComplete.onclick=()=>{closeContextMenu();markTaskDone(taskId)};
  const btnAssign=document.createElement('div');btnAssign.className='context-item';btnAssign.textContent='Проект ▸';
  btnAssign.addEventListener('mouseenter',()=>{openAssignSubmenu(taskId,btnAssign);closeDuePicker()});
  btnAssign.addEventListener('mouseleave',()=>maybeCloseSubmenu());
  const btnTime=document.createElement('div');btnTime.className='context-item';btnTime.textContent='Время…';
  btnTime.onclick=()=>{closeContextMenu();openTimeEditDialog(taskId)};
  const btnDue=document.createElement('div');btnDue.className='context-item';btnDue.textContent='Дата ▸';btnDue.dataset.menuAnchor='true';
  btnDue.addEventListener('mouseenter',()=>{closeAssignSubmenu();openDuePicker(taskId,btnDue,{fromContext:true})});
  btnDue.addEventListener('mouseleave',()=>{setTimeout(()=>{if(Due.el.dataset.fromContext==='true'){const anchor=Due.anchor;if(anchor&&anchor.matches(':hover'))return;if(Due.el.matches(':hover'))return;closeDuePicker()}},80)});
  menu.append(btnEdit,btnComplete,btnAssign,btnTime,btnDue);
  menu.style.display='block';
  const mw=menu.offsetWidth,mh=menu.offsetHeight;const px=Math.min(x,window.innerWidth-mw-8),py=Math.min(y,window.innerHeight-mh-8);
  menu.style.left=px+'px';menu.style.top=py+'px';
  menu.setAttribute('aria-hidden','false');
}
function closeContextMenu(){Ctx.taskId=null;Ctx.el.style.display='none';Ctx.el.setAttribute('aria-hidden','true');closeAssignSubmenu();if(Due.el&&Due.el.dataset.fromContext==='true')closeDuePicker()}
window.addEventListener('click',e=>{
  if(Due.el&&Due.el.style.display==='block'&&Due.el.dataset.fromContext==='true'){
    if(Due.el.contains(e.target))return;
    const anchor=Due.anchor;
    if(anchor&&anchor.contains(e.target))return;
  }
  if(!Ctx.el.contains(e.target)&&!Ctx.sub.contains(e.target))closeContextMenu()
});
window.addEventListener('keydown',e=>{if(e.key==='Escape'){closeContextMenu();closeNotesPanel();closeDuePicker();closeWorkdayDialog();closeTimeDialog();closeApiSettingsDialog()}});
window.addEventListener('resize',closeContextMenu);
window.addEventListener('scroll',closeContextMenu,true);

NotesPanel.overlay&&NotesPanel.overlay.addEventListener('click',()=>closeNotesPanel());
NotesPanel.close&&NotesPanel.close.addEventListener('click',()=>closeNotesPanel());
NotesPanel.input&&NotesPanel.input.addEventListener('input',()=>{if(NotesPanel.mode==='archive')return;if(!NotesPanel.taskId)return;const task=findTask(NotesPanel.taskId);if(!task)return;task.notes=NotesPanel.input.value;Store.write(tasks);if(isServerMode())queueTaskUpdate(task.id,{notes:task.notes},{debounce:true});updateNoteIndicator(task.id)});

TimeDialog.overlay&&TimeDialog.overlay.addEventListener('click',e=>{if(e.target===TimeDialog.overlay)closeTimeDialog()});
TimeDialog.close&&TimeDialog.close.addEventListener('click',()=>closeTimeDialog());
TimeDialog.cancel&&TimeDialog.cancel.addEventListener('click',()=>closeTimeDialog());
TimeDialog.form&&TimeDialog.form.addEventListener('submit',e=>{e.preventDefault();submitTimeDialog()});
for(const input of[TimeDialog.hours,TimeDialog.minutes]){if(!input)continue;input.addEventListener('input',()=>updateTimeDialogSummary());input.addEventListener('blur',()=>{const state=parseTimeDialogInput({normalize:true});updateTimeDialogSummary();if(!state.valid)setTimeDialogError('Введите неотрицательные значения')})}

function formatArchiveDateTime(ms){if(typeof ms!=='number'||!isFinite(ms)||ms<=0)return null;const date=new Date(ms);if(isNaN(date))return null;const timestamp=date.getTime();return`${formatDateDMY(timestamp)} ${formatTimeHM(timestamp)}`}
function renderArchivedNode(node,depth,container){if(!node)return;const row=document.createElement('div');row.className='archive-task';row.dataset.id=node.id;row.dataset.depth=String(depth);if(depth>0)row.style.marginLeft=`${depth*18}px`;const status=document.createElement('div');status.className='archive-status';status.textContent='✔';const main=document.createElement('div');main.className='archive-main';const title=document.createElement('div');title.className='archive-title';title.textContent=node.title||'Без названия';main.appendChild(title);const tags=document.createElement('div');tags.className='archive-tags';if(node.due){const dueTag=document.createElement('span');dueTag.className='due-tag';if(isDueToday(node.due))dueTag.classList.add('is-today');dueTag.textContent=formatDue(node.due);if(dueTag.textContent)tags.appendChild(dueTag)}if(node.project){const projectMeta=getProjectMeta(node.project);const projTag=document.createElement('span');projTag.className='proj-tag';const emoji=projectMeta.emoji?`${projectMeta.emoji} `:'';projTag.textContent=`${emoji}${projectMeta.title}`.trim();tags.appendChild(projTag)}if(tags.childElementCount)main.appendChild(tags);const meta=document.createElement('div');meta.className='archive-meta';const completedText=formatArchiveDateTime(node.completedAt);if(completedText)meta.appendChild(document.createTextNode(`Завершено: ${completedText}`));const archivedText=formatArchiveDateTime(node.archivedAt);if(archivedText){if(meta.textContent)meta.appendChild(document.createTextNode(' • '));meta.appendChild(document.createTextNode(`В архиве: ${archivedText}`))}if(meta.textContent)main.appendChild(meta);const actions=document.createElement('div');actions.className='archive-actions';const time=document.createElement('div');time.className='archive-time';time.textContent=formatDuration(node.timeSpent);actions.appendChild(time);const noteBtn=document.createElement('button');noteBtn.className='note-btn';noteBtn.type='button';noteBtn.textContent='📝';noteBtn.title='Открыть заметки';noteBtn.setAttribute('aria-label','Заметки задачи');noteBtn.dataset.hasNotes=node.notes&&node.notes.trim()? 'true':'false';noteBtn.onclick=e=>{e.stopPropagation();openNotesPanel(node.id,{source:'archive'})};actions.appendChild(noteBtn);const deleteBtn=document.createElement('button');deleteBtn.className='archive-delete';deleteBtn.type='button';deleteBtn.textContent='✕';deleteBtn.title='Удалить из архива';deleteBtn.setAttribute('aria-label','Удалить задачу из архива');deleteBtn.onclick=e=>{e.stopPropagation();const removed=removeArchivedTask(node.id);if(removed){ArchiveStore.write(archivedTasks);if(isServerMode())queueArchiveDelete(node.id);if(currentView==='archive')render()}};actions.appendChild(deleteBtn);row.append(status,main,actions);container.appendChild(row);if(Array.isArray(node.children)&&node.children.length){for(const child of node.children){renderArchivedNode(child,depth+1,container)}}}
function renderArchive(container){const wrap=document.createElement('div');wrap.className='archive-container';const items=[...archivedTasks];items.sort((a,b)=>(b.archivedAt||0)-(a.archivedAt||0)||(b.completedAt||0)-(a.completedAt||0));if(!items.length){const empty=document.createElement('div');empty.className='archive-empty';empty.textContent='Архив пока пуст.';container.appendChild(empty);return}for(const item of items){renderArchivedNode(item,0,wrap)}container.appendChild(wrap)}
function render(){
  $$('.nav-btn').forEach(b=>b.classList.toggle('is-active',b.dataset.view===currentView));
  if(archiveBtn)archiveBtn.classList.toggle('is-active',currentView==='archive');
  if(currentView!=='sprint'){
    if(sprintVisibleProjects.size)sprintVisibleProjects.clear();
    clearSprintFiltersUI();
  }
  const composer=$('.composer');
  if(composer){
    const hide=currentView==='sprint'||currentView==='archive';
    if(composer.hidden!==hide)composer.hidden=hide;
    composer.setAttribute('aria-hidden',hide?'true':'false');
    document.body.classList.toggle('view-sprint',currentView==='sprint');
  }
  document.body.classList.toggle('view-archive',currentView==='archive');
  const wrap=$('#tasks');wrap.innerHTML='';
  if(currentView==='archive'){document.getElementById('viewTitle').textContent='Архив';renderArchive(wrap);updateWorkdayUI();return}
  if(currentView==='sprint'){document.getElementById('viewTitle').textContent='Спринт';renderSprint(wrap);syncTimerLoop();return}
  if(currentView==='project'){const proj=projects.find(p=>p.id===currentProjectId);document.getElementById('viewTitle').textContent=proj?proj.title:'Проект';const dataList=filterTree(tasks,t=>t.project===currentProjectId);if(!dataList.length){const empty=document.createElement('div');empty.className='task';empty.innerHTML='<div></div><div class="task-title">Нет задач этого проекта.</div><div></div>';wrap.appendChild(empty);syncTimerLoop();return}for(const t of dataList){renderTaskRow(t,0,wrap)}if(pendingEditId){const rowEl=document.querySelector(`[data-id="${pendingEditId}"]`);const taskObj=findTask(pendingEditId);if(rowEl&&taskObj)startEdit(rowEl,taskObj);pendingEditId=null}syncTimerLoop();return}
  document.getElementById('viewTitle').textContent=currentView==='today'?'Сегодня':'Все задачи';
  const dataList=currentView==='today'?filterTree(tasks,t=>isDueToday(t.due)):tasks;
  if(!dataList.length){const empty=document.createElement('div');empty.className='task';empty.innerHTML='<div></div><div class="task-title">Здесь пусто.</div><div></div>';wrap.appendChild(empty);syncTimerLoop();return}
  for(const t of dataList){renderTaskRow(t,0,wrap)}
  if(pendingEditId){const rowEl=document.querySelector(`[data-id="${pendingEditId}"]`);const taskObj=findTask(pendingEditId);if(rowEl&&taskObj)startEdit(rowEl,taskObj);pendingEditId=null}
  syncTimerLoop();
  updateWorkdayUI()
}

function renderTaskRow(t,depth,container){
  const canAcceptChildren=depth<MAX_TASK_DEPTH;
  const childList=Array.isArray(t.children)?t.children:[];
  const hasChildren=canAcceptChildren&&childList.length>0;
  const row=document.createElement('div');row.className=rowClass(t);row.dataset.id=t.id;row.dataset.depth=depth;row.classList.add('task-row');
  row.setAttribute('draggable','true');
  row.addEventListener('dragstart',e=>{draggingTaskId=t.id;row.classList.add('is-dragging');try{e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',t.id)}catch{}closeContextMenu()});
  row.addEventListener('dragend',()=>{clearDragIndicators()});
  row.addEventListener('dragenter',e=>{if(!draggingTaskId||draggingTaskId===t.id)return;if(!canAcceptChildren){setDropTarget(null);return}const dragged=findTask(draggingTaskId);if(!dragged)return;if(containsTask(dragged,t.id)){setDropTarget(null);return}const subtreeDepth=getSubtreeDepth(dragged);if(depth+1+subtreeDepth>MAX_TASK_DEPTH){setDropTarget(null);return}e.preventDefault();setDropTarget(t.id)});
  row.addEventListener('dragover',e=>{if(!draggingTaskId||draggingTaskId===t.id)return;const dragged=findTask(draggingTaskId);if(!dragged)return;if(!canAcceptChildren){if(e.dataTransfer)e.dataTransfer.dropEffect='none';return}if(containsTask(dragged,t.id))return;const subtreeDepth=getSubtreeDepth(dragged);if(depth+1+subtreeDepth>MAX_TASK_DEPTH){if(e.dataTransfer)e.dataTransfer.dropEffect='none';return}e.preventDefault();if(e.dataTransfer)e.dataTransfer.dropEffect='move'});
  row.addEventListener('dragleave',e=>{if(dropTargetId!==t.id)return;const rel=e.relatedTarget;if(rel&&row.contains(rel))return;setDropTarget(null)});
  row.addEventListener('drop',e=>{if(!draggingTaskId)return;e.preventDefault();const sourceId=draggingTaskId;clearDragIndicators();if(sourceId===t.id)return;const draggedTask=findTask(sourceId);const targetTask=findTask(t.id);if(!draggedTask||!targetTask)return;if(!canAcceptChildren){toast('Максимальная вложенность — три уровня');return}if(containsTask(draggedTask,t.id))return;const subtreeDepth=getSubtreeDepth(draggedTask);if(depth+1+subtreeDepth>MAX_TASK_DEPTH){toast('Максимальная вложенность — три уровня');return}const moved=detachTaskFromTree(sourceId);if(!moved)return;if(!Array.isArray(targetTask.children))targetTask.children=[];const inheritedProject=typeof targetTask.project==='undefined'?null:targetTask.project;targetTask.children.push(moved);moved.project=inheritedProject;moved.parentId=targetTask.id;targetTask.collapsed=false;Store.write(tasks);if(isServerMode())queueTaskUpdate(moved.id,{parentId:targetTask.id,project:moved.project});selectedTaskId=moved.id;render()});
  row.addEventListener('contextmenu',e=>{e.preventDefault();openContextMenu(t.id,e.clientX,e.clientY)});
  const cb=document.createElement('div');cb.className='task-checkbox';cb.dataset.checked=t.done?'true':'false';cb.title=t.done?'Снять отметку выполнения':'Отметить как выполненную';cb.setAttribute('role','button');cb.setAttribute('aria-label',cb.title);cb.setAttribute('aria-pressed',t.done?'true':'false');cb.setAttribute('tabindex','0');cb.onclick=e=>{e.stopPropagation();toggleTask(t.id)};cb.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '||e.key==='Spacebar'){e.preventDefault();toggleTask(t.id)}});
  const content=document.createElement('div');content.className='task-main';
  const title=document.createElement('div');title.className='task-title';
  const titleText=document.createElement('span');titleText.className='task-title-text';titleText.textContent=t.title;
  title.appendChild(titleText);
  content.appendChild(title);
  const tagsWrap=document.createElement('div');tagsWrap.className='task-tags';
  const timeBadge=document.createElement('span');
  timeBadge.className='time-spent';
  const timeSpentMs=totalTimeMs(t);
  if(timeSpentMs>0){
    timeBadge.textContent=formatDuration(timeSpentMs);
    timeBadge.hidden=false;
  }else{
    timeBadge.textContent='';
    timeBadge.hidden=true;
  }
  const timerBtn=document.createElement('button');timerBtn.className='timer-btn';timerBtn.type='button';timerBtn.textContent='⏱️';timerBtn.dataset.active=t.timerActive?'true':'false';timerBtn.title=t.timerActive?'Остановить таймер':'Запустить таймер';timerBtn.setAttribute('aria-label','Таймер задачи');timerBtn.setAttribute('aria-pressed',t.timerActive?'true':'false');timerBtn.onclick=e=>{e.stopPropagation();toggleTaskTimer(t.id)};
  const noteBtn=document.createElement('button');noteBtn.className='note-btn';noteBtn.type='button';noteBtn.setAttribute('aria-label','Заметки задачи');noteBtn.title='Открыть заметки';noteBtn.textContent='📝';noteBtn.onclick=e=>{e.stopPropagation();openNotesPanel(t.id)};noteBtn.dataset.hasNotes=t.notes&&t.notes.trim()? 'true':'false';
  const dueBtn=document.createElement('button');dueBtn.className='due-btn';dueBtn.title='Установить дедлайн';dueBtn.textContent='📅';dueBtn.onclick=e=>{e.stopPropagation();openDuePicker(t.id,dueBtn)};
  const del=document.createElement('button');del.className='delete-btn';del.type='button';del.setAttribute('aria-label','Удалить задачу');del.title='Удалить задачу';del.textContent='✕';del.onclick=e=>{e.stopPropagation();handleDelete(t.id)};
  if(t.due){const tag=document.createElement('span');tag.className='due-tag';if(isDueToday(t.due))tag.classList.add('is-today');tag.textContent=formatDue(t.due);tagsWrap.appendChild(tag)}
  if(t.project){const ptag=document.createElement('span');ptag.className='proj-tag';ptag.textContent=getProjectEmoji(t.project);tagsWrap.appendChild(ptag)}
  if(tagsWrap.childElementCount)content.appendChild(tagsWrap);
  const actions=document.createElement('div');actions.className='task-actions';actions.append(timeBadge,timerBtn,noteBtn,dueBtn);
  row.append(cb,content,actions,del);
  row.addEventListener('click',()=>{
    if(activeEditId&&activeEditId!==t.id){const v=(activeInputEl?.value||'').trim();if(!v){toast('Напиши, что нужно сделать');activeInputEl&&activeInputEl.focus();return}const id=activeEditId;activeEditId=null;activeInputEl=null;selectedTaskId=t.id;renameTask(id,v);return}
    selectedTaskId=t.id;render()
  });
  container.appendChild(row);
  if(hasChildren){row.classList.add('has-children');const subWrap=document.createElement('div');subWrap.className='subtasks';const inner=document.createElement('div');inner.className='subtasks-inner';for(const c of childList){renderTaskRow(c,depth+1,inner)}subWrap.appendChild(inner);container.appendChild(subWrap)}
}

function startEdit(row,t){
  const titleEl=row.querySelector('.task-title');
  const input=document.createElement('input');
  input.className='input';
  const originalTitle=typeof t.title==='string'?t.title:'';
  const isNewTask=!originalTitle.trim();
  input.value=originalTitle;
  input.placeholder='Название задачи…';
  input.addEventListener('mousedown',e=>e.stopPropagation());
  input.addEventListener('click',e=>e.stopPropagation());
  titleEl.replaceWith(input);
  input.focus();
  activeEditId=t.id;activeInputEl=input;
  let finished=false;
  const finish=()=>{finished=true;activeEditId=null;activeInputEl=null;};
  const trySave=()=>{
    if(finished||!input)return false;
    const v=(input.value||'').trim();
    if(!v){toast('Напиши, что нужно сделать');input.focus();return false}
    const id=t.id;
    finish();
    renameTask(id,v);
    return true
  };
  const cancelEdit=()=>{
    if(finished)return;
    finish();
    if(isNewTask){
      handleDelete(t.id,{visibleOrder:getVisibleTaskIds()});
      return;
    }
    selectedTaskId=t.id;
    render();
  };
  input.addEventListener('keydown',e=>{
    if(e.key==='Enter'){
      e.preventDefault();
      trySave();
    }else if(e.key==='Escape'||e.key==='Esc'){
      e.preventDefault();
      cancelEdit();
    }
  });
  input.addEventListener('blur',()=>{
    if(finished)return;
    setTimeout(()=>{
      if(finished)return;
      try{input.focus({preventScroll:true})}catch{input.focus();}
    },0)
  })
}

function applyTheme(mode){const dark=mode==='dark';document.body.classList.toggle('theme-dark',dark);const btn=$('#themeToggle');if(btn){const label=dark?'Переключить на светлую тему':'Переключить на тёмную тему';btn.dataset.mode=dark?'dark':'light';btn.setAttribute('aria-pressed',String(dark));btn.setAttribute('aria-label',label);btn.title=label}}
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
$$('.nav-btn').forEach(btn=>btn.onclick=()=>{const view=btn.dataset.view;if(view==='today'){currentView='today';render();return}if(view==='sprint'){currentView='sprint';render();return}currentView='all';render()});
if(archiveBtn){archiveBtn.addEventListener('click',()=>{currentView='archive';render()})}

const storageToggleBtn=document.getElementById('storageToggle');
if(storageToggleBtn){storageToggleBtn.addEventListener('click',async()=>{if(isDataLoading)return;if(isServerMode()){await setStorageModeAndReload(STORAGE_MODES.LOCAL);toast('Режим: localStorage')}else{if(!ensureApiCredentials())return;await setStorageModeAndReload(STORAGE_MODES.SERVER);toast('Режим: API')}})}

if(ApiSettingsDialog.close){ApiSettingsDialog.close.addEventListener('click',()=>closeApiSettingsDialog());}
if(ApiSettingsDialog.cancel){ApiSettingsDialog.cancel.addEventListener('click',()=>closeApiSettingsDialog());}
if(ApiSettingsDialog.overlay){ApiSettingsDialog.overlay.addEventListener('click',e=>{if(e.target===ApiSettingsDialog.overlay)closeApiSettingsDialog()});}
if(ApiSettingsDialog.form){ApiSettingsDialog.form.addEventListener('submit',submitApiSettingsForm);}

if(WorkdayUI.button){WorkdayUI.button.addEventListener('click',()=>{if(WorkdayUI.button.disabled)return;openWorkdayDialog()})}
if(WorkdayUI.closeBtn)WorkdayUI.closeBtn.addEventListener('click',()=>closeWorkdayDialog());
if(WorkdayUI.closeAction)WorkdayUI.closeAction.addEventListener('click',()=>finishWorkdayAndArchive());
if(WorkdayUI.overlay)WorkdayUI.overlay.addEventListener('click',e=>{if(e.target===WorkdayUI.overlay)closeWorkdayDialog()});
if(WorkdayUI.postponeBtn)WorkdayUI.postponeBtn.addEventListener('click',()=>postponePendingTasks());

const projList=$('#projList');
const projAdd=$('#projAdd');
const ProjCtx={el:document.getElementById('projCtxMenu'),id:null,anchor:null};
const emojiPickerHost=document.getElementById('emojiMenu');
const EmojiPicker={projectId:null,anchor:null,element:null};

function ensureEmojiPicker(){
  if(EmojiPicker.element||!emojiPickerHost)return EmojiPicker.element;
  const picker=document.createElement('emoji-picker');
  picker.classList.add('emoji-picker-element');
  try{picker.setAttribute('locale','ru')}catch{}
  picker.addEventListener('emoji-click',event=>{
    const unicode=event?.detail?.unicode;
    if(!unicode||!EmojiPicker.projectId)return;
    setProjectEmoji(EmojiPicker.projectId,unicode);
    closeEmojiPicker();
  });
  emojiPickerHost.appendChild(picker);
  EmojiPicker.element=picker;
  return picker;
}

function renderProjects(){
  if(!projList)return;
  projList.innerHTML='';
  if(!projects.length){const hint=document.createElement('div');hint.className='proj-item is-empty';hint.textContent='Проектов пока нет';projList.appendChild(hint);return}
  for(const p of projects){
    const row=document.createElement('div');row.className='proj-item';row.dataset.id=p.id;
    const emojiBtn=document.createElement('button');emojiBtn.type='button';emojiBtn.className='emoji-btn';emojiBtn.textContent=getProjectEmoji(p.id);emojiBtn.title='Выбрать эмодзи';emojiBtn.onclick=e=>{e.stopPropagation();openEmojiPicker(p.id,emojiBtn)};row.appendChild(emojiBtn);
    const name=document.createElement('div');name.className='name';name.textContent=p.title;row.appendChild(name);
    row.addEventListener('click',()=>{closeEmojiPicker();currentView='project';currentProjectId=p.id;render()});
    row.addEventListener('contextmenu',e=>{e.preventDefault();closeEmojiPicker();openProjMenu(p.id,e.clientX,e.clientY,row)});
    projList.appendChild(row)
  }
}

function closeEmojiPicker(){
  if(!emojiPickerHost)return;
  EmojiPicker.projectId=null;
  EmojiPicker.anchor=null;
  emojiPickerHost.style.display='none';
  emojiPickerHost.style.visibility='';
  emojiPickerHost.setAttribute('aria-hidden','true');
}

function setProjectEmoji(projectId,emoji){
  const proj=projects.find(p=>p.id===projectId);
  if(!proj)return;
  const normalized=typeof emoji==='string'&&emoji.trim()?emoji.trim():null;
  proj.emoji=normalized;
  ProjectsStore.write(projects);
  if(isServerMode())queueProjectUpdate(projectId,{emoji:normalized});
  renderProjects();
  render();
}

function openEmojiPicker(projectId,anchor){
  if(!emojiPickerHost)return;
  if(EmojiPicker.projectId===projectId&&emojiPickerHost.style.display==='block'){closeEmojiPicker();return}
  closeEmojiPicker();
  const picker=ensureEmojiPicker();
  EmojiPicker.projectId=projectId;
  EmojiPicker.anchor=anchor;
  if(picker){
    const proj=projects.find(p=>p.id===projectId);
    picker.value=proj&&proj.emoji?proj.emoji:'';
  }
  emojiPickerHost.style.display='block';
  emojiPickerHost.style.visibility='hidden';
  emojiPickerHost.setAttribute('aria-hidden','false');
  const rect=anchor.getBoundingClientRect();
  const hostRect=emojiPickerHost.getBoundingClientRect();
  const padding=8;
  const availableWidth=Math.max(160,window.innerWidth-padding*2);
  const width=hostRect.width||Math.min(availableWidth,360);
  const height=hostRect.height||360;
  const maxLeft=Math.max(padding,window.innerWidth-width-padding);
  const preferredLeft=Math.max(padding,rect.left);
  const left=Math.min(preferredLeft,maxLeft);
  const maxTop=Math.max(padding,window.innerHeight-height-padding);
  const preferredTop=Math.max(padding,rect.bottom+6);
  const top=Math.min(preferredTop,maxTop);
  emojiPickerHost.style.left=left+'px';
  emojiPickerHost.style.top=top+'px';
  emojiPickerHost.style.visibility='visible';
}

function openProjMenu(id,x,y,anchor){ProjCtx.id=id;ProjCtx.anchor=anchor;const menu=ProjCtx.el;menu.innerHTML='';const edit=document.createElement('div');edit.className='context-item';edit.textContent='Редактировать';edit.onclick=()=>{closeProjMenu();startProjectRename(id,anchor)};const del=document.createElement('div');del.className='context-item';del.textContent='Удалить';del.onclick=()=>{closeProjMenu();deleteProject(id)};menu.append(edit,del);menu.style.display='block';const mw=menu.offsetWidth,mh=menu.offsetHeight;const px=Math.min(x,window.innerWidth-mw-8),py=Math.min(y,window.innerHeight-mh-8);menu.style.left=px+'px';menu.style.top=py+'px';menu.setAttribute('aria-hidden','false')}
function closeProjMenu(){ProjCtx.id=null;ProjCtx.anchor=null;ProjCtx.el.style.display='none';ProjCtx.el.setAttribute('aria-hidden','true')}
window.addEventListener('click',e=>{if(!ProjCtx.el.contains(e.target))closeProjMenu()});
window.addEventListener('keydown',e=>{if(e.key==='Escape')closeProjMenu()});
window.addEventListener('resize',closeProjMenu);
window.addEventListener('scroll',closeProjMenu,true);
window.addEventListener('click',e=>{if(emojiPickerHost&&emojiPickerHost.style.display==='block'&&!emojiPickerHost.contains(e.target)&&!(EmojiPicker.anchor&&EmojiPicker.anchor.contains(e.target)))closeEmojiPicker()});
window.addEventListener('keydown',e=>{if(e.key==='Escape')closeEmojiPicker()});
window.addEventListener('resize',closeEmojiPicker);
window.addEventListener('scroll',closeEmojiPicker,true);

function startProjectRename(id,row){closeEmojiPicker();if(!projList)return;const p=projects.find(pr=>pr.id===id);if(!p)return;const target=row?.querySelector('.name')||[...projList.children].find(n=>n.dataset.id===id)?.querySelector('.name');if(!target)return;const input=document.createElement('input');input.className='proj-input';input.value=p.title;target.replaceWith(input);input.focus();input.select();let finished=false;const save=()=>{if(finished)return;finished=true;const v=(input.value||'').trim();if(!v){toast('Назови проект');input.focus();finished=false;return}p.title=v;ProjectsStore.write(projects);if(isServerMode())queueProjectUpdate(id,{title:v});renderProjects()};const cancel=()=>{if(finished)return;finished=true;renderProjects()};input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();save()}else if(e.key==='Escape'){e.preventDefault();cancel()}});input.addEventListener('blur',()=>{if(!finished)save()})}
function deleteProject(id){closeEmojiPicker();const idx=projects.findIndex(p=>p.id===id);if(idx===-1)return;projects.splice(idx,1);ProjectsStore.write(projects);if(isServerMode())queueProjectDelete(id);renderProjects();toast('Проект удалён')}
if(projAdd&&projList){projAdd.addEventListener('click',()=>{closeEmojiPicker();const placeholder=projList.firstElementChild;if(placeholder&&placeholder.classList.contains('is-empty')){placeholder.remove()}const row=document.createElement('div');row.className='proj-item';const input=document.createElement('input');input.className='proj-input';input.placeholder='Название проекта…';row.appendChild(input);if(projList.firstChild){projList.prepend(row)}else{projList.appendChild(row)}input.focus();let saved=false;const finish=save=>{if(saved)return;saved=true;const v=(input.value||'').trim();if(save){if(!v){toast('Назови проект');input.focus();saved=false;return}const project={id:uid(),title:v,emoji:null};projects.unshift(project);ProjectsStore.write(projects);if(isServerMode())queueProjectCreate(project)}renderProjects()};input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();finish(true)}else if(e.key==='Escape'){e.preventDefault();finish(false)}});input.addEventListener('blur',()=>{if(!saved)finish(true)})})}

document.addEventListener('keydown',e=>{
  if(e.target&&(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'||e.target.isContentEditable))return;
  if(e.key==='Tab'&&selectedTaskId){e.preventDefault();addSubtask(selectedTaskId);return}
  if((e.key==='Backspace'||e.key==='Delete')&&selectedTaskId){e.preventDefault();handleDelete(selectedTaskId,{visibleOrder:getVisibleTaskIds()})}
});

if(!tasks.length&&!isServerMode()){const rootId=uid();const childId=uid();tasks=[{id:rootId,title:'Добавь несколько задач',done:false,collapsed:false,due:null,project:null,notes:'',timeSpent:0,timerActive:false,timerStart:null,parentId:null,children:[{id:childId,title:'Пример подзадачи',done:false,collapsed:false,due:null,project:null,notes:'',timeSpent:0,timerActive:false,timerStart:null,parentId:rootId,children:[]} ]},{id:uid(),title:'ПКМ по строке → «Редактировать»',done:false,collapsed:false,due:null,project:null,notes:'',timeSpent:0,timerActive:false,timerStart:null,parentId:null,children:[]},{id:uid(),title:'Отметь как выполненную — увидишь зачёркивание',done:true,collapsed:false,due:null,project:null,notes:'',timeSpent:0,timerActive:false,timerStart:null,parentId:null,children:[] }];ensureTaskParentIds(tasks,null);Store.write(tasks)}
if(!projects.length&&!isServerMode()){projects=[{id:uid(),title:'Личный',emoji:DEFAULT_PROJECT_EMOJI},{id:uid(),title:'Работа',emoji:'💼'}];ProjectsStore.write(projects)}

renderProjects();

function getProjectTitle(id){if(!id)return'Без проекта';const p=projects.find(x=>x.id===id);return p?p.title:'Проект'}
function getProjectEmoji(id){const p=projects.find(x=>x.id===id);if(!p)return DEFAULT_PROJECT_EMOJI;if(typeof p.emoji==='string'){const trimmed=p.emoji.trim();if(trimmed)return trimmed}return DEFAULT_PROJECT_EMOJI}
function getProjectMeta(id){return{emoji:getProjectEmoji(id),title:getProjectTitle(id)}}
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
function assignProject(taskId,projId){const t=findTask(taskId);if(!t)return;t.project=projId;Store.write(tasks);if(isServerMode())queueTaskUpdate(taskId,{project:projId});render();toast('Назначено в проект: '+getProjectTitle(projId))}
function clearProject(taskId){const t=findTask(taskId);if(!t)return;t.project=null;Store.write(tasks);if(isServerMode())queueTaskUpdate(taskId,{project:null});render()}
function openAssignSubmenu(taskId,anchorItem){
  closeDuePicker();
  if(!anchorItem)return;
  const sub=Ctx.sub;
  if(!sub)return;
  sub.innerHTML='';
  if(!projects.length){
    const it=document.createElement('div');
    it.className='ctx-submenu-item';
    it.textContent='Нет проектов';
    sub.appendChild(it);
  }else{
    for(const p of projects){
      const it=document.createElement('div');
      it.className='ctx-submenu-item';
      it.textContent=`${getProjectEmoji(p.id)} ${p.title}`;
      it.onclick=e=>{e.stopPropagation();assignProject(taskId,p.id);closeContextMenu()};
      sub.appendChild(it);
    }
  }
  const t=findTask(taskId);
  if(t&&t.project){
    const sep=document.createElement('div');
    sep.style.height='6px';
    sub.appendChild(sep);
    const clr=document.createElement('div');
    clr.className='ctx-submenu-item';
    clr.textContent='Снять проект';
    clr.onclick=e=>{e.stopPropagation();clearProject(taskId);closeContextMenu()};
    sub.appendChild(clr);
  }
  if(Ctx.submenuAnchor&&Ctx.submenuAnchor!==anchorItem){
    Ctx.submenuAnchor.classList.remove('is-submenu-open');
  }
  Ctx.submenuAnchor=anchorItem;
  anchorItem.classList.add('is-submenu-open');
  const r=anchorItem.getBoundingClientRect();
  sub.style.display='block';
  const sw=sub.offsetWidth||0;
  const sh=sub.offsetHeight||0;
  let left=r.right+6;
  let top=r.top;
  if(left+sw>window.innerWidth-8)left=Math.max(8,window.innerWidth-sw-8);
  if(top+sh>window.innerHeight-8)top=Math.max(8,window.innerHeight-sh-8);
  sub.style.left=left+'px';
  sub.style.top=top+'px';
  sub.setAttribute('aria-hidden','false');
}
function closeAssignSubmenu(){
  if(Ctx.submenuAnchor){
    Ctx.submenuAnchor.classList.remove('is-submenu-open');
    Ctx.submenuAnchor=null;
  }
  if(!Ctx.sub)return;
  Ctx.sub.style.display='none';
  Ctx.sub.setAttribute('aria-hidden','true');
}
function maybeCloseSubmenu(){setTimeout(()=>{const anchor=Ctx.submenuAnchor;if(anchor&&anchor.matches(':hover'))return;if(Ctx.sub&&Ctx.sub.matches(':hover'))return;closeAssignSubmenu()},120)}

try{console.assert(monthTitle(2025,0)==='Январь 2025');const weeks=buildMonthMatrix(2025,0,{minVisibleDays:2,maxWeeks:5});console.assert(weeks.length>=4&&weeks.length<=5);console.assert(rowClass({collapsed:false,done:false,id:'x'})==='task');const sprintSample=buildSprintData([{id:'a',title:'t',due:new Date().toISOString(),children:[]}]);console.assert(Array.isArray(sprintSample));}catch(e){console.warn('Self-tests failed:',e)}

function isDueToday(iso){if(!iso)return false;const d=new Date(iso);if(isNaN(d))return false;const now=new Date();return d.getFullYear()===now.getFullYear()&&d.getMonth()===now.getMonth()&&d.getDate()===now.getDate()}
function filterTree(list,pred){const out=[];for(const t of list){const kids=t.children||[];const fk=filterTree(kids,pred);if(pred(t)||fk.length){out.push({...t,children:fk})}}return out}
function isoWeekInfo(d){const date=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));const dayNum=(date.getUTCDay()+6)%7;date.setUTCDate(date.getUTCDate()-dayNum+3);const weekYear=date.getUTCFullYear();const firstThursday=new Date(Date.UTC(weekYear,0,4));const diff=date-firstThursday;const week=1+Math.round(diff/(7*24*3600*1000));return{week,year:weekYear}}
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

(function setupSidebarResize(){
  const SIDEBAR_BREAKPOINT=860;
  const SIDEBAR_MAX_RATIO=0.3;
  const root=document.documentElement;
  const body=document.body;
  const sidebar=document.querySelector('.sidebar');
  const resizer=document.getElementById('sidebarResizer');
  if(!sidebar||!resizer)return;
  let resizing=false;
  let startX=0;
  let startWidth=0;
  let activePointerId=null;

  function isDesktop(){
    return window.innerWidth>SIDEBAR_BREAKPOINT;
  }

  function getMinWidth(){
    const fromVar=parseFloat(getComputedStyle(root).getPropertyValue('--sidebar-min-width'));
    return Number.isFinite(fromVar)&&fromVar>0?fromVar:220;
  }

  function getMaxWidth(){
    const min=getMinWidth();
    const maxFromViewport=Math.max(min,Math.floor(window.innerWidth*SIDEBAR_MAX_RATIO));
    return maxFromViewport;
  }

  function clampWidth(width){
    const min=getMinWidth();
    const max=getMaxWidth();
    return Math.min(Math.max(width,min),max);
  }

  function applyWidth(width){
    const next=clampWidth(width);
    root.style.setProperty('--sidebar-width',`${next}px`);
    sidebar.style.width=`${next}px`;
  }

  function stopResize(pointerId){
    if(!resizing)return;
    resizing=false;
    const id=pointerId!=null?pointerId:activePointerId;
    if(id!=null){
      try{resizer.releasePointerCapture(id)}catch{}
    }
    activePointerId=null;
    body.classList.remove('sidebar-resizing');
  }

  function handlePointerDown(event){
    if(!isDesktop())return;
    event.preventDefault();
    resizing=true;
    startX=event.clientX;
    startWidth=sidebar.getBoundingClientRect().width;
    activePointerId=event.pointerId;
    try{resizer.setPointerCapture(event.pointerId)}catch{}
    body.classList.add('sidebar-resizing');
  }

  function handlePointerMove(event){
    if(!resizing)return;
    const delta=event.clientX-startX;
    applyWidth(startWidth+delta);
  }

  function handlePointerUp(event){
    stopResize(event.pointerId);
  }

  function syncMode(){
    if(isDesktop()){
      body.classList.add('desktop');
      applyWidth(sidebar.getBoundingClientRect().width||getMinWidth());
    }else{
      body.classList.remove('desktop');
      stopResize();
      root.style.removeProperty('--sidebar-width');
      sidebar.style.removeProperty('width');
    }
  }

  resizer.addEventListener('pointerdown',handlePointerDown);
  resizer.addEventListener('pointermove',handlePointerMove);
  resizer.addEventListener('pointerup',handlePointerUp);
  resizer.addEventListener('pointercancel',handlePointerUp);

  window.addEventListener('pointermove',handlePointerMove);
  window.addEventListener('pointerup',handlePointerUp);
  window.addEventListener('pointercancel',handlePointerUp);
  window.addEventListener('resize',()=>{
    syncMode();
  });

  syncMode();
})();

(function(){applyTheme(ThemeStore.read());initCalendar();updateStorageToggle();refreshDataForCurrentMode()})();
