const localEngine = new ZaopianEngineClient();
const mediaView = { connected:false, health:null, job:null, working:false, dirty:false, images:{}, video:null, error:'', epoch:0 };

function engineConnectionPanel(){
  return `<div class="engine-connection"><div><b>${mediaView.connected?'本机处理已连接':'真实视频处理'}</b><p>${mediaView.connected?esc(mediaView.health.message):'抽帧、台词转写与字幕 MP4 在这台电脑上处理。'}</p></div><div class="inline-actions"><button class="btn small" data-engine="connect">${mediaView.connected?'重新检查连接':'连接本机处理'}</button><a class="btn small" href="http://127.0.0.1:4173" target="_blank" rel="noopener">打开本机版</a></div>${mediaView.error?`<p class="error" role="alert">${esc(mediaView.error)}</p>`:''}<details><summary>如何启动本机处理</summary><p>双击桌面的「启动造片本机版」，再点击连接。处理期间保持电脑和服务运行。换到其他电脑，需要先安装本机处理工具。素材和处理结果保存在本机。</p></details></div>`;
}

function localEvidencePanel(){
  if(state.reference?.kind!=='local')return '';
  const job=mediaView.job;
  const active=job && ['queued','running'].includes(job.status);
  const exporting=job?.export && ['queued','running'].includes(job.export.status);
  const completed=job?.status==='completed';
  if(state.step===5 && completed)return `<section class="panel evidence-panel" aria-label="字幕 MP4 导出"><span class="tag">本机处理 · ${job.media.duration.toFixed(2)} 秒原片</span>${captionExportPanel(job,exporting)}<button class="btn small" data-step="2">查看画面证据与校正台词</button></section>`;
  return `<section class="panel evidence-panel" aria-label="真实视频拆解"><div class="panel-title"><div><h2>真实视频拆解</h2><p class="muted">Hypit 抽帧与切点检测 · 本地台词转写</p></div><span class="tag">本机处理</span></div><p class="notice">这里展示实际视频信息、画面和识别台词。切点是画面变化候选；故事结构与卖点判断仍需人工核对，后面的演示建议保持单独标注。</p><button class="btn primary" data-engine="analyze" ${!mediaView.connected || !mediaView.health?.mediaReady || mediaView.working || active?'disabled':''}>${active?'正在处理真实视频…':completed?'重新拆解本地视频':'开始真实拆解'}</button>${!videoFile?'<p class="muted">重新拆解前请重新选择本地文件；已完成的记录可在连接后恢复。</p>':''}<div class="engine-progress" role="status" aria-live="polite">${job?`<p data-media-message>${esc(job.message)}</p><div class="progress"><div data-media-progress style="width:${job.progress}%"></div></div>`:''}</div>${job?.status==='failed'||job?.status==='interrupted'?`<p class="error">${esc(job.message)}</p>`:''}${completed?`<div class="media-facts"><span>时长 <b>${job.media.duration.toFixed(2)} 秒</b></span><span>画面 <b>${job.media.width} × ${job.media.height}</b></span><span>帧率 <b>${job.media.frameRate}</b></span><span>声音 <b>${job.media.hasAudio?'有音轨':'无音轨'}</b></span></div><details open><summary>画面证据与切点候选</summary>${mediaView.images['overview.jpg']?`<img class="overview-grid" src="${esc(mediaView.images['overview.jpg'])}" alt="真实视频的十二帧概览拼图">`:''}<div class="frame-grid">${(job.frames || []).map((f,i)=>`<figure>${mediaView.images[f.file]?`<img src="${esc(mediaView.images[f.file])}" alt="第${i+1}张关键帧，源视频${f.time.toFixed(2)}秒">`:'<div class="frame-placeholder">读取关键帧</div>'}<figcaption>${f.time.toFixed(2)} 秒</figcaption></figure>`).join('')}</div><p class="muted">切点候选：${job.boundaries.length?job.boundaries.map(b=>b.at.toFixed(2)+' 秒').join('、'):'本次阈值下没有明显画面变化候选'}。请结合关键帧与原视频确认。</p></details><div class="panel-title transcript-heading"><div><h3>台词校正</h3><p class="muted">保留识别时间，只修改文字。原始转写另存，校正不会覆盖原记录。</p></div><span class="tag" data-transcript-dirty>${mediaView.dirty?'有未保存修改':'已保存'}</span></div>${job.transcript.segments.length?`<div class="transcript-list">${job.transcript.segments.map((s,i)=>`<label class="transcript-row"><span>${s.start.toFixed(2)}–${s.end.toFixed(2)} 秒</span><textarea data-transcript="${i}" aria-label="第${i+1}段真实台词" maxlength="1000" ${exporting?'disabled':''}>${esc(s.text)}</textarea></label>`).join('')}</div><div class="inline-actions"><button class="btn" data-engine="save-transcript" ${!mediaView.dirty || exporting?'disabled':''}>保存台词校正</button><button class="btn" data-engine="use-transcript" ${mediaView.dirty || exporting?'disabled':''}>将校正台词带入脚本</button></div>`:`<p class="notice">${esc(job.transcript.reason || '没有识别到台词，请人工检查音轨。')}</p>`}<div class="inline-actions artifact-actions">${[['subtitles.srt','下载 SRT 字幕'],['transcript.raw.json','下载原始转写'],['transcript.corrected.json','下载校正转写']].map(([file,label])=>`<button class="btn small" data-artifact="${file}" ${mediaView.dirty && file!=='transcript.raw.json'?'disabled':''}>${label}</button>`).join('')}</div>${captionExportPanel(job,exporting)}`:''}</section>`;
}

