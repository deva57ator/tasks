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

const $=s=>document.querySelector(s),$$=s=>Array.from(document.querySelectorAll(s));
const uid=()=>Math.random().toString(36).slice(2,10)+Date.now().toString(36).slice(-4);

function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>t.classList.remove('show'),1400)}
function migrate(list){for(const t of list){if(!Array.isArray(t.children)) t.children=[];if(typeof t.collapsed!=='boolean') t.collapsed=false;if(typeof t.done!=='boolean') t.done=false;if(!('due' in t)) t.due=null;if(!('project' in t)) t.project=null;if(t.children.length) migrate(t.children)}return list}
tasks=migrate(tasks);

function findTask(id,list=tasks){for(const t of list){if(t.id===id) return t;const r=findTask(id,t.children||[]);if(r) return r}return null}
function rowClass(t){return'task'+(t.collapsed?' is-collapsed':'')+(selectedTaskId===t.id?' is-selected':'')+(t.done?' done':'')}
function addTask(title){title=String(title||'').trim();if(!title) return;tasks.unshift({id:uid(),title,done:false,children:[],collapsed:false,due:null,project:null});Store.write(tasks);render()}
function addSubtask(parentId){const p=findTask(parentId);if(!p) return;const child={id:uid(),title:'',done:false,children:[],collapsed:false,due:null,project:null};p.children.push(child);p.collapsed=false;Store.write(tasks);pendingEditId=child.id;render()}
function toggleTask(id){const t=findTask(id);if(!t) return;t.done=!t.done;Store.write(tasks);render();toast(t.done?'Отмечено как выполнено':'Снята отметка выполнения')}
function deleteTask(id,list=tasks){for(let i=0;i<list.length;i++){if(list[i].id===id){list.splice(i,1);return true}if(deleteTask(id,list[i].children)) return true}return false}
function handleDelete(id){deleteTask(id,tasks);if(selectedTaskId===id)selectedTaskId=null;Store.write(tasks);render()}
function renameTask(id,title){const t=findTask(id);if(!t) return;const v=String(title||'').trim();if(v&&v!==t.title){t.title=v;Store.write(tasks)}render()}
function toggleCollapse(id){const t=findTask(id);if(!t) return;t.collapsed=!t.collapsed;Store.write(tasks);render()}

const Ctx={el:$('#ctxMenu'),taskId:null,sub:document.getElementById('ctxSub')};
function openContextMenu(taskId,x,y){
  Ctx.taskId=taskId;const menu=Ctx.el;menu.innerHTML='';
  const btnEdit=document.createElement('div');btnEdit.className='context-item';btnEdit.textContent='Редактировать';
  btnEdit.onclick=()=>{closeContextMenu();const row=document.querySelector(`.task[data-id="${taskId}"]`);const t=findTask(taskId);if(row&&t)startEdit(row,t)};
  const btnAssign=document.createElement('div');btnAssign.className='context-item';btnAssign.textContent='Проект ▸';
  btnAssign.addEventListener('mouseenter',()=>openAssignSubmenu(taskId,menu));
  btnAssign.addEventListener('mouseleave',()=>maybeCloseSubmenu());
  menu.append(btnEdit,btnAssign);
  menu.style.display='block';
  const mw=menu.offsetWidth,mh=menu.offsetHeight;const px=Math.min(x,window.innerWidth-mw-8),py=Math.min(y,window.innerHeight-mh-8);
  menu.style.left=px+'px';menu.style.top=py+'px';
  menu.setAttribute('aria-hidden','false');
}
function closeContextMenu(){Ctx.taskId=null;Ctx.el.style.display='none';Ctx.el.setAttribute('aria-hidden','true');closeAssignSubmenu()}
window.addEventListener('click',e=>{if(!Ctx.el.contains(e.target)&&!Ctx.sub.contains(e.target))closeContextMenu()});
window.addEventListener('keydown',e=>{if(e.key==='Escape')closeContextMenu()});
window.addEventListener('resize',closeContextMenu);
window.addEventListener('scroll',closeContextMenu,true);

