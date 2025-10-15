const Store={key:'mini-task-tracker:text:min:v14',read(){try{return JSON.parse(localStorage.getItem(this.key))||[]}catch{return[]}},write(d){localStorage.setItem(this.key,JSON.stringify(d))}};
const ThemeStore={key:'mini-task-tracker:theme',read(){return localStorage.getItem(this.key)||'light'},write(v){localStorage.setItem(this.key,v)}};
const ProjectsStore={key:'mini-task-tracker:projects',read(){try{return JSON.parse(localStorage.getItem(this.key))||[]}catch{return[]}},write(d){localStorage.setItem(this.key,JSON.stringify(d))}};

let tasks=Store.read();
let selectedTaskId=null;
let pendingEditId=null;
let currentView='all';
let currentProjectId=null;
let activeEditId=null;
let activeInputEl=null;
let projects=ProjectsStore.read();
if(!Array.isArray(projects))projects=[];
const DEFAULT_PROJECT_EMOJI='📁';
let projectsPatched=false;
const SPRINT_UNASSIGNED_KEY='__none__';
let sprintVisibleProjects=new Map();
for(const proj of projects){
  if(!proj||typeof proj!=='object')continue;
  if(!('emoji' in proj)||proj.emoji===undefined){proj.emoji=null;projectsPatched=true;continue}
  if(proj.emoji!==null&&typeof proj.emoji!=='string'){proj.emoji=null;projectsPatched=true;continue}
  if(typeof proj.emoji==='string'){
    const trimmed=proj.emoji.trim();
    if(!trimmed){proj.emoji=null;projectsPatched=true}
    else if(trimmed!==proj.emoji){proj.emoji=trimmed;projectsPatched=true}
  }
}
if(projectsPatched){ProjectsStore.write(projects)}

