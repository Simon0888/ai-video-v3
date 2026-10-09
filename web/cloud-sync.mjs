import { projectData } from './project-data.mjs';
let revision=0,ready=false,dirty=false,sending=false,timer,remoteConflict=null,sequence=0;
const cacheKey='zaopian-cloud-base-v1';
const status={label:'正在读取账号项目…',error:''};
function displayStatus(){
  if(remoteConflict)return {label:'版本冲突',tone:'error'};
  if(status.label.startsWith('暂未同步'))return {label:'未同步',tone:'error'};
  if(!ready)return {label:'连接中…',tone:'working'};
  if(status.label==='正在保存项目文字…')return {label:'保存中…',tone:'working'};
  if(dirty)return {label:'待保存',tone:'working'};
  return {label:status.label==='账号项目已连接'?'已连接':'已保存',tone:'saved'};
}
const statusPath=tone=>tone==='error'?'M12 8v5m0 3h.01M12 3L2 21h20z':tone==='working'?'M12 8v4l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0':'M5 12l4 4L19 6';
const notify=()=>{
  const current=displayStatus();
  for(const el of document.querySelectorAll('[data-cloud-status]'))el.textContent=current.label;
  for(const el of document.querySelectorAll('[data-cloud-message]'))el.textContent=status.label;
  for(const el of document.querySelectorAll('[data-cloud-error]')){el.textContent=status.error;el.hidden=!status.error;}
  for(const el of document.querySelectorAll('[data-workspace-save]')){
    el.dataset.tone=current.tone;
    el.querySelector('summary').title=status.label;
    el.querySelector('[data-cloud-icon]').setAttribute('d',statusPath(current.tone));
  }
};
const cache=()=>{localStorage.setItem(cacheKey,JSON.stringify({revision,base:projectData(state)}));};
function apply(remote){
  const referenceKey=value=>JSON.stringify([value?.kind,value?.fingerprint,value?.name]);
  const old=referenceKey(state.reference);
  const changedShots=JSON.stringify(state.shots)!==JSON.stringify(remote.shots) || JSON.stringify(state.product)!==JSON.stringify(remote.product) || state.settings.duration!==remote.settings?.duration;
  state={...fresh(),...remote};
  if(old!==referenceKey(state.reference)){if(videoUrl)URL.revokeObjectURL(videoUrl);videoFile=null;videoUrl=null;}
  if(changedShots || old!==referenceKey(state.reference))clearRendered();
  localStorage.setItem('zaopian-v1',JSON.stringify({version:1,state}));
  if(typeof restoreBrowserEvidence==='function')restoreBrowserEvidence();
  render();
}
async function getRemote(){const response=await fetch('/api/workspace',{cache:'no-store'});if(!response.ok)throw Error('账号项目暂时无法读取');return response.json();}
async function flush(){
  clearTimeout(timer);if(!ready||!dirty||sending||remoteConflict)return;
  sending=true;const current=sequence;status.label='正在保存项目文字…';notify();
  try{
    const clean=projectData(state);
    const response=await fetch('/api/workspace',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision,state:clean})});
    const result=await response.json();
    if(response.status===409){remoteConflict=result;status.label='两台设备有不同修改';render();return;}
    if(!response.ok)throw Error(result.error || '保存失败');
    revision=result.revision;dirty=current!==sequence;
    localStorage.setItem(cacheKey,JSON.stringify({revision,base:clean}));
    status.label=dirty?'有待保存修改':'项目文字已随账号保存';status.error='';notify();
  }catch(error){status.label='暂未同步 · 草稿保留在此浏览器';status.error=error.message;notify();}
  finally{sending=false;if(dirty&&!remoteConflict)timer=setTimeout(flush,5000);}
}
function changed(){dirty=true;sequence++;status.label='有待保存修改';notify();clearTimeout(timer);timer=setTimeout(flush,800);}
async function refresh(){
  if(sending||busy||mediaView.working)return;
  if(dirty){await flush();return;}
  try{const remote=await getRemote();if(remote.revision>revision){revision=remote.revision;apply(remote.state);cache();status.label='已恢复另一台设备的最新项目';notify();}}
  catch{status.label='暂未同步 · 草稿保留在此浏览器';notify();}
}
async function start(){
  // Read the server before saving: a new computer must never replace an existing
  // project with an empty browser cache, or silently overwrite offline edits.
  try{
    const remote=await getRemote();let saved=null;try{saved=JSON.parse(localStorage.getItem(cacheKey));}catch{}
    const local=projectData(state),hasLocal=Boolean(state.product || state.custom.length);
    const edited=saved && JSON.stringify(saved.base)!==JSON.stringify(local);
    revision=remote.revision;ready=true;
    if(remote.state){
      if(edited || (!saved&&hasLocal&&JSON.stringify(local)!==JSON.stringify(remote.state))){remoteConflict=remote;dirty=true;status.label='选择要继续使用的项目';render();}
      else{apply(remote.state);cache();status.label='账号项目已恢复';notify();}
    }else if(hasLocal){changed();await flush();}
    else{status.label='账号项目已连接';notify();}
  }catch(error){status.label='暂未同步 · 草稿保留在此浏览器';status.error=error.message;notify();}
}
function control(){
  const current=displayStatus();
  return `<details class="workspace-save" data-workspace-save data-tone="${current.tone}" ${remoteConflict?'open':''}><summary title="${esc(status.label)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path data-cloud-icon d="${statusPath(current.tone)}"/></svg><span data-cloud-status role="status" aria-live="polite">${current.label}</span></summary><div class="save-popover"><strong>项目保存</strong><p data-cloud-message>${esc(status.label)}</p><p class="error" data-cloud-error ${status.error?'':'hidden'}>${esc(status.error)}</p>${remoteConflict?`<div class="sync-conflict" role="alert"><p>账号资料与当前草稿有不同修改，请选择要继续使用的版本。</p><div class="save-actions"><button class="btn small" data-cloud="remote">使用账号最新资料</button><button class="btn small" data-cloud="local">保留当前修改并同步</button><button class="btn small" data-cloud="backup">下载当前草稿</button></div></div>`:`<p class="muted">项目文字自动保存到当前账号。</p><button class="btn small" data-cloud="retry">${current.tone==='error'?'重试同步':'同步项目'}</button>`}</div></details>`;
}
window.WorkspaceSync={changed,status,control,flush};
document.addEventListener('click',event=>{if(!event.target.closest('[data-workspace-save]')&&!remoteConflict)for(const el of document.querySelectorAll('[data-workspace-save]'))el.open=false;});
document.addEventListener('keydown',event=>{if(event.key==='Escape')for(const el of document.querySelectorAll('[data-workspace-save][open]')){el.open=false;el.querySelector('summary').focus();}});
document.addEventListener('click',async event=>{
  const action=event.target.closest('button')?.dataset.cloud;if(!action)return;
  if(busy||mediaView.working){toast('请等待当前浏览器视频处理完成');return;}
  if(action==='backup')download(new Blob([JSON.stringify(projectData(state),null,2)],{type:'application/json'}),'造片-当前浏览器项目.json');
  if(action==='remote'&&remoteConflict){const remote=remoteConflict;remoteConflict=null;revision=remote.revision;dirty=false;apply(remote.state);cache();status.label='已采用账号最新资料';notify();}
  if(action==='local'&&remoteConflict){revision=remoteConflict.revision;remoteConflict=null;dirty=true;render();await flush();}
  if(action==='retry'){if(!ready)await start();else if(dirty)await flush();else await refresh();}
});
window.addEventListener('online',()=>ready?flush():start());
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
window.addEventListener('beforeunload',event=>{if(dirty||sending){event.preventDefault();event.returnValue='';}});
setInterval(()=>{if(ready&&!document.hidden)refresh();},15000);
document.addEventListener('DOMContentLoaded',start);