function render(){
  $$('.nav-btn').forEach(b=>b.classList.toggle('is-active',b.dataset.view===currentView));
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
  const row=document.createElement('div');row.className=rowClass(t);row.dataset.id=t.id;
  row.addEventListener('contextmenu',e=>{e.preventDefault();openContextMenu(t.id,e.clientX,e.clientY)});
  const toggle=document.createElement('div');toggle.className='toggle';toggle.style.visibility=(t.children&&t.children.length)?'visible':'hidden';toggle.onclick=e=>{e.stopPropagation();toggleCollapse(t.id)};
  const cb=document.createElement('div');cb.className='checkbox';cb.dataset.checked=t.done;cb.title=t.done?'Снять отметку выполнения':'Отметить как выполненную';cb.onclick=e=>{e.stopPropagation();toggleTask(t.id)};
  const title=document.createElement('div');title.className='task-title';title.textContent=t.title;
  const dueBtn=document.createElement('button');dueBtn.className='due-btn';dueBtn.title='Установить дедлайн';dueBtn.textContent='📅';dueBtn.onclick=e=>{e.stopPropagation();openDuePicker(t.id,dueBtn)};
  const del=document.createElement('button');del.className='icon-btn';del.textContent='Удалить';del.onclick=e=>{e.stopPropagation();handleDelete(t.id)};
  row.append(toggle,cb,title,dueBtn,del);
  if(t.due){const tag=document.createElement('span');tag.className='due-tag';tag.textContent=formatDue(t.due);title.appendChild(tag)}
  if(t.project){const ptag=document.createElement('span');ptag.className='proj-tag';ptag.textContent=getProjectTitle(t.project);title.appendChild(ptag)}
  row.addEventListener('click',()=>{
    if(activeEditId&&activeEditId!==t.id){const v=(activeInputEl?.value||'').trim();if(!v){toast('Напиши, что нужно сделать');activeInputEl&&activeInputEl.focus();return}const id=activeEditId;activeEditId=null;activeInputEl=null;selectedTaskId=t.id;renameTask(id,v);return}
    selectedTaskId=t.id;render()
  });
  container.appendChild(row);
  const hasChildren=t.children&&t.children.length;
  if(hasChildren){row.classList.add('has-children');const subWrap=document.createElement('div');subWrap.className='subtasks';const inner=document.createElement('div');inner.className='subtasks-inner';for(const c of t.children){renderTaskRow(c,depth+1,inner)}subWrap.appendChild(inner);container.appendChild(subWrap);requestAnimationFrame(()=>{subWrap.style.maxHeight=t.collapsed?0:inner.scrollHeight+'px'})}
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

function applyTheme(mode){const dark=mode==='dark';document.body.classList.toggle('theme-dark',dark);const sw=$('#themeSwitch');sw.dataset.mode=dark?'dark':'light';sw.setAttribute('aria-checked',String(dark))}
const themeSwitch=$('#themeSwitch');
function toggleTheme(){const dark=!document.body.classList.contains('theme-dark');applyTheme(dark?'dark':'light');ThemeStore.write(dark?'dark':'light')}
if(themeSwitch){themeSwitch.addEventListener('click',toggleTheme);themeSwitch.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();toggleTheme()}})}

