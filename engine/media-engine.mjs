import { readFile, writeFile, mkdir, readdir, stat, rename, open } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, basename, extname } from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { validateCorrections, toAss, toSrt } from './subtitles.mjs';

export const MAX_UPLOAD = 100 * 1024 * 1024;
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const MIME = { '.json':'application/json', '.jpg':'image/jpeg', '.png':'image/png', '.mp4':'video/mp4', '.srt':'application/x-subrip', '.txt':'text/plain' };
const safeId = id => /^[a-f0-9-]{36}$/.test(id);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function atomicJson(path, data) {
  const temporary = path + '.tmp';
  await writeFile(temporary, JSON.stringify(data, null, 2), 'utf8');
  await rename(temporary, path);
}

export class MediaEngine {
  constructor({ root = ROOT, config = null } = {}) {
    this.root = root; this.config = config; this.jobs = new Map(); this.queue = []; this.running = false; this.saving = new Set();
    this.jobRoot = join(root, '.local', 'jobs');
  }
  async initialize() {
    await mkdir(this.jobRoot, { recursive:true });
    if (!this.config) { try { this.config = JSON.parse((await readFile(join(this.root,'.local','engine.json'),'utf8')).replace(/^\uFEFF/,'')); } catch { this.config = {}; } }
    for (const entry of await readdir(this.jobRoot, { withFileTypes:true })) {
      if (!entry.isDirectory() || !safeId(entry.name)) continue;
      try {
        const job = JSON.parse(await readFile(join(this.jobRoot,entry.name,'job.json'),'utf8'));
        if (['queued','running'].includes(job.status)) { job.status='interrupted'; job.message='上次处理已中断，请重新提交素材。'; await this.persist(job); }
        if (['queued','running'].includes(job.export?.status)) { job.export.status='interrupted'; job.export.message='上次导出已中断，可以重新导出。'; await this.persist(job); }
        this.jobs.set(job.id,job);
      } catch { /* Preserve unrecognized or partially uploaded files; never execute them. */ }
    }
    return this;
  }
  async persist(job) { await atomicJson(join(this.jobRoot,job.id,'job.json'),job); }
  get(id) { const job = safeId(id) && this.jobs.get(id); if (!job) throw Object.assign(Error('处理记录不存在，请重新选择素材'),{status:404}); return job; }
  publicJob(job) { return { ...job, source:undefined }; }
  async health() {
    const c=this.config, present=p=>typeof p==='string' && existsSync(p);
    const mediaReady=present(c.hypit) && present(c.ffmpeg) && present(c.ffprobe);
    const speechReady=present(c.python) && present(join(c.modelPath || '', 'model.bin'));
    return { engine:'Hypit', version:'0.3.0', mediaReady, speechReady, ready:mediaReady && speechReady,
      localOnly:true, maxBytes:MAX_UPLOAD, maxSeconds:300,
      message: !mediaReady?'本机视频工具尚未准备，请先完成本机安装。':!speechReady?'抽帧与 MP4 可用，转写模型尚未准备。':'本机处理已就绪',
      queueLength:this.queue.length + Number(this.running) };
  }
  async process(command,args,{cwd=this.root,timeout=180000,onOutput}={}) {
    const child=spawn(command,args,{cwd,windowsHide:true,shell:false,env:{...process.env,
      PATH:`${dirname(this.config.ffmpeg || '')}${process.platform==='win32'?';':':'}${process.env.PATH || ''}`,
      PYTHONUTF8:'1', HF_HUB_OFFLINE:'1', HF_HUB_DISABLE_TELEMETRY:'1'}});
    let stdout='',stderr='',expired=false;
    const timer=setTimeout(()=>{expired=true;child.kill();},timeout);
    return await new Promise((resolve,reject)=>{
      child.stdout.on('data',data=>{stdout+=data.toString();if(stdout.length>4*1024*1024){child.kill();}onOutput?.(data.toString());});
      child.stderr.on('data',data=>{stderr=(stderr+data.toString()).slice(-16000);});
      child.on('error',err=>{clearTimeout(timer);reject(err);});
      child.on('close',code=>{clearTimeout(timer);if(code===0)resolve(stdout);else reject(Error(expired?'处理超时，请改用较短的片段。':stderr || '视频处理失败'));});
    });
  }
  async hypit(args,options) { return JSON.parse(await this.process(this.config.node || process.execPath,[this.config.hypit,...args,'--json'],options)); }
  enqueue(task) { this.queue.push(task); this.drain(); }
  async drain() {
    if(this.running)return;this.running=true;
    try { while(this.queue.length) { try { await this.queue.shift()(); } catch(error) { console.error('Local job persistence error:',error.message); } } }
    finally { this.running=false; }
  }
  async upload(req,filename) {
    if(!(await this.health()).mediaReady)throw Object.assign(Error('本机视频工具尚未准备'),{status:503});
    if(this.queue.length>5)throw Object.assign(Error('当前任务较多，请稍后再提交'),{status:429});
    if(!/\.(mp4|mov|webm)$/i.test(filename))throw Object.assign(Error('仅支持 MP4、MOV 或 WebM 视频'),{status:400});
    if(Number(req.headers['content-length'])>MAX_UPLOAD)throw Object.assign(Error('文件超过 100 MB'),{status:413});
    const id=randomUUID(),dir=join(this.jobRoot,id);
    await mkdir(dir);const source='input'+extname(filename).toLowerCase();const file=await open(join(dir,source),'wx');let size=0;
    try { for await(const chunk of req) {size+=chunk.length;if(size>MAX_UPLOAD)throw Object.assign(Error('文件超过 100 MB'),{status:413});await file.write(chunk); } }
    finally { await file.close(); }
    if(!size)throw Object.assign(Error('视频文件为空'),{status:400});
    const job={id,kind:'analysis',name:basename(filename).slice(0,160),source,size,status:'queued',progress:0,message:'等待本机处理',createdAt:new Date().toISOString(),artifacts:[],revision:0};
    this.jobs.set(id,job);await this.persist(job);this.enqueue(()=>this.analyze(job));return this.publicJob(job);
  }
  async analyze(job) {
    const dir=join(this.jobRoot,job.id),input=join(dir,job.source);
    const update=async(progress,message)=>{job.status='running';job.progress=progress;job.message=message;await this.persist(job);};
    try {
      await update(5,'读取真实视频信息');
      const probe=await this.hypit(['media','probe',input]);
      if(!probe.hasVideo || !(probe.duration>0 && probe.duration<=300) || probe.width>4096 || probe.height>4096)throw Error('请使用 5 分钟以内、长边不超过 4096 像素的视频。');
      job.media={duration:probe.duration,width:probe.width,height:probe.height,frameRate:probe.frameRate,hasAudio:probe.hasAudio};
      await atomicJson(join(dir,'probe.json'),job.media);job.artifacts.push('probe.json');
      await update(15,'检测画面切换候选');
      const boundaries=await this.hypit(['media','boundaries',input,'--rate','2','--threshold','0.25']);
      job.boundaries=boundaries.candidates || [];await atomicJson(join(dir,'boundaries.json'),boundaries);job.artifacts.push('boundaries.json');
      await update(25,'提取带时间标记的关键帧');
      const times=Array.from({length:8},(_,i)=>Math.min(probe.duration-0.05,probe.duration*(i+.5)/8).toFixed(3));
      const extracted=await this.hypit(['media','frames',input,'--at',times.join(','),'--label-time','--to',join(dir,'frames')]);
      // Hypit returns the actual timestamp for each file. Lexical filename order puts
      // frame-11 before frame-1 and must never be used to assign source times.
      job.frames=extracted.frames.map(f=>({file:'frames/'+basename(f.path),time:f.at})).sort((a,b)=>a.time-b.time);
      job.artifacts.push(...job.frames.map(f=>f.file));
      await this.hypit(['media','tile',input,'--frames','12','--cell','240','--columns','3','--to',join(dir,'overview.jpg')]);job.artifacts.push('overview.jpg');
      if(!probe.hasAudio) {job.transcript={engine:'none',language:null,segments:[],reason:'原视频没有音轨，未生成台词。'};}
      else if((await this.health()).speechReady) {
        await update(40,'本地识别台词与时间，请稍候');
        const audio=join(dir,'voice.wav');
        await this.process(this.config.ffmpeg,['-hide_banner','-y','-i',input,'-map','0:a:0','-vn','-af','aresample=async=1:first_pts=0','-ac','1','-ar','16000','-c:a','pcm_s16le',audio]);
        await this.process(this.config.python,[join(this.root,'engine','transcribe.py'),audio,join(dir,'transcript.raw.json'),'--model',this.config.modelPath,'--language','zh'],{timeout:900000,onOutput:line=>{
          const match=line.match(/Transcribed ([\d.]+)s/);if(match){job.progress=Math.min(88,40+Math.round(Number(match[1])/probe.duration*48));job.message=`已转写 ${match[1]} / ${probe.duration.toFixed(1)} 秒`;}
        }});
        job.transcript=JSON.parse(await readFile(join(dir,'transcript.raw.json'),'utf8'));
        job.transcript.segments=job.transcript.segments.filter(s=>s.end>s.start && s.start>=0).map(s=>({...s,end:Math.min(s.end,probe.duration)}));
      } else { job.transcript={engine:'none',language:null,segments:[],reason:'本机转写模型未准备。画面拆解已完成。'}; }
      if(!existsSync(join(dir,'transcript.raw.json')))await atomicJson(join(dir,'transcript.raw.json'),job.transcript);
      await atomicJson(join(dir,'transcript.corrected.json'),job.transcript);job.artifacts.push('transcript.raw.json','transcript.corrected.json');
      await writeFile(join(dir,'subtitles.srt'),toSrt(job.transcript.segments),'utf8');job.artifacts.push('subtitles.srt');
      job.status='completed';job.progress=100;job.message=job.transcript.segments.length?'真实画面与台词已整理，请校正识别结果。':job.transcript.reason || '画面已整理，未识别到台词。';
      job.finishedAt=new Date().toISOString();await this.persist(job);
    } catch(error) {job.status='failed';job.progress=0;job.message='处理未完成。请核对文件或重新提交。';job.error=String(error.message).slice(-2000);await this.persist(job);}
  }
  async correct(id,edits) {
    const job=this.get(id);if(job.status!=='completed')throw Object.assign(Error('请等待视频拆解完成'),{status:409});
    if(['queued','running'].includes(job.export?.status))throw Object.assign(Error('导出进行中，请完成后再保存校正'),{status:409});
    if(this.saving.has(id))throw Object.assign(Error('校正正在保存，请稍后重试'),{status:409});
    this.saving.add(id);
    try {
    const dir=join(this.jobRoot,id),raw=JSON.parse(await readFile(join(dir,'transcript.raw.json'),'utf8'));
    const segments=validateCorrections(raw,edits,job.media.duration);
    job.transcript={...raw,segments};job.revision++;job.export=null;
    await atomicJson(join(dir,'transcript.corrected.json'),job.transcript);
    await writeFile(join(dir,'subtitles.srt'),toSrt(segments),'utf8');await this.persist(job);return this.publicJob(job);
    } finally {this.saving.delete(id);}
  }
  async export(id) {
    const job=this.get(id);if(job.status!=='completed')throw Object.assign(Error('请先完成视频拆解'),{status:409});
    if(this.saving.has(id))throw Object.assign(Error('请等台词校正保存完成后再合成'),{status:409});
    if(['queued','running'].includes(job.export?.status))return this.publicJob(job);
    job.export={status:'queued',progress:0,revision:job.revision,message:'等待合成字幕校对版'};await this.persist(job);
    this.enqueue(()=>this.render(job));return this.publicJob(job);
  }
  async render(job) {
    const dir=join(this.jobRoot,job.id),revision=job.revision,output=`captioned-r${revision}.mp4`;
    try {
      job.export.status='running';job.export.message='保留原画面与声音，合成校正字幕';await this.persist(job);
      const {width,height}=job.media;
      await writeFile(join(dir,'subtitles.ass'),toAss(job.transcript.segments,width,height),'utf8');
      const args=['-hide_banner','-y','-i',job.source,'-map','0:v:0','-map','0:a:0?'];
      const filters=['scale=trunc(iw/2)*2:trunc(ih/2)*2'];
      if(job.transcript.segments.some(s=>s.text.trim()))filters.push('ass=subtitles.ass');
      args.push('-vf',filters.join(','),'-c:v','libx264','-preset','veryfast','-crf','21','-threads','4','-pix_fmt','yuv420p','-c:a','aac','-b:a','128k','-movflags','+faststart','-t',String(job.media.duration),'-progress','pipe:1',output);
      await this.process(this.config.ffmpeg,args,{cwd:dir,timeout:600000,onOutput:line=>{
        const match=line.match(/out_time_us=(\d+)/);if(match)job.export.progress=Math.min(99,Math.round(Number(match[1])/1e6/job.media.duration*100));
      }});
      const verify=await this.hypit(['media','probe',join(dir,output)]);
      if(!verify.hasVideo || Math.abs(verify.duration-job.media.duration)>0.3 || (job.media.hasAudio && !verify.hasAudio))throw Error('合成文件时长或音轨验证失败');
      job.export={status:'completed',progress:100,revision,file:output,message:'字幕校对 MP4 已完成',duration:verify.duration,hasAudio:verify.hasAudio};
      if(!job.artifacts.includes(output))job.artifacts.push(output);await this.persist(job);
    } catch(error) {job.export.status='failed';job.export.message='MP4 合成未完成，可以重试。';job.export.error=String(error.message).slice(-2000);await this.persist(job);}
  }
  async artifact(id,name) {
    const job=this.get(id);if(!job.artifacts.includes(name))throw Object.assign(Error('文件不存在'),{status:404});
    const path=join(this.jobRoot,id,name),info=await stat(path);
    return {path,size:info.size,type:MIME[extname(name)] || 'application/octet-stream',name:basename(name)};
  }
  async waitIdle() { while(this.running || this.queue.length)await sleep(20); }
}
