import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { workspaceApi } from '../web/workspace-api.mjs';
import { projectData } from '../web/project-data.mjs';
const draft=()=>({step:0,product:null,reference:null,analysis:null,script:null,shots:null,tasks:[],settings:{platform:'抖音',tone:'朋友分享',duration:'30',audience:''},custom:[]});
function db(){const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../drizzle/0000_wonderful_tattoo.sql',import.meta.url),'utf8'));return {prepare(query){return {bind(...args){return {async first(){return sql.prepare(query).get(...args) || null;}};}};}};}
const request=(state,revision=0,headers={})=>new Request('https://workbench.example/api/workspace',{method:'PUT',headers:{'content-type':'application/json',...headers},body:JSON.stringify({state,revision})});
test('new browser reads saved project; stale device cannot overwrite a newer revision',async()=>{
  const env={DB:db()},first=draft();first.observation='电脑 A 的文字';
  assert.equal((await workspaceApi(request(first),env)).status,200);
  const restored=await(await workspaceApi(new Request('https://workbench.example/api/workspace'),env)).json();assert.equal(restored.state.observation,'电脑 A 的文字');assert.equal(restored.revision,1);
  const second={...restored.state,observation:'电脑 B 修改'};assert.equal((await workspaceApi(request(second,1),env)).status,200);
  const conflict=await workspaceApi(request(first,1),env);assert.equal(conflict.status,409);assert.equal((await conflict.json()).state.observation,'电脑 B 修改');
});
test('workspace accepts text evidence but rejects media bytes, asset URLs and unknown fields',async()=>{
  const env={DB:db()};
  for(const mutation of [s=>s.video='base64',s=>s.observation='data:video/mp4;base64,AAA',s=>s.reference={kind:'local',name:'x',frames:['blob:secret']},s=>s.reference={kind:'link',url:'blob:secret'}]){const state=draft();mutation(state);assert.equal((await workspaceApi(request(state),env)).status,400);}
  const response=await workspaceApi(new Request('https://workbench.example/api/workspace',{method:'PUT',headers:{'content-type':'application/octet-stream'},body:new Uint8Array([1,2,3])}),env);assert.equal(response.status,415);
  const large=request({...draft(),observation:'x'.repeat(600000)});assert.equal((await workspaceApi(large,env)).status,413);
});
test('cross-origin saves are rejected and API is unavailable without its database',async()=>{
  assert.equal((await workspaceApi(request(draft(),0,{origin:'https://foreign.example'}),{DB:db()})).status,403);
  assert.equal((await workspaceApi(new Request('https://workbench.example/api/workspace'),{})).status,503);
});
test('client whitelist removes transient native paths and keeps Chinese corrected text',()=>{
  const clean=projectData({...draft(),binary:new Uint8Array([1,2]),reference:{kind:'local',name:'原片.mp4',localPath:'C:/private/file',evidence:{id:'browser-id',revision:1,media:{duration:20,width:720,height:1280,hasAudio:true,frameRate:24},frameTimes:[1,2],boundaries:[{at:3,score:32}],raw:{segments:[{id:0,start:0,end:2,text:'原识别文字',words:[{start:0,word:'secret'}]}]},transcript:{segments:[{id:0,start:0,end:2,text:'校正后的文字',corrected:true}]}}}});
  assert.equal(clean.binary,undefined);assert.equal(clean.reference.localPath,undefined);assert.equal(clean.reference.evidence.raw.segments[0].words,undefined);assert.equal(clean.reference.evidence.transcript.segments[0].text,'校正后的文字');
});