function captionExportPanel(job,exporting){return `<div class="caption-export"><h3>原视频字幕校对版</h3><p class="muted">保留原视频画面、原声音和画幅，叠加保存后的台词。原片已有的烧录字幕会保留，校正字幕加在底部。此文件用于字幕校对，不会替换成你的商品或生成新画面。</p><div class="inline-actions"><button class="btn primary" data-engine="export" ${mediaView.dirty || mediaView.working || exporting?'disabled':''}>${exporting?'正在合成 MP4…':'合成字幕校对 MP4'}</button>${job.export?.status==='completed' && !mediaView.dirty?'<button class="btn" data-artifact="'+esc(job.export.file)+'">下载 MP4</button>':''}</div>${job.export?`<div role="status"><p data-export-message class="muted">${esc(job.export.message)}</p>${exporting?`<div class="progress"><div data-export-progress style="width:${job.export.progress}%"></div></div>`:''}</div>`:''}${mediaView.video && !mediaView.dirty?`<video controls preload="metadata" src="${esc(mediaView.video)}" aria-label="真实字幕校对 MP4"></video>`:''}</div>`;}

function resetLocalEvidence(){
  mediaView.epoch++;mediaView.job=null;mediaView.working=false;mediaView.dirty=false;mediaView.images={};mediaView.video=null;localEngine.clearAssets();
}

async function connectLocalEngine(){
  mediaView.error='';
  try {
    mediaView.health=await localEngine.connect();mediaView.connected=true;
    const id=state.reference?.engineJobId;
    if(id){try{mediaView.job=await localEngine.job(id);applyTranscriptDraft();}catch{mediaView.job=null;mediaView.error='本机没有找到这条处理记录，请重新选择并拆解视频。';}}
    render();
    if(mediaView.job){await loadEvidenceAssets();if(['queued','running'].includes(mediaView.job.status)||['queued','running'].includes(mediaView.job.export?.status))pollLocalJob(mediaView.job.id,mediaView.epoch);}
  } catch {
    mediaView.connected=false;mediaView.error='尚未连接。请先启动本机版；若浏览器询问本地网络访问，请按正常权限设置允许工作台连接。';render();
  }
}

function applyTranscriptDraft(){
  const draft=state.reference?.transcriptDraft;
  if(draft && draft.revision===mediaView.job.revision && draft.segments.length===mediaView.job.transcript?.segments.length){
    mediaView.job.transcript.segments.forEach((s,i)=>{if(draft.segments[i].id===s.id)s.text=draft.segments[i].text;});mediaView.dirty=true;
  }
}

async function loadEvidenceAssets(){
  const job=mediaView.job,epoch=mediaView.epoch;if(job?.status!=='completed')return;
  const files=['overview.jpg',...(job.frames || []).map(f=>f.file)];
  const images=Object.fromEntries(await Promise.all(files.map(async file=>[file,await localEngine.asset(job.id,file)])));
  let video=null;if(job.export?.status==='completed' && !mediaView.dirty)video=await localEngine.asset(job.id,job.export.file);
  if(epoch!==mediaView.epoch || state.reference?.engineJobId!==job.id)return;
  mediaView.images=images;mediaView.video=video;render();
}

async function startLocalAnalysis(){
  if(!videoFile){toast('请重新选择本地视频文件');return;}
  if(mediaView.working)return;
  const file=videoFile;invalidateTranscriptDerivedDraft();resetLocalEvidence();const epoch=mediaView.epoch;
  mediaView.working=true;state.step=2;render();
  try {
    const job=await localEngine.upload(file);
    if(epoch!==mediaView.epoch || file!==videoFile)return;
    state.reference.engineJobId=job.id;delete state.reference.transcriptDraft;mediaView.job=job;save();render();await pollLocalJob(job.id,epoch);
  } catch(error){toast(error.message);mediaView.error=error.message;}
  finally{if(epoch===mediaView.epoch){mediaView.working=false;render();}}
}

