import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { request } from 'node:http';
import { MediaEngine, MAX_UPLOAD } from '../engine/media-engine.mjs';
import { validateCorrections, toSrt, toAss } from '../engine/subtitles.mjs';
import { createWorkbenchServer } from '../server.mjs';

const raw={engine:'faster-whisper',segments:[{id:0,start:0.02,end:2.3,text:'原始文字',words:[{text:'原始',start:0.02,end:1}]}]};
const temp=async t=>{const root=await mkdtemp(join(tmpdir(),'zaopian-tests-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;};
async function savedJob(t){
  const root=await temp(t),engine=await new MediaEngine({root,config:{}}).initialize();
  const id='00000000-0000-0000-0000-000000000001',dir=join(engine.jobRoot,id);await mkdir(dir);
  const job={id,source:'input.mp4',status:'completed',revision:0,media:{duration:3,width:720,height:1280},transcript:structuredClone(raw),artifacts:['transcript.raw.json'],export:{status:'completed',file:'captioned-r0.mp4'}};
  engine.jobs.set(id,job);await writeFile(join(dir,'transcript.raw.json'),JSON.stringify(raw));await engine.persist(job);return {root,engine,id,dir};
}

test('correction keeps original times and clears alignment only for changed wording',()=>{
  const corrected=validateCorrections(raw,[{id:0,text:'人工校正',start:99,end:100}],3);
  assert.equal(corrected[0].start,0.02);assert.equal(corrected[0].end,2.3);assert.deepEqual(corrected[0].words,[]);
  assert.deepEqual(validateCorrections(raw,[{id:0,text:'原始文字'}],3)[0].words,raw.segments[0].words);
  assert.throws(()=>validateCorrections(raw,[],3));assert.throws(()=>validateCorrections(raw,[{id:2,text:'错误段'}],3));
});
test('subtitle output preserves millisecond times and rejects injected ASS overrides',()=>{
  assert.match(toSrt(raw.segments),/00:00:00,020 --> 00:00:02,300/);
  const ass=toAss([{...raw.segments[0],text:'中文{\\pos(0,0)}文字'}],720,1280);
  assert.ok(!ass.includes('{\\pos'));assert.ok(ass.includes('中文'));assert.ok(ass.includes('Microsoft YaHei'));
});
test('saved corrections preserve raw evidence and invalidate the old MP4',async t=>{
  const {engine,id,dir}=await savedJob(t),before=await readFile(join(dir,'transcript.raw.json'),'utf8');
  const updated=await engine.correct(id,[{id:0,text:'人工校正'}]);
  assert.equal(await readFile(join(dir,'transcript.raw.json'),'utf8'),before);
  assert.equal(updated.export,null);assert.equal(updated.revision,1);
  assert.match(await readFile(join(dir,'subtitles.srt'),'utf8'),/人工校正/);
  engine.get(id).export={status:'running'};
  await assert.rejects(engine.correct(id,[{id:0,text:'合成中修改'}]),/导出进行中/);
});
test('restart recovers completed evidence and marks unfinished jobs interrupted',async t=>{
  const {root,engine,id,dir}=await savedJob(t);
  engine.get(id).export={status:'running'};await engine.persist(engine.get(id));
  const restarted=await new MediaEngine({root,config:{}}).initialize();
  assert.equal(restarted.get(id).status,'completed');assert.equal(restarted.get(id).export.status,'interrupted');
  engine.get(id).status='running';await engine.persist(engine.get(id));
  const again=await new MediaEngine({root,config:{}}).initialize();assert.equal(again.get(id).status,'interrupted');
  assert.ok((await readFile(join(dir,'transcript.raw.json'),'utf8')).includes('原始文字'));
});
test('concurrent corrections and export cannot race an in-progress subtitle save',async t=>{
  const {engine,id}=await savedJob(t);
  const saving=engine.correct(id,[{id:0,text:'第一份校正'}]);
  await assert.rejects(engine.correct(id,[{id:0,text:'竞争校正'}]),/正在保存/);
  await assert.rejects(engine.export(id),/保存完成/);await saving;
  assert.equal(engine.get(id).revision,1);assert.equal(engine.get(id).transcript.segments[0].text,'第一份校正');
});
test('uploads reject excessive size, foreign file types and unavailable tools',async t=>{
  const root=await temp(t),engine=await new MediaEngine({root,config:{}}).initialize();
  const upload=(name,bytes)=>{const body=Readable.from([Buffer.from('video')]);body.headers={'content-length':bytes};return engine.upload(body,name);};
  await assert.rejects(upload('video.mp4',5),/尚未准备/);
  engine.health=async()=>({mediaReady:true});
  await assert.rejects(upload('tool.exe',5),/仅支持/);await assert.rejects(upload('video.mp4',MAX_UPLOAD+1),/100 MB/);
});
test('frame evidence uses Hypit timestamps even when returned filenames are unsorted',async t=>{
  const root=await temp(t),engine=await new MediaEngine({root,config:{}}).initialize();
  const id='00000000-0000-0000-0000-000000000002',dir=join(engine.jobRoot,id);await mkdir(dir);
  const job={id,source:'input.mp4',artifacts:[]};engine.jobs.set(id,job);
  engine.hypit=async args=>{
    if(args[1]==='probe')return {hasVideo:true,duration:20,width:720,height:1280,frameRate:24,hasAudio:false};
    if(args[1]==='boundaries')return {candidates:[]};
    if(args[1]==='frames')return {frames:[{at:11.25,path:join(dir,'frames','frame-11_250s.jpg')},{at:1.25,path:join(dir,'frames','frame-1_250s.jpg')}]};
    return {};
  };
  await engine.analyze(job);assert.equal(job.status,'completed');
  assert.deepEqual(job.frames,[{file:'frames/frame-1_250s.jpg',time:1.25},{file:'frames/frame-11_250s.jpg',time:11.25}]);
  assert.equal(job.transcript.segments.length,0);assert.match(job.transcript.reason,/没有音轨/);
});
test('local API limits origin and Host, requires session token, and hides private files',async t=>{
  const root=await temp(t);await writeFile(join(root,'index.html'),'<h1>Local</h1>');
  const engine={health:async()=>({engine:'Hypit',ready:true})};
  const {server}=await createWorkbenchServer({engine,projectRoot:root});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port;
  assert.equal((await fetch(base+'/api/engine')).status,401);
  assert.equal((await fetch(base+'/api/session')).status,403);
  assert.equal((await fetch(base+'/api/session',{headers:{'X-Zaopian-Client':'workbench',Origin:'https://foreign.example'}})).status,403);
  const rebound=await new Promise((resolve,reject)=>{const req=request(base+'/',{headers:{Host:'foreign.example'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end();});
  assert.equal(rebound,403);
  const origin='https://ai-video-v3-simon-workbench.simon000888.chatgpt.site';
  const connected=await fetch(base+'/api/session',{headers:{'X-Zaopian-Client':'workbench',Origin:origin}});
  assert.equal(connected.headers.get('access-control-allow-origin'),origin);
  const session=await connected.json();assert.equal((await fetch(base+'/api/engine',{headers:{Authorization:'Bearer '+session.token}})).status,200);
  assert.equal((await fetch(base+'/.local/engine.json')).status,404);
  assert.equal((await fetch(base+'/engine/transcribe.py')).status,404);
  assert.equal((await fetch(base+'/runtime/package.json')).status,404);
});
test('JSON correction requests preserve Chinese split across network chunks',async t=>{
  const root=await temp(t);let received;
  const engine={health:async()=>({engine:'Hypit'}),correct:async(id,segments)=>{received=segments;return {ok:true};}};
  const {server}=await createWorkbenchServer({engine,projectRoot:root});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const port=server.address().port,base='http://127.0.0.1:'+port;
  const {token}=await (await fetch(base+'/api/session',{headers:{'X-Zaopian-Client':'workbench'}})).json();
  const bytes=Buffer.from(JSON.stringify({segments:[{id:0,text:'中文校正'}]}));
  const firstChinese=bytes.indexOf(Buffer.from('中'));
  const status=await new Promise((resolve,reject)=>{
    const req=request(base+'/api/jobs/00000000-0000-0000-0000-000000000001/transcript',{method:'PATCH',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});
    req.on('error',reject);req.write(bytes.subarray(0,firstChinese+1));
    setTimeout(()=>req.end(bytes.subarray(firstChinese+1)),15);
  });
  assert.equal(status,200);assert.equal(received[0].text,'中文校正');
});