const cal={track:null,curr:null,nextbuf:null,title:null,month:null,year:null};
function isoWeekNumber(d){const date=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));const dayNum=(date.getUTCDay()+6)%7;date.setUTCDate(date.getUTCDate()-dayNum+3);const firstThursday=new Date(Date.UTC(date.getUTCFullYear(),0,4));const diff=date-firstThursday;return 1+Math.round(diff/(7*24*3600*1000))}
function buildMonthMatrix(y,m){const first=new Date(y,m,1);const startDay=(first.getDay()+6)%7;const weeks=[];let day=1-startDay;const today=new Date();today.setHours(0,0,0,0);while(true){const week={weekNum:null,days:[]};for(let i=0;i<7;i++){const d=new Date(y,m,day);const inMonth=d.getMonth()===m;const isToday=d.getTime()===today.getTime();week.days.push({d,inMonth,isToday});day++}const thursday=new Date(week.days[3].d);week.weekNum=isoWeekNumber(thursday);weeks.push(week);const lastDay=week.days[6].d;if(lastDay.getMonth()>m||(y<lastDay.getFullYear()&&lastDay.getMonth()===0))break;if(weeks.length>6)break}return weeks}
function renderMonthInto(container,y,m){const weeks=buildMonthMatrix(y,m);const wrap=document.createElement('div');wrap.className='cal-grid';for(const w of weeks){const wn=document.createElement('div');wn.className='cal-weeknum';wn.textContent=String(w.weekNum).padStart(2,'0');wrap.appendChild(wn);for(const cell of w.days){const el=document.createElement('div');el.className='cal-day';if(!cell.inMonth)el.classList.add('is-out');if(cell.isToday)el.classList.add('is-today');el.textContent=cell.d.getDate();wrap.appendChild(el)}}container.innerHTML='';container.appendChild(wrap)}
function monthTitle(y,m){const names=['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];return`${names[m]} ${y}`}
function initCalendar(){cal.track=$('#calTrack');cal.curr=$('#calCurr');cal.nextbuf=$('#calNextBuf');cal.title=$('#calTitle');const now=new Date();cal.month=now.getMonth();cal.year=now.getFullYear();renderMonthInto(cal.curr,cal.year,cal.month);cal.title.textContent=monthTitle(cal.year,cal.month);$('#calPrev').addEventListener('click',()=>shiftMonth(-1));$('#calNext').addEventListener('click',()=>shiftMonth(1));$('#calToday').addEventListener('click',()=>jumpToToday())}
function shiftMonth(dir){let y=cal.year,m=cal.month+dir;if(m<0){m=11;y--}else if(m>11){m=0;y++}renderMonthInto(cal.nextbuf,y,m);cal.track.style.transition='none';cal.track.style.transform=dir>0?'translateX(0%)':'translateX(-100%)';requestAnimationFrame(()=>{requestAnimationFrame(()=>{cal.track.style.transition='transform .24s ease';cal.track.style.transform=dir>0?'translateX(-100%)':'translateX(0%)'})});const onEnd=()=>{cal.track.removeEventListener('transitionend',onEnd);cal.curr.innerHTML=cal.nextbuf.innerHTML;cal.track.style.transition='none';cal.track.style.transform='translateX(0%)';cal.year=y;cal.month=m;cal.title.textContent=monthTitle(cal.year,cal.month)};cal.track.addEventListener('transitionend',onEnd,{once:true})}
function jumpToToday(){const now=new Date();const ty=now.getFullYear();const tm=now.getMonth();if(ty===cal.year&&tm===cal.month)return;const dir=(ty>cal.year||(ty===cal.year&&tm>cal.month))?1:-1;renderMonthInto(cal.nextbuf,ty,tm);cal.track.style.transition='none';cal.track.style.transform=dir>0?'translateX(0%)':'translateX(-100%)';requestAnimationFrame(()=>{requestAnimationFrame(()=>{cal.track.style.transition='transform .24s ease';cal.track.style.transform=dir>0?'translateX(-100%)':'translateX(0%)'})});const onEnd=()=>{cal.track.removeEventListener('transitionend',onEnd);cal.curr.innerHTML=cal.nextbuf.innerHTML;cal.track.style.transition='none';cal.track.style.transform='translateX(0%)';cal.year=ty;cal.month=tm;cal.title.textContent=monthTitle(cal.year,cal.month)};cal.track.addEventListener('transitionend',onEnd,{once:true})}

$('#addBtn').onclick=()=>{addTask($('#taskInput').value);$('#taskInput').value=''};
$('#taskInput').onkeydown=e=>{if(e.key==='Enter'){addTask(e.target.value);e.target.value=''}};
$$('.nav-btn').forEach(btn=>btn.onclick=()=>{const view=btn.dataset.view;if(view==='today'){currentView='today';render();return}if(view==='sprint'){currentView='sprint';render();return}if(view==='eisenhower'){toast('Эта кнопка — заглушка');return}currentView='all';render()});

const projToggle=$('#projToggle');
const projList=$('#projList');
const projAdd=$('#projAdd');
const ProjCtx={el:document.getElementById('projCtxMenu'),id:null,anchor:null};

function renderProjects(){
  projList.innerHTML='';
  if(!projects.length){const hint=document.createElement('div');hint.className='proj-item';hint.style.color='var(--muted)';hint.textContent='Проектов пока нет';projList.appendChild(hint);return}
  for(const p of projects){
    const row=document.createElement('div');row.className='proj-item';row.dataset.id=p.id;
    const name=document.createElement('div');name.className='name';name.textContent=p.title;row.appendChild(name);
    const act=document.createElement('button');act.className='icon-btn';act.textContent='Фильтр';act.title='Показать задачи проекта';act.onclick=e=>{e.stopPropagation();currentView='project';currentProjectId=p.id;render()};row.appendChild(act);
    row.addEventListener('click',()=>{currentView='project';currentProjectId=p.id;render()});
    row.addEventListener('contextmenu',e=>{e.preventDefault();openProjMenu(p.id,e.clientX,e.clientY,row)});
    projList.appendChild(row)
  }
}
let projectsOpen=false;
function setProjectsOpen(open){projectsOpen=!!open;if(projectsOpen){projList.style.display='flex';projList.removeAttribute('hidden');projToggle.setAttribute('aria-expanded','true');projToggle.querySelector('.chev').textContent='▾';renderProjects()}else{projList.style.display='none';projList.setAttribute('hidden','');projToggle.setAttribute('aria-expanded','false');projToggle.querySelector('.chev').textContent='▸';closeProjMenu()}}
projToggle.addEventListener('click',()=>setProjectsOpen(!projectsOpen));

function openProjMenu(id,x,y,anchor){ProjCtx.id=id;ProjCtx.anchor=anchor;const menu=ProjCtx.el;menu.innerHTML='';const edit=document.createElement('div');edit.className='context-item';edit.textContent='Редактировать';edit.onclick=()=>{closeProjMenu();startProjectRename(id,anchor)};const del=document.createElement('div');del.className='context-item';del.textContent='Удалить';del.onclick=()=>{closeProjMenu();deleteProject(id)};menu.append(edit,del);menu.style.display='block';const mw=menu.offsetWidth,mh=menu.offsetHeight;const px=Math.min(x,window.innerWidth-mw-8),py=Math.min(y,window.innerHeight-mh-8);menu.style.left=px+'px';menu.style.top=py+'px';menu.setAttribute('aria-hidden','false')}
function closeProjMenu(){ProjCtx.id=null;ProjCtx.anchor=null;ProjCtx.el.style.display='none';ProjCtx.el.setAttribute('aria-hidden','true')}
window.addEventListener('click',e=>{if(!ProjCtx.el.contains(e.target))closeProjMenu()});
window.addEventListener('keydown',e=>{if(e.key==='Escape')closeProjMenu()});
window.addEventListener('resize',closeProjMenu);
window.addEventListener('scroll',closeProjMenu,true);

function startProjectRename(id,row){const p=projects.find(pr=>pr.id===id);if(!p)return;const target=row?.querySelector('.name')||[...projList.children].find(n=>n.dataset.id===id)?.querySelector('.name');if(!target)return;const input=document.createElement('input');input.className='proj-input';input.value=p.title;target.replaceWith(input);input.focus();input.select();let finished=false;const save=()=>{if(finished)return;finished=true;const v=(input.value||'').trim();if(!v){toast('Назови проект');input.focus();finished=false;return}p.title=v;ProjectsStore.write(projects);renderProjects()};const cancel=()=>{if(finished)return;finished=true;renderProjects()};input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();save()}else if(e.key==='Escape'){e.preventDefault();cancel()}});input.addEventListener('blur',()=>{if(!finished)save()})}
function deleteProject(id){const idx=projects.findIndex(p=>p.id===id);if(idx===-1)return;projects.splice(idx,1);ProjectsStore.write(projects);renderProjects();toast('Проект удалён')}
projAdd.addEventListener('click',()=>{setProjectsOpen(true);const row=document.createElement('div');row.className='proj-item';const input=document.createElement('input');input.className='proj-input';input.placeholder='Название проекта…';row.appendChild(input);projList.prepend(row);input.focus();let saved=false;const finish=save=>{if(saved)return;saved=true;const v=(input.value||'').trim();if(save){if(!v){toast('Назови проект');input.focus();saved=false;return}projects.unshift({id:uid(),title:v});ProjectsStore.write(projects)}renderProjects()};input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();finish(true)}else if(e.key==='Escape'){e.preventDefault();finish(false)}});input.addEventListener('blur',()=>{if(!saved)finish(true)})});