async function pollLocalJob(id,epoch){
  try {
    while(epoch===mediaView.epoch && state.reference?.engineJobId===id){
      const job=await localEngine.job(id);if(epoch!==mediaView.epoch)return;
      mediaView.job=job;
      const message=document.querySelector('[data-media-message]');if(message)message.textContent=job.message;
      const progress=document.querySelector('[data-media-progress]');if(progress)progress.style.width=job.progress+'%';
      const exportMessage=document.querySelector('[data-export-message]');if(exportMessage)exportMessage.textContent=job.export?.message || '';
      const exportProgress=document.querySelector('[data-export-progress]');if(exportProgress)exportProgress.style.width=(job.export?.progress || 0)+'%';
      if(!['queued','running'].includes(job.status) && !['queued','running'].includes(job.export?.status)){mediaView.working=false;render();await loadEvidenceAssets();return;}
      await new Promise(resolve=>setTimeout(resolve,1200));
    }
  } catch(error){if(epoch===mediaView.epoch){mediaView.working=false;mediaView.error='处理连接已中断。重新连接后可继续查看本机任务。';render();}}
}

async function saveLocalTranscript(){
  const job=mediaView.job;if(!job || !mediaView.dirty)return;
  const epoch=mediaView.epoch;
  try {const result=await localEngine.correct(job.id,job.transcript.segments.map(s=>({id:s.id,text:s.text})));if(epoch!==mediaView.epoch)return;
    mediaView.job=result;mediaView.dirty=false;mediaView.video=null;delete state.reference.transcriptDraft;save();render();toast('校正已保存，原始转写保持完整');
  } catch(error){toast(error.message);}
}

function invalidateTranscriptDerivedDraft(){
  if(state.scriptOrigin!=='reference')return;
  state.analysis=null;state.script=null;state.shots=null;state.tasks=[];clearRendered();
}

function useLocalTranscript(){
  const job=mediaView.job;if(!job || mediaView.dirty)return;
  const segments=job.transcript.segments.filter(s=>s.text.trim());if(!segments.length)return;
  state.analysis=segments.map((s,i)=>({title:'原片台词 '+(i+1),time:`${s.start}–${s.end}s`,content:s.text}));
  state.script=segments.map((s,i)=>({title:'台词 '+(i+1),time:`${s.start}–${s.end}s`,text:s.text}));
  state.scriptOrigin='reference';state.settings.duration=String(Math.round(job.media.duration*100)/100);state.shots=null;state.tasks=[];clearRendered();state.step=3;save();render();toast('已带入原片台词，请重构为你的商品内容');
}

async function exportLocalMp4(){
  const job=mediaView.job;if(!job || mediaView.dirty || mediaView.working)return;
  const epoch=mediaView.epoch;mediaView.working=true;mediaView.video=null;
  if(job.export?.file)localEngine.releaseAsset(job.id,job.export.file);
  try{mediaView.job=await localEngine.export(job.id);render();await pollLocalJob(job.id,epoch);}catch(error){toast(error.message);}finally{if(epoch===mediaView.epoch){mediaView.working=false;render();}}
}

document.addEventListener('click',async event=>{
  const target=event.target.closest('button');if(!target)return;
  if(busy)return;
  const action=target.dataset.engine;
  if(action==='connect')connectLocalEngine();
  if(action==='analyze')startLocalAnalysis();
  if(action==='save-transcript')saveLocalTranscript();
  if(action==='use-transcript')useLocalTranscript();
  if(action==='export')exportLocalMp4();
  if(target.dataset.artifact && mediaView.job){try{const blob=await localEngine.blob(mediaView.job.id,target.dataset.artifact);download(blob,target.dataset.artifact.endsWith('.mp4')?'原视频-字幕校对.mp4':target.dataset.artifact);}catch(error){toast(error.message);}}
});

document.addEventListener('input',event=>{
  if(event.target.dataset.transcript===undefined || !mediaView.job)return;
  const segment=mediaView.job.transcript.segments[Number(event.target.dataset.transcript)];if(!segment)return;
  segment.text=event.target.value;mediaView.dirty=true;mediaView.video=null;invalidateTranscriptDerivedDraft();
  const oldPlayer=document.querySelector('video[aria-label="真实字幕校对 MP4"]');if(oldPlayer){oldPlayer.pause();oldPlayer.hidden=true;}
  state.reference.transcriptDraft={revision:mediaView.job.revision,segments:mediaView.job.transcript.segments.map(s=>({id:s.id,text:s.text}))};save();
  const label=document.querySelector('[data-transcript-dirty]');if(label)label.textContent='有未保存修改';
  for(const button of document.querySelectorAll('[data-engine="export"],[data-engine="use-transcript"],[data-artifact]:not([data-artifact="transcript.raw.json"])'))button.disabled=true;
  const saveButton=document.querySelector('[data-engine="save-transcript"]');if(saveButton)saveButton.disabled=false;
});

document.addEventListener('DOMContentLoaded',()=>{if(['127.0.0.1','localhost'].includes(location.hostname))connectLocalEngine();});