const $=s=>document.querySelector(s),$$=s=>Array.from(document.querySelectorAll(s));
const uid=()=>Math.random().toString(36).slice(2,10)+Date.now().toString(36).slice(-4);
const MAX_TASK_DEPTH=2;
const MONTH_NAMES=['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>t.classList.remove('show'),1400)}
function migrate(list,depth=0){const extras=[];for(const t of list){if(!Array.isArray(t.children)) t.children=[];if(typeof t.collapsed!=='boolean') t.collapsed=false;if(typeof t.done!=='boolean') t.done=false;if(!('due' in t)) t.due=null;if(!('project' in t)) t.project=null;if(typeof t.notes!=='string') t.notes='';if(t.children.length){migrate(t.children,depth+1);if(depth>=MAX_TASK_DEPTH){extras.push(...t.children);t.children=[]}}}if(extras.length) list.push(...extras);return list}
tasks=migrate(tasks);

function findTask(id,list=tasks){for(const t of list){if(t.id===id) return t;const r=findTask(id,t.children||[]);if(r) return r}return null}
function getTaskDepth(id,list=tasks,depth=0){for(const t of list){if(t.id===id) return depth;const childDepth=getTaskDepth(id,t.children||[],depth+1);if(childDepth!==-1) return childDepth}return-1}
function getSubtreeDepth(task){if(!task||!Array.isArray(task.children)||!task.children.length)return 0;let max=0;for(const child of task.children){const childDepth=1+getSubtreeDepth(child);if(childDepth>max)max=childDepth}return max}
function containsTask(root,targetId){if(!root||!targetId)return false;if(root.id===targetId)return true;if(!Array.isArray(root.children))return false;for(const child of root.children){if(containsTask(child,targetId))return true}return false}
function detachTaskFromTree(id,list=tasks){if(!Array.isArray(list))return null;for(let i=0;i<list.length;i++){const item=list[i];if(item.id===id){return list.splice(i,1)[0]}const pulled=detachTaskFromTree(id,item.children||[]);if(pulled){if(item.children&&item.children.length===0)item.collapsed=false;return pulled}}return null}
let draggingTaskId=null;
let dropTargetId=null;
let sprintDraggingId=null;
let sprintDropColumn=null;
function setSprintDropColumn(col){if(sprintDropColumn===col)return;if(sprintDropColumn){sprintDropColumn.classList.remove('is-drop-target')}sprintDropColumn=col||null;if(sprintDropColumn){sprintDropColumn.classList.add('is-drop-target')}}
function clearSprintDragState(){const prev=document.querySelector('.sprint-task.is-dragging');if(prev)prev.classList.remove('is-dragging');setSprintDropColumn(null);sprintDraggingId=null}
function applySprintDrop(targetDate){if(!sprintDraggingId)return;const task=findTask(sprintDraggingId);if(!task)return;const d=new Date(targetDate);if(isNaN(d))return;d.setHours(0,0,0,0);const iso=d.toISOString();if(task.due!==iso){task.due=iso;Store.write(tasks)}clearSprintDragState();render()}
function setDropTarget(id){if(dropTargetId===id||dropTargetId===null&&id===null)return;if(dropTargetId){const prev=document.querySelector(`.task[data-id="${dropTargetId}"]`);prev&&prev.classList.remove('is-drop-target')}dropTargetId=id||null;if(dropTargetId){const el=document.querySelector(`.task[data-id="${dropTargetId}"]`);el&&el.classList.add('is-drop-target')}}
function clearDragIndicators(){if(draggingTaskId){const dragEl=document.querySelector(`.task[data-id="${draggingTaskId}"]`);dragEl&&dragEl.classList.remove('is-dragging')}setDropTarget(null);draggingTaskId=null}
function rowClass(t){return'task'+(t.collapsed?' is-collapsed':'')+(selectedTaskId===t.id?' is-selected':'')+(t.done?' done':'')}
function getVisibleTaskIds(){return $$('#tasks .task[data-id]').map(el=>el.dataset.id)}
function addTask(title){
  title=String(title||'').trim();
  if(!title) return;
  let assignedProject=null;
  if(currentView==='project'&&currentProjectId){
    const exists=projects.some(p=>p&&p.id===currentProjectId);
    if(exists)assignedProject=currentProjectId;
  }
  tasks.unshift({id:uid(),title,done:false,children:[],collapsed:false,due:null,project:assignedProject,notes:''});
  Store.write(tasks);
  render()
}
function addSubtask(parentId){const p=findTask(parentId);if(!p) return;const depth=getTaskDepth(parentId);if(depth===-1||depth>=MAX_TASK_DEPTH){toast('Максимальная вложенность — три уровня');return}const inheritedProject=typeof p.project==='undefined'?null:p.project;const child={id:uid(),title:'',done:false,children:[],collapsed:false,due:null,project:inheritedProject,notes:''};p.children.push(child);p.collapsed=false;Store.write(tasks);pendingEditId=child.id;render()}
function toggleTask(id){const t=findTask(id);if(!t) return;t.done=!t.done;Store.write(tasks);render();toast(t.done?'Отмечено как выполнено':'Снята отметка выполнения')}
function markTaskDone(id){const t=findTask(id);if(!t)return;if(t.done){toast('Задача уже выполнена');return}t.done=true;Store.write(tasks);render();toast('Отмечено как выполнено')}
function deleteTask(id,list=tasks){for(let i=0;i<list.length;i++){if(list[i].id===id){list.splice(i,1);return true}if(deleteTask(id,list[i].children)) return true}return false}
function handleDelete(id,{visibleOrder=null}={}){
  if(!Array.isArray(visibleOrder))visibleOrder=getVisibleTaskIds();
  const removed=deleteTask(id,tasks);
  if(!removed)return;
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
  render()
}
function renameTask(id,title){const t=findTask(id);if(!t) return;const v=String(title||'').trim();if(v&&v!==t.title){t.title=v;if(NotesPanel.taskId===id&&NotesPanel.title)NotesPanel.title.textContent=t.title;Store.write(tasks)}render()}
function toggleCollapse(id){const t=findTask(id);if(!t) return;t.collapsed=!t.collapsed;Store.write(tasks);render()}

const Ctx={el:$('#ctxMenu'),taskId:null,sub:document.getElementById('ctxSub')};
const NotesPanel={panel:document.getElementById('notesSidebar'),overlay:document.getElementById('notesOverlay'),close:document.getElementById('notesClose'),title:document.getElementById('notesTaskTitle'),input:document.getElementById('notesInput'),taskId:null};

function updateNoteIndicator(taskId){const btn=document.querySelector(`.task[data-id="${taskId}"] .note-btn`);if(btn){const t=findTask(taskId);btn.dataset.hasNotes=t&&t.notes&&t.notes.trim()? 'true':'false'}}

function openNotesPanel(taskId){const t=findTask(taskId);if(!t||!NotesPanel.panel||!NotesPanel.overlay||!NotesPanel.input)return;closeContextMenu();NotesPanel.taskId=taskId;NotesPanel.title&&(NotesPanel.title.textContent=t.title||'');NotesPanel.input.value=t.notes||'';NotesPanel.overlay.classList.add('is-visible');NotesPanel.overlay.setAttribute('aria-hidden','false');NotesPanel.panel.classList.add('is-open');NotesPanel.panel.setAttribute('aria-hidden','false');document.body.classList.add('notes-open');setTimeout(()=>{try{NotesPanel.input.focus({preventScroll:true})}catch{NotesPanel.input.focus()}},60);updateNoteIndicator(taskId)}

function closeNotesPanel(){if(!NotesPanel.panel||!NotesPanel.overlay)return;NotesPanel.taskId=null;NotesPanel.overlay.classList.remove('is-visible');NotesPanel.overlay.setAttribute('aria-hidden','true');NotesPanel.panel.classList.remove('is-open');NotesPanel.panel.setAttribute('aria-hidden','true');document.body.classList.remove('notes-open');NotesPanel.title&&(NotesPanel.title.textContent='');NotesPanel.input&&(NotesPanel.input.value='')}
function openContextMenu(taskId,x,y){
  Ctx.taskId=taskId;const menu=Ctx.el;menu.innerHTML='';closeAssignSubmenu();closeDuePicker();
  const btnEdit=document.createElement('div');btnEdit.className='context-item';btnEdit.textContent='Редактировать';
  btnEdit.onclick=()=>{closeContextMenu();const row=document.querySelector(`.task[data-id="${taskId}"]`);const t=findTask(taskId);if(!t)return;if(row)startEdit(row,t);else{const next=prompt('Название задачи',t.title||'');if(next!==null)renameTask(taskId,next)}};
  const btnComplete=document.createElement('div');btnComplete.className='context-item';btnComplete.textContent='Отметить выполненной';
  btnComplete.onclick=()=>{closeContextMenu();markTaskDone(taskId)};
  const btnAssign=document.createElement('div');btnAssign.className='context-item';btnAssign.textContent='Проект ▸';
  btnAssign.addEventListener('mouseenter',()=>{openAssignSubmenu(taskId,menu);closeDuePicker()});
  btnAssign.addEventListener('mouseleave',()=>maybeCloseSubmenu());
  const btnDue=document.createElement('div');btnDue.className='context-item';btnDue.textContent='Дата ▸';btnDue.dataset.menuAnchor='true';
  btnDue.addEventListener('mouseenter',()=>{closeAssignSubmenu();openDuePicker(taskId,btnDue,{fromContext:true})});
  btnDue.addEventListener('mouseleave',()=>{setTimeout(()=>{if(Due.el.dataset.fromContext==='true'){const anchor=Due.anchor;if(anchor&&anchor.matches(':hover'))return;if(Due.el.matches(':hover'))return;closeDuePicker()}},80)});
  menu.append(btnEdit,btnComplete,btnAssign,btnDue);
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
window.addEventListener('keydown',e=>{if(e.key==='Escape'){closeContextMenu();closeNotesPanel();closeDuePicker()}});
window.addEventListener('resize',closeContextMenu);
window.addEventListener('scroll',closeContextMenu,true);

NotesPanel.overlay&&NotesPanel.overlay.addEventListener('click',()=>closeNotesPanel());
NotesPanel.close&&NotesPanel.close.addEventListener('click',()=>closeNotesPanel());
NotesPanel.input&&NotesPanel.input.addEventListener('input',()=>{if(!NotesPanel.taskId)return;const task=findTask(NotesPanel.taskId);if(!task)return;task.notes=NotesPanel.input.value;Store.write(tasks);updateNoteIndicator(task.id)});

function render(){
  $$('.nav-btn').forEach(b=>b.classList.toggle('is-active',b.dataset.view===currentView));
  if(currentView!=='sprint'){
    if(sprintVisibleProjects.size)sprintVisibleProjects.clear();
    clearSprintFiltersUI();
  }
  const composer=$('.composer');
  if(composer){
    const hide=currentView==='sprint';
    if(composer.hidden!==hide)composer.hidden=hide;
    composer.setAttribute('aria-hidden',hide?'true':'false');
    document.body.classList.toggle('view-sprint',hide);
  }
  const wrap=$('#tasks');wrap.innerHTML='';
  if(currentView==='sprint'){document.getElementById('viewTitle').textContent='Спринт';renderSprint(wrap);return}
  if(currentView==='project'){const proj=projects.find(p=>p.id===currentProjectId);document.getElementById('viewTitle').textContent=proj?proj.title:'Проект';const dataList=filterTree(tasks,t=>t.project===currentProjectId);if(!dataList.length){const empty=document.createElement('div');empty.className='task';empty.innerHTML='<div></div><div class="task-title">Нет задач этого проекта.</div><div></div>';wrap.appendChild(empty);return}for(const t of dataList){renderTaskRow(t,0,wrap)}if(pendingEditId){const rowEl=document.querySelector(`[data-id="${pendingEditId}"]`);const taskObj=findTask(pendingEditId);if(rowEl&&taskObj)startEdit(rowEl,taskObj);pendingEditId=null}return}
  document.getElementById('viewTitle').textContent=currentView==='today'?'Сегодня':'Все задачи';
  const dataList=currentView==='today'?filterTree(tasks,t=>isDueToday(t.due)):tasks;
  if(!dataList.length){const empty=document.createElement('div');empty.className='task';empty.innerHTML='<div></div><div class="task-title">Здесь пусто.</div><div></div>';wrap.appendChild(empty);return}
  for(const t of dataList){renderTaskRow(t,0,wrap)}
  if(pendingEditId){const rowEl=document.querySelector(`[data-id="${pendingEditId}"]`);const taskObj=findTask(pendingEditId);if(rowEl&&taskObj)startEdit(rowEl,taskObj);pendingEditId=null}
}

function renderTaskRow(t,depth,container){
  const canAcceptChildren=depth<MAX_TASK_DEPTH;
  const childList=Array.isArray(t.children)?t.children:[];
  const hasChildren=canAcceptChildren&&childList.length>0;
  const row=document.createElement('div');row.className=rowClass(t);row.dataset.id=t.id;row.dataset.depth=depth;
  row.setAttribute('draggable','true');
  row.addEventListener('dragstart',e=>{draggingTaskId=t.id;row.classList.add('is-dragging');try{e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',t.id)}catch{}closeContextMenu()});
  row.addEventListener('dragend',()=>{clearDragIndicators()});
  row.addEventListener('dragenter',e=>{if(!draggingTaskId||draggingTaskId===t.id)return;if(!canAcceptChildren){setDropTarget(null);return}const dragged=findTask(draggingTaskId);if(!dragged)return;if(containsTask(dragged,t.id)){setDropTarget(null);return}const subtreeDepth=getSubtreeDepth(dragged);if(depth+1+subtreeDepth>MAX_TASK_DEPTH){setDropTarget(null);return}e.preventDefault();setDropTarget(t.id)});
  row.addEventListener('dragover',e=>{if(!draggingTaskId||draggingTaskId===t.id)return;const dragged=findTask(draggingTaskId);if(!dragged)return;if(!canAcceptChildren){if(e.dataTransfer)e.dataTransfer.dropEffect='none';return}if(containsTask(dragged,t.id))return;const subtreeDepth=getSubtreeDepth(dragged);if(depth+1+subtreeDepth>MAX_TASK_DEPTH){if(e.dataTransfer)e.dataTransfer.dropEffect='none';return}e.preventDefault();if(e.dataTransfer)e.dataTransfer.dropEffect='move'});
  row.addEventListener('dragleave',e=>{if(dropTargetId!==t.id)return;const rel=e.relatedTarget;if(rel&&row.contains(rel))return;setDropTarget(null)});
  row.addEventListener('drop',e=>{if(!draggingTaskId)return;e.preventDefault();const sourceId=draggingTaskId;clearDragIndicators();if(sourceId===t.id)return;const draggedTask=findTask(sourceId);const targetTask=findTask(t.id);if(!draggedTask||!targetTask)return;if(!canAcceptChildren){toast('Максимальная вложенность — три уровня');return}if(containsTask(draggedTask,t.id))return;const subtreeDepth=getSubtreeDepth(draggedTask);if(depth+1+subtreeDepth>MAX_TASK_DEPTH){toast('Максимальная вложенность — три уровня');return}const moved=detachTaskFromTree(sourceId);if(!moved)return;if(!Array.isArray(targetTask.children))targetTask.children=[];const inheritedProject=typeof targetTask.project==='undefined'?null:targetTask.project;targetTask.children.push(moved);moved.project=inheritedProject;targetTask.collapsed=false;Store.write(tasks);selectedTaskId=moved.id;render()});
  row.addEventListener('contextmenu',e=>{e.preventDefault();openContextMenu(t.id,e.clientX,e.clientY)});
  const toggle=document.createElement('div');toggle.className='toggle';toggle.style.visibility=hasChildren?'visible':'hidden';toggle.onclick=e=>{e.stopPropagation();toggleCollapse(t.id)};
  const cb=document.createElement('div');cb.className='checkbox';cb.dataset.checked=t.done;cb.title=t.done?'Снять отметку выполнения':'Отметить как выполненную';cb.onclick=e=>{e.stopPropagation();toggleTask(t.id)};
  const title=document.createElement('div');title.className='task-title';
  const titleText=document.createElement('span');titleText.className='task-title-text';titleText.textContent=t.title;
  title.appendChild(titleText);
  const noteBtn=document.createElement('button');noteBtn.className='note-btn';noteBtn.type='button';noteBtn.setAttribute('aria-label','Заметки задачи');noteBtn.title='Открыть заметки';noteBtn.textContent='📝';noteBtn.onclick=e=>{e.stopPropagation();openNotesPanel(t.id)};noteBtn.dataset.hasNotes=t.notes&&t.notes.trim()? 'true':'false';
  const dueBtn=document.createElement('button');dueBtn.className='due-btn';dueBtn.title='Установить дедлайн';dueBtn.textContent='📅';dueBtn.onclick=e=>{e.stopPropagation();openDuePicker(t.id,dueBtn)};
  const del=document.createElement('button');del.className='delete-btn';del.type='button';del.setAttribute('aria-label','Удалить задачу');del.title='Удалить задачу';del.textContent='×';del.onclick=e=>{e.stopPropagation();handleDelete(t.id)};
  if(t.due){const tag=document.createElement('span');tag.className='due-tag';if(isDueToday(t.due))tag.classList.add('is-today');tag.textContent=formatDue(t.due);title.appendChild(tag)}
  if(t.project){const ptag=document.createElement('span');ptag.className='proj-tag';ptag.textContent=getProjectEmoji(t.project);title.appendChild(ptag)}
  title.append(noteBtn,dueBtn);
  row.append(toggle,cb,title,del);
  row.addEventListener('click',()=>{
    if(activeEditId&&activeEditId!==t.id){const v=(activeInputEl?.value||'').trim();if(!v){toast('Напиши, что нужно сделать');activeInputEl&&activeInputEl.focus();return}const id=activeEditId;activeEditId=null;activeInputEl=null;selectedTaskId=t.id;renameTask(id,v);return}
    selectedTaskId=t.id;render()
  });
  container.appendChild(row);
  if(hasChildren){row.classList.add('has-children');const subWrap=document.createElement('div');subWrap.className='subtasks';const inner=document.createElement('div');inner.className='subtasks-inner';for(const c of childList){renderTaskRow(c,depth+1,inner)}subWrap.appendChild(inner);container.appendChild(subWrap);requestAnimationFrame(()=>{subWrap.style.maxHeight=t.collapsed?0:inner.scrollHeight+'px'})}
}

function startEdit(row,t){
  const titleEl=row.querySelector('.task-title');
  const input=document.createElement('input');
  input.className='input';
  input.value=t.title||'';
  input.placeholder='Название задачи…';
  input.addEventListener('mousedown',e=>e.stopPropagation());
  input.addEventListener('click',e=>e.stopPropagation());
  titleEl.replaceWith(input);
  input.focus();
  activeEditId=t.id;activeInputEl=input;
  const trySave=()=>{if(!activeInputEl)return false;const v=(activeInputEl.value||'').trim();if(!v){toast('Напиши, что нужно сделать');activeInputEl.focus();return false}const id=activeEditId;activeEditId=null;activeInputEl=null;renameTask(id,v);return true};
  input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();trySave()}});
  input.addEventListener('blur',()=>{setTimeout(()=>input.focus(),0)})
}

function applyTheme(mode){const dark=mode==='dark';document.body.classList.toggle('theme-dark',dark);const btn=$('#themeToggle');if(btn){const label=dark?'Переключить на светлую тему':'Переключить на тёмную тему';btn.dataset.mode=dark?'dark':'light';btn.setAttribute('aria-pressed',String(dark));btn.setAttribute('aria-label',label);btn.title=label}}
const themeToggle=$('#themeToggle');
function toggleTheme(){const dark=!document.body.classList.contains('theme-dark');applyTheme(dark?'dark':'light');ThemeStore.write(dark?'dark':'light')}
if(themeToggle){themeToggle.addEventListener('click',toggleTheme)}

const cal={track:null,curr:null,nextbuf:null,title:null,legend:null,toggle:null,prev:null,next:null,today:null,month:null,year:null,collapsed:false,focusDate:null,monthWeeks:[],activeWeekIndex:0};
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

$('#addBtn').onclick=()=>{addTask($('#taskInput').value);$('#taskInput').value=''};
$('#taskInput').onkeydown=e=>{if(e.key==='Enter'){addTask(e.target.value);e.target.value=''}};
$$('.nav-btn').forEach(btn=>btn.onclick=()=>{const view=btn.dataset.view;if(view==='today'){currentView='today';render();return}if(view==='sprint'){currentView='sprint';render();return}if(view==='eisenhower'){toast('Эта кнопка — заглушка');return}currentView='all';render()});

const projToggle=$('#projToggle');
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
  projList.innerHTML='';
  if(!projects.length){const hint=document.createElement('div');hint.className='proj-item';hint.style.color='var(--muted)';hint.textContent='Проектов пока нет';projList.appendChild(hint);return}
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
let projectsOpen=false;
function setProjectsOpen(open){projectsOpen=!!open;if(projectsOpen){projList.style.display='flex';projList.removeAttribute('hidden');projToggle.setAttribute('aria-expanded','true');projToggle.querySelector('.chev').textContent='▾';renderProjects()}else{projList.style.display='none';projList.setAttribute('hidden','');projToggle.setAttribute('aria-expanded','false');projToggle.querySelector('.chev').textContent='▸';closeProjMenu();closeEmojiPicker()}}
projToggle.addEventListener('click',()=>setProjectsOpen(!projectsOpen));

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

function startProjectRename(id,row){closeEmojiPicker();const p=projects.find(pr=>pr.id===id);if(!p)return;const target=row?.querySelector('.name')||[...projList.children].find(n=>n.dataset.id===id)?.querySelector('.name');if(!target)return;const input=document.createElement('input');input.className='proj-input';input.value=p.title;target.replaceWith(input);input.focus();input.select();let finished=false;const save=()=>{if(finished)return;finished=true;const v=(input.value||'').trim();if(!v){toast('Назови проект');input.focus();finished=false;return}p.title=v;ProjectsStore.write(projects);renderProjects()};const cancel=()=>{if(finished)return;finished=true;renderProjects()};input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();save()}else if(e.key==='Escape'){e.preventDefault();cancel()}});input.addEventListener('blur',()=>{if(!finished)save()})}
function deleteProject(id){closeEmojiPicker();const idx=projects.findIndex(p=>p.id===id);if(idx===-1)return;projects.splice(idx,1);ProjectsStore.write(projects);renderProjects();toast('Проект удалён')}
projAdd.addEventListener('click',()=>{setProjectsOpen(true);closeEmojiPicker();const row=document.createElement('div');row.className='proj-item';const input=document.createElement('input');input.className='proj-input';input.placeholder='Название проекта…';row.appendChild(input);projList.prepend(row);input.focus();let saved=false;const finish=save=>{if(saved)return;saved=true;const v=(input.value||'').trim();if(save){if(!v){toast('Назови проект');input.focus();saved=false;return}projects.unshift({id:uid(),title:v,emoji:null});ProjectsStore.write(projects)}renderProjects()};input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();finish(true)}else if(e.key==='Escape'){e.preventDefault();finish(false)}});input.addEventListener('blur',()=>{if(!saved)finish(true)})});

