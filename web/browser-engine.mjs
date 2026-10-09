import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';
import { validateCorrections, toSrt, toAss } from '../engine/subtitles.mjs';
const CORE='https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';
const FONT='https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@Sans2.004/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf';
const copy=value=>structuredClone(value);
const waitEvent=(target,name,timeout=20000)=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>finish(Error('浏览器无法读取这个视频画面')),timeout);
  const finish=error=>{clearTimeout(timer);target.removeEventListener(name,ok);target.removeEventListener('error',fail);error?reject(error):resolve();};
  const ok=()=>finish(),fail=()=>finish(Error('浏览器不支持此视频编码，请改用可播放的 MP4'));
  target.addEventListener(name,ok,{once:true});target.addEventListener('error',fail,{once:true});
});
const jpeg=canvas=>new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.82));
export async function fingerprint(file){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('');}
export class BrowserMediaEngine {
  constructor(){this.jobs=new Map();this.ffmpeg=null;this.asr=null;this.busy=false;this.generation=0;this.cancelSpeech=null;}
  current(j){return j.generation===this.generation && this.jobs.has(j.id);}
  check(j){if(!this.current(j))throw Error('处理已取消');}
  async connect(){return {mediaReady:true,message:'视频处理在当前浏览器进行，素材不上传。首次拆解会下载工具和语音模型。'};}
  snapshot(id){const j=this.jobs.get(id);if(!j || j.status!=='completed')return null;return {id:j.id,revision:j.revision,media:copy(j.media),boundaries:copy(j.boundaries),frameTimes:j.frames.map(f=>f.time),raw:copy(j.raw),transcript:copy(j.transcript)};}
  restore(snapshot,file=null){if(!snapshot)return null;const j={...copy(snapshot),status:'completed',progress:100,message:file?'原文件已重新关联':'文字拆解记录已恢复；画面与导出需要重新选择原文件',frames:snapshot.frameTimes.map((time,i)=>({time,file:`frame-${i}.jpg`})),file,generation:this.generation,artifacts:new Map(),export:null};this.jobs.set(j.id,j);this.textArtifacts(j);return copy(this.publicJob(j));}
  publicJob(j){const {file,artifacts,raw,generation,...data}=j;return data;}
  async job(id){const j=this.jobs.get(id);if(!j)throw Error('请重新选择并拆解视频');return copy(this.publicJob(j));}
  async attach(id,file){const j=this.jobs.get(id);if(!j)return;j.file=file;await this.frames(j);j.message='原文件与已保存台词已关联';}
  async upload(file){if(this.busy)throw Error('请等待浏览器当前任务完成');const j={id:crypto.randomUUID(),status:'queued',progress:0,message:'准备浏览器内拆解…',revision:0,file,generation:this.generation,artifacts:new Map(),frames:[],boundaries:[],export:null};this.jobs.set(j.id,j);this.analyze(j);return copy(this.publicJob(j));}
  async tools(j){
    this.check(j);if(this.ffmpeg?.loaded)return this.ffmpeg;j.message='正在下载浏览器处理工具（约 31 MB，不包含你的素材）…';
    const ffmpeg=new FFmpeg();const urls=await Promise.all([toBlobURL(CORE+'/ffmpeg-core.js','text/javascript'),toBlobURL(CORE+'/ffmpeg-core.wasm','application/wasm')]);
    try{this.check(j);await ffmpeg.load({classWorkerURL:'/media/ffmpeg-worker.js',coreURL:urls[0],wasmURL:urls[1]});if(!this.current(j)){ffmpeg.terminate();throw Error('处理已取消');}this.ffmpeg=ffmpeg;return ffmpeg;}finally{urls.forEach(url=>URL.revokeObjectURL(url));}
  }
  async frames(j){
    const url=URL.createObjectURL(j.file),video=document.createElement('video');video.muted=true;video.preload='auto';
    try{
      const loaded=waitEvent(video,'loadeddata');video.src=url;await loaded;
      const duration=video.duration;if(!Number.isFinite(duration)||duration<=0||duration>300)throw Error('浏览器拆解支持 5 分钟以内的视频');
      if(Math.max(video.videoWidth,video.videoHeight)>4096)throw Error('视频长边不能超过 4096 像素');
      j.media ||= {duration,width:video.videoWidth,height:video.videoHeight,frameRate:'待读取',hasAudio:false};
      const frame=document.createElement('canvas');frame.width=Math.min(384,video.videoWidth);frame.height=Math.round(frame.width*video.videoHeight/video.videoWidth);const ctx=frame.getContext('2d',{willReadFrequently:true});
      const overview=document.createElement('canvas');overview.width=frame.width*4;overview.height=frame.height*3;const grid=overview.getContext('2d');
      const seek=async time=>{this.check(j);if(Math.abs(video.currentTime-time)>.001){const event=waitEvent(video,'seeked');video.currentTime=time;await event;}this.check(j);ctx.drawImage(video,0,0,frame.width,frame.height);};
      for(let i=0;i<12;i++){await seek(Math.min(duration-.04,(i+.5)*duration/12));grid.drawImage(frame,(i%4)*frame.width,Math.floor(i/4)*frame.height);}
      j.artifacts.set('overview.jpg',await jpeg(overview));j.frames=[];
      const frameTimes=j.frameTimes || Array.from({length:8},(_,i)=>Math.min(duration-.04,(i+.5)*duration/8));
      for(let i=0;i<frameTimes.length;i++){await seek(frameTimes[i]);const name=`frame-${i}.jpg`;j.frames.push({time:frameTimes[i],file:name});j.artifacts.set(name,await jpeg(frame));}
      // Coarse image-change candidates; this is not semantic video understanding.
      if(!j.frameTimes){const tiny=document.createElement('canvas');tiny.width=32;tiny.height=32;const tc=tiny.getContext('2d',{willReadFrequently:true});let previous=null;
        for(let t=0;t<duration-.04;t+=1){await seek(t);tc.drawImage(frame,0,0,32,32);const pixels=tc.getImageData(0,0,32,32).data;if(previous){let delta=0;for(let p=0;p<pixels.length;p+=4)delta+=(Math.abs(pixels[p]-previous[p])+Math.abs(pixels[p+1]-previous[p+1])+Math.abs(pixels[p+2]-previous[p+2]))/3;const score=delta/1024;if(score>24)j.boundaries.push({at:t,score:Math.round(score*100)/100});}previous=pixels;j.progress=Math.round(5+20*t/duration);}
      }
    }finally{video.removeAttribute('src');video.load();URL.revokeObjectURL(url);}
  }
  async transcribe(audio,j){
    this.asr ||= new Worker('/media/asr-worker.js',{type:'module'});
    return new Promise((resolve,reject)=>{this.cancelSpeech=()=>reject(Error('处理已取消'));this.asr.onmessage=({data})=>{if(data.type==='progress')j.message=data.message;if(data.type==='result'){this.cancelSpeech=null;resolve(data.result);}if(data.type==='error'){this.cancelSpeech=null;reject(Error(data.message));}};this.asr.onerror=()=>{this.asr?.terminate();this.asr=null;reject(Error('浏览器语音模型运行失败'));};this.asr.postMessage({audio},[audio.buffer]);});
  }
  async analyze(j){
    this.busy=true;j.status='running';
    try{
      j.message='正在浏览器内抽取实际画面…';await this.frames(j);const ffmpeg=await this.tools(j);const name='input.'+j.file.name.split('.').pop().toLowerCase();
      await ffmpeg.writeFile(name,new Uint8Array(await j.file.arrayBuffer()));const logs=[];const capture=({message})=>logs.push(message);ffmpeg.on('log',capture);
      j.progress=30;j.message='正在浏览器内提取音轨…';const code=await ffmpeg.exec(['-i',name,'-vn','-ac','1','-ar','16000','-f','f32le','audio.pcm']);ffmpeg.off('log',capture);
      const info=logs.join('\n');j.media.hasAudio=/Audio:/.test(info);const fps=info.match(/([\d.]+) fps/);j.media.frameRate=fps?Number(fps[1]):'由源文件保留';let result={chunks:[]};
      if(j.media.hasAudio){if(code!==0)throw Error('浏览器无法提取此音轨');j.progress=45;const bytes=await ffmpeg.readFile('audio.pcm');const audio=new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));result=await this.transcribe(audio,j);await ffmpeg.deleteFile('audio.pcm');}
      const segments=(result.chunks || []).flatMap((chunk,i)=>{const start=Math.max(0,Number(chunk.timestamp?.[0])||0),end=Math.min(j.media.duration,chunk.timestamp?.[1]??j.media.duration),text=chunk.text?.trim();return text&&end>start?[{id:i,start:Math.round(start*100)/100,end:Math.round(end*100)/100,text}]:[];});
      j.raw={engine:'Transformers.js / browser WASM',model:'onnx-community/whisper-tiny (q8)',language:'zh',segments,reason:segments.length?'':j.media.hasAudio?'没有识别到可用台词，请核对音轨':'视频没有音轨，可继续编辑脚本'};
      j.transcript=copy(j.raw);this.textArtifacts(j);await ffmpeg.deleteFile(name);this.check(j);j.status='completed';j.progress=100;j.message='浏览器内拆解完成，识别台词需要人工核对';
    }catch(error){j.status='failed';j.message='浏览器处理未完成：'+error.message;if(this.current(j)){this.ffmpeg?.terminate();this.ffmpeg=null;}}finally{if(this.current(j))this.busy=false;}
  }
  textArtifacts(j){j.artifacts.set('transcript.raw.json',new Blob([JSON.stringify(j.raw,null,2)],{type:'application/json'}));j.artifacts.set('transcript.corrected.json',new Blob([JSON.stringify(j.transcript,null,2)],{type:'application/json'}));j.artifacts.set('subtitles.srt',new Blob([toSrt(j.transcript.segments)],{type:'text/plain;charset=utf-8'}));}
  async correct(id,edits){const j=this.jobs.get(id);if(!j||this.busy)throw Error('请等待当前任务完成');j.transcript={...j.raw,segments:validateCorrections(j.raw,edits,j.media.duration)};j.revision++;j.export=null;j.artifacts.delete('captioned.mp4');this.textArtifacts(j);return this.job(id);}
  async export(id){const j=this.jobs.get(id);if(!j?.file)throw Error('请先重新选择原视频文件');if(this.busy)throw Error('请等待当前浏览器任务完成');j.export={status:'queued',progress:0,message:'准备在浏览器内合成字幕…'};this.renderMp4(j);return this.job(id);}
  async renderMp4(j){
    this.busy=true;
    try{
      j.export.status='running';const ffmpeg=await this.tools(j);j.export.message='正在下载字幕字体，素材仍留在浏览器…';
      const response=await fetch(FONT);if(!response.ok)throw Error('字幕字体下载失败');const font=new Uint8Array(await response.arrayBuffer());this.check(j);
      await ffmpeg.createDir('fonts').catch(()=>{});await ffmpeg.writeFile('fonts/NotoSansCJKsc-Regular.otf',font);
      await ffmpeg.writeFile('captions.ass',new TextEncoder().encode(toAss(j.transcript.segments,j.media.width,j.media.height).replace('Microsoft YaHei','Noto Sans CJK SC')));
      const name='original.'+j.file.name.split('.').pop().toLowerCase();await ffmpeg.writeFile(name,new Uint8Array(await j.file.arrayBuffer()));j.export.message='正在本浏览器合成 MP4，请保持页面打开…';
      const progress=({time})=>{j.export.progress=Math.min(99,Math.round(time/1e6/j.media.duration*100));};ffmpeg.on('progress',progress);
      const code=await ffmpeg.exec(['-i',name,'-map','0:v:0','-map','0:a?','-vf','ass=captions.ass:fontsdir=fonts','-c:v','libx264','-preset','ultrafast','-crf','23','-pix_fmt','yuv420p','-c:a','aac','-b:a','128k','-movflags','+faststart','captioned.mp4']);ffmpeg.off('progress',progress);
      if(code!==0)throw Error('浏览器 MP4 合成失败');const data=await ffmpeg.readFile('captioned.mp4');j.artifacts.set('captioned.mp4',new Blob([data],{type:'video/mp4'}));
      await Promise.all(['captioned.mp4',name,'captions.ass'].map(f=>ffmpeg.deleteFile(f)));j.export={status:'completed',progress:100,message:'字幕校对 MP4 已在当前浏览器生成',file:'captioned.mp4'};
    }catch(error){j.export={status:'failed',progress:0,message:error.message};if(this.current(j)){this.ffmpeg?.terminate();this.ffmpeg=null;}}finally{if(this.current(j))this.busy=false;}
  }
  async blob(id,file){const blob=this.jobs.get(id)?.artifacts.get(file);if(!blob)throw Error('请重新选择原文件以恢复画面；导出视频需要重新生成');return blob;}
  clear(){this.generation++;this.cancelSpeech?.();this.cancelSpeech=null;this.ffmpeg?.terminate();this.ffmpeg=null;this.asr?.terminate();this.asr=null;this.jobs.clear();this.busy=false;}
}
