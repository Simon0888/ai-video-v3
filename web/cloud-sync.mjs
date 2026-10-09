import { projectData } from './project-data.mjs';
let revision=0,ready=false,dirty=false,sending=false,timer,remoteConflict=null,sequence=0;
const cacheKey='zaopian-cloud-base-v1';
const status={label:'正在读取账号项目…',error:''};
const notify=()=>{for(const el of document.querySelectorAll('[data-cloud-status]'))el.textContent=status.label;};
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
function panel(){return `<div class="sync-note"><span data-cloud-status>${esc(status.label)}</span><button class="btn small" data-cloud="retry">同步项目</button><span class="muted">只同步文字和进度，视频 / 图片 / 音频不上传。</span>${remoteConflict?`<div class="sync-conflict" role="alert"><p>当前浏览器与账号保存的资料有不同修改。请先导出需要保留的资料，再选择继续版本。</p><button class="btn" data-cloud="remote">使用账号最新资料</button><button class="btn" data-cloud="local">保留此浏览器修改并同步</button><button class="btn" data-cloud="backup">下载此浏览器资料</button></div>`:''}</div>`;}
window.WorkspaceSync={changed,status,panel,flush};
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