document.addEventListener('keydown',e=>{
  if(e.target&&(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'||e.target.isContentEditable))return;
  if(e.key==='Tab'&&selectedTaskId){e.preventDefault();addSubtask(selectedTaskId);return}
  if((e.key==='Backspace'||e.key==='Delete')&&selectedTaskId){e.preventDefault();handleDelete(selectedTaskId,{visibleOrder:getVisibleTaskIds()})}
});

if(!tasks.length){tasks=[{id:uid(),title:'Добавь несколько задач',done:false,collapsed:false,due:null,project:null,notes:'',children:[{id:uid(),title:'Пример подзадачи',done:false,collapsed:false,due:null,project:null,notes:'',children:[]} ]},{id:uid(),title:'ПКМ по строке → «Редактировать»',done:false,collapsed:false,due:null,project:null,notes:'',children:[]},{id:uid(),title:'Отметь как выполненную — увидишь зачёркивание',done:true,collapsed:false,due:null,project:null,notes:'',children:[] }];Store.write(tasks)}
if(!projects.length){projects=[{id:uid(),title:'Личный',emoji:DEFAULT_PROJECT_EMOJI},{id:uid(),title:'Работа',emoji:'💼'}];ProjectsStore.write(projects)}

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
function assignProject(taskId,projId){const t=findTask(taskId);if(!t)return;t.project=projId;Store.write(tasks);render();toast('Назначено в проект: '+getProjectTitle(projId))}
function clearProject(taskId){const t=findTask(taskId);if(!t)return;t.project=null;Store.write(tasks);render()}
function openAssignSubmenu(taskId,anchorMenu){
  closeDuePicker();
  const sub=Ctx.sub;
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
  const r=anchorMenu.getBoundingClientRect();
  sub.style.display='block';
  sub.style.left=(r.right+6)+'px';
  sub.style.top=r.top+'px';
  sub.setAttribute('aria-hidden','false');
}
function closeAssignSubmenu(){Ctx.sub.style.display='none';Ctx.sub.setAttribute('aria-hidden','true')}
function maybeCloseSubmenu(){setTimeout(()=>{if(!Ctx.sub.matches(':hover'))closeAssignSubmenu()},120)}

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
function buildDuePicker(y,m){const cont=document.createElement('div');cont.style.padding='6px';const header=document.createElement('div');header.className='cal-header';const todayBtn=document.createElement('button');todayBtn.className='cal-today';todayBtn.title='К текущему месяцу';const title=document.createElement('div');title.className='cal-title';title.textContent=monthTitle(y,m);const ctrls=document.createElement('div');ctrls.className='cal-ctrls';const prev=document.createElement('button');prev.className='cal-arrow';prev.textContent='‹';const next=document.createElement('button');next.className='cal-arrow';next.textContent='›';header.append(todayBtn,title,ctrls);ctrls.append(prev,next);const legend=document.createElement('div');legend.className='cal-legend';legend.innerHTML='<div>Wk</div><div>Пн</div><div>Вт</div><div>Ср</div><div>Чт</div><div>Пт</div><div>Сб</div><div>Вс</div>';const viewport=document.createElement('div');viewport.className='cal-viewport';const monthEl=document.createElement('div');monthEl.className='cal-month';const track=document.createElement('div');track.className='cal-track';track.appendChild(monthEl);viewport.appendChild(track);cont.append(header,legend,viewport);function renderLocal(){renderMonthInto(monthEl,Due.y,Due.m);title.textContent=monthTitle(Due.y,Due.m)}prev.onclick=()=>{let ny=Due.y,nm=Due.m-1;if(nm<0){nm=11;ny--}Due.y=ny;Due.m=nm;renderLocal()};next.onclick=()=>{let ny=Due.y,nm=Due.m+1;if(nm>11){nm=0;ny++}Due.y=ny;Due.m=nm;renderLocal()};todayBtn.onclick=()=>{const now=new Date();Due.y=now.getFullYear();Due.m=now.getMonth();renderLocal()};renderLocal();cont.addEventListener('click',e=>{const dayEl=e.target.closest('.cal-day');if(!dayEl)return;const day=Number(dayEl.textContent);const d=new Date(Due.y,Due.m,day);const t=findTask(Due.taskId);if(!t)return;t.due=d.toISOString();Store.write(tasks);if(Due.el&&Due.el.dataset.fromContext==='true')closeContextMenu();closeDuePicker();render()});return cont}
function openDuePicker(taskId,anchor,options={}){
  Due.taskId=taskId;
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
function closeDuePicker(){Due.taskId=null;Due.anchor=null;if(Due.el){Due.el.style.display='none';Due.el.setAttribute('aria-hidden','true');Due.el.dataset.fromContext='false'}}
window.addEventListener('click',e=>{if(Due.el.style.display==='block'&&!Due.el.contains(e.target)&&!(Due.anchor&&Due.anchor.contains(e.target))&&!e.target.closest('.due-btn'))closeDuePicker()},true);

(function(){applyTheme(ThemeStore.read());render();initCalendar()})();
