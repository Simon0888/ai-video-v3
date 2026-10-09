import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, basename, join } from 'node:path';
import assert from 'node:assert/strict';

const [input,output]=process.argv.slice(2);
if(!input || !output)throw Error('Usage: node tools/verify-local.mjs <video> <output directory>');
const base='http://127.0.0.1:4173';
const session=await (await fetch(base+'/api/session',{headers:{'X-Zaopian-Client':'workbench'}})).json();
assert.equal(session.ready,true);
const headers={Authorization:'Bearer '+session.token};
const file=await readFile(resolve(input));
const response=await fetch(base+'/api/jobs',{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(basename(input))},body:file});
assert.equal(response.status,202);let job=await response.json();
const started=Date.now();let last='';
async function poll(exporting=false){
  while(true){job=await (await fetch(base+'/api/jobs/'+job.id,{headers})).json();const phase=exporting?job.export:job;
    if(phase.message!==last){console.log(phase.message);last=phase.message;}
    if(['failed','interrupted'].includes(phase.status))throw Error(phase.error || phase.message);
    if(phase.status==='completed')return;
    assert.ok(Date.now()-started<900000,'Real processing timed out');await new Promise(resolve=>setTimeout(resolve,800));
  }
}
await poll();assert.equal(job.frames.length,8);assert.ok(job.transcript.segments.length>0);
assert.ok(job.frames.every((frame,i)=>!i || frame.time>job.frames[i-1].time));
for(const frame of job.frames){const match=frame.file.match(/frame-(\d+)_(\d+)s/);assert.ok(match);assert.equal(frame.time,Number(match[1]+'.'+match[2]));}
const original=await (await fetch(base+`/api/jobs/${job.id}/files/transcript.raw.json`,{headers})).text();
const corrections=job.transcript.segments.map(s=>({id:s.id,text:s.text}));corrections[0].text='人工校对：'+corrections[0].text;
const corrected=await fetch(base+`/api/jobs/${job.id}/transcript`,{method:'PATCH',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({segments:corrections})});assert.equal(corrected.status,200);job=await corrected.json();
assert.equal(await (await fetch(base+`/api/jobs/${job.id}/files/transcript.raw.json`,{headers})).text(),original);
assert.equal(job.transcript.segments[0].words.length,0);
assert.equal((await fetch(base+`/api/jobs/${job.id}/export`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{}'})).status,202);await poll(true);
await mkdir(resolve(output),{recursive:true});
for(const name of ['overview.jpg','transcript.raw.json','transcript.corrected.json','subtitles.srt',job.export.file]){
  const bytes=Buffer.from(await (await fetch(base+`/api/jobs/${job.id}/files/${name}`,{headers})).arrayBuffer());assert.ok(bytes.length>0);await writeFile(join(resolve(output),name),bytes);
}
const evidence={jobId:job.id,input:basename(input),duration:job.media.duration,frames:job.frames.length,cutCandidates:job.boundaries.length,segments:job.transcript.segments.length,rawPreserved:true,output:job.export,elapsedSeconds:(Date.now()-started)/1000};
await writeFile(join(resolve(output),'api-verification.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