document.addEventListener('keydown',e=>{if(e.target&&(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'||e.target.isContentEditable))return;if(e.key==='Tab'&&selectedTaskId){e.preventDefault();addSubtask(selectedTaskId)}});

if(!tasks.length){tasks=[{id:uid(),title:'Добавь несколько задач',done:false,collapsed:false,due:null,project:null,children:[{id:uid(),title:'Пример подзадачи',done:false,collapsed:false,due:null,project:null,children:[]} ]},{id:uid(),title:'ПКМ по строке → «Редактировать»',done:false,collapsed:false,due:null,project:null,children:[]},{id:uid(),title:'Отметь как выполненную — увидишь зачёркивание',done:true,collapsed:false,due:null,project:null,children:[] }];Store.write(tasks)}
if(!projects.length){projects=[{id:uid(),title:'Личный'},{id:uid(),title:'Работа'}];ProjectsStore.write(projects)}

function getProjectTitle(id){const p=projects.find(x=>x.id===id);return p?p.title:'Проект'}
function assignProject(taskId,projId){const t=findTask(taskId);if(!t)return;t.project=projId;Store.write(tasks);render();toast('Назначено в проект: '+getProjectTitle(projId))}
function clearProject(taskId){const t=findTask(taskId);if(!t)return;t.project=null;Store.write(tasks);render()}
function openAssignSubmenu(taskId,anchorMenu){const sub=Ctx.sub;sub.innerHTML='';if(!projects.length){const it=document.createElement('div');it.className='ctx-submenu-item';it.textContent='Нет проектов';sub.appendChild(it)}else{for(const p of projects){const it=document.createElement('div');it.className='ctx-submenu-item';it.textContent=p.title;it.onclick=e=>{e.stopPropagation();assignProject(taskId,p.id);closeContextMenu()};sub.appendChild(it)}}const t=findTask(taskId);if(t&&t.project){const sep=document.createElement('div');sep.style.height='6px';sub.appendChild(sep);const clr=document.createElement('div');clr.className='ctx-submenu-item';clr.textContent='Снять проект';clr.onclick=e=>{e.stopPropagation();clearProject(taskId);closeContextMenu()};sub.appendChild(clr)}const r=anchorMenu.getBoundingClientRect();sub.style.display='block';sub.style.left=(r.right+6)+'px';sub.style.top=r.top+'px';sub.setAttribute('aria-hidden','false')}
function closeAssignSubmenu(){Ctx.sub.style.display='none';Ctx.sub.setAttribute('aria-hidden','true')}
function maybeCloseSubmenu(){setTimeout(()=>{if(!Ctx.sub.matches(':hover'))closeAssignSubmenu()},120)}

try{console.assert(monthTitle(2025,0)==='Январь 2025');const weeks=buildMonthMatrix(2025,0);console.assert(weeks.length>=4&&weeks.length<=6);console.assert(rowClass({collapsed:false,done:false,id:'x'})==='task');const sprintSample=buildSprintData([{id:'a',title:'t',due:new Date().toISOString(),children:[]}]);console.assert(Array.isArray(sprintSample));}catch(e){console.warn('Self-tests failed:',e)}

function isDueToday(iso){if(!iso)return false;const d=new Date(iso);if(isNaN(d))return false;const now=new Date();return d.getFullYear()===now.getFullYear()&&d.getMonth()===now.getMonth()&&d.getDate()===now.getDate()}
function filterTree(list,pred){const out=[];for(const t of list){const kids=t.children||[];const fk=filterTree(kids,pred);if(pred(t)||fk.length){out.push({...t,children:fk})}}return out}
function isoWeekInfo(d){const date=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));const dayNum=(date.getUTCDay()+6)%7;date.setUTCDate(date.getUTCDate()-dayNum+3);const weekYear=date.getUTCFullYear();const firstThursday=new Date(Date.UTC(weekYear,0,4));const diff=date-firstThursday;const week=1+Math.round(diff/(7*24*3600*1000));return{week,year:weekYear}}
function buildSprintData(list){const map=new Map();function visit(t){if(t.due){const d=new Date(t.due);if(!isNaN(d)){const wd=d.getDay();if(wd>=1&&wd<=5){const{week,year}=isoWeekInfo(d);const key=year+':'+week;if(!map.has(key))map.set(key,{week,year,days:{1:[],2:[],3:[],4:[],5:[]}});map.get(key).days[wd].push(t)}}}for(const c of t.children||[])visit(c)}for(const t of list)visit(t);return Array.from(map.values()).sort((a,b)=>a.year===b.year?a.week-b.week:a.year-b.year)}
function renderSprint(container){const sprints=buildSprintData(tasks);if(!sprints.length){const hint=document.createElement('div');hint.className='sprint-empty';hint.textContent='Нет задач с дедлайном — спринты появятся автоматически.';container.appendChild(hint);return}const wrap=document.createElement('div');wrap.className='sprint';const dayNames=['Пн','Вт','Ср','Чт','Пт'];for(const sp of sprints){const row=document.createElement('div');row.className='sprint-row';const label=document.createElement('div');label.className='sprint-week';label.textContent='Неделя '+String(sp.week).padStart(2,'0');const grid=document.createElement('div');grid.className='sprint-grid';for(let i=1;i<=5;i++){const col=document.createElement('div');col.className='sprint-col';const title=document.createElement('div');title.className='col-title';title.textContent=dayNames[i-1];col.appendChild(title);const items=sp.days[i]||[];if(items.length===0){const empty=document.createElement('div');empty.className='sprint-empty';empty.textContent='—';col.appendChild(empty)}for(const t of items){const it=document.createElement('div');it.className='sprint-task';it.textContent=t.title;if(t.done)it.style.opacity=.6;it.addEventListener('click',()=>{selectedTaskId=t.id;currentView='all';render();const row=document.querySelector(`.task[data-id="${t.id}"]`);row&&row.scrollIntoView({block:'center',behavior:'smooth'})});col.appendChild(it)}grid.appendChild(col)}row.append(label,grid);wrap.appendChild(row)}container.appendChild(wrap)}

function formatDue(iso){const d=new Date(iso);if(isNaN(d))return'';const dd=String(d.getDate()).padStart(2,'0');const mm=String(d.getMonth()+1).padStart(2,'0');return`${dd}.${mm}`}

const Due={el:document.getElementById('dueMenu'),taskId:null,y:null,m:null};
function buildDuePicker(y,m){const cont=document.createElement('div');cont.style.padding='6px';const header=document.createElement('div');header.className='cal-header';const todayBtn=document.createElement('button');todayBtn.className='cal-today';todayBtn.title='К текущему месяцу';const title=document.createElement('div');title.className='cal-title';title.textContent=monthTitle(y,m);const ctrls=document.createElement('div');ctrls.className='cal-ctrls';const prev=document.createElement('button');prev.className='cal-arrow';prev.textContent='‹';const next=document.createElement('button');next.className='cal-arrow';next.textContent='›';header.append(todayBtn,title,ctrls);ctrls.append(prev,next);const legend=document.createElement('div');legend.className='cal-legend';legend.innerHTML='<div>Wk</div><div>Пн</div><div>Вт</div><div>Ср</div><div>Чт</div><div>Пт</div><div>Сб</div><div>Вс</div>';const viewport=document.createElement('div');viewport.className='cal-viewport';const monthEl=document.createElement('div');monthEl.className='cal-month';const track=document.createElement('div');track.className='cal-track';track.appendChild(monthEl);viewport.appendChild(track);cont.append(header,legend,viewport);function renderLocal(){renderMonthInto(monthEl,Due.y,Due.m);title.textContent=monthTitle(Due.y,Due.m)}prev.onclick=()=>{let ny=Due.y,nm=Due.m-1;if(nm<0){nm=11;ny--}Due.y=ny;Due.m=nm;renderLocal()};next.onclick=()=>{let ny=Due.y,nm=Due.m+1;if(nm>11){nm=0;ny++}Due.y=ny;Due.m=nm;renderLocal()};todayBtn.onclick=()=>{const now=new Date();Due.y=now.getFullYear();Due.m=now.getMonth();renderLocal()};renderLocal();cont.addEventListener('click',e=>{const dayEl=e.target.closest('.cal-day');if(!dayEl)return;const day=Number(dayEl.textContent);const d=new Date(Due.y,Due.m,day);const t=findTask(Due.taskId);if(!t)return;t.due=d.toISOString();Store.write(tasks);closeDuePicker();render()});return cont}
function openDuePicker(taskId,anchor){Due.taskId=taskId;const now=new Date();Due.y=now.getFullYear();Due.m=now.getMonth();const menu=Due.el;menu.innerHTML='';menu.appendChild(buildDuePicker(Due.y,Due.m));menu.style.display='block';menu.setAttribute('aria-hidden','false');const r=anchor.getBoundingClientRect();const mw=300;const x=Math.min(r.left,window.innerWidth-mw-8);const y=r.bottom+6;menu.style.left=x+'px';menu.style.top=y+'px';menu.style.position='fixed'}
function closeDuePicker(){Due.taskId=null;Due.el.style.display='none';Due.el.setAttribute('aria-hidden','true')}
window.addEventListener('click',e=>{if(Due.el.style.display==='block'&&!Due.el.contains(e.target)&&!e.target.closest('.due-btn'))closeDuePicker()},true);

(function(){applyTheme(ThemeStore.read());render();initCalendar()})();
