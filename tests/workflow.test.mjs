import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// These checks exercise the application's state and event handlers without a browser.
// They do not verify video codecs, playback, accessibility or visual layout.
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const engineSource=readFileSync(new URL('../engine-ui.js',import.meta.url),'utf8');
function app(initialStorage){
  const events={}, nodes={}, storage=new Map(initialStorage?[['zaopian-v1',initialStorage]]:[]), downloads=[], tools=[];
  const node=id=>nodes[id]??=({innerHTML:'',textContent:'',style:{},classList:{add(){},remove(){}},showModal(){},close(){}});
  const context=vm.createContext({console,URL,Blob,structuredClone,Date,setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},FormData:class{constructor(form){this.values=form.values;}get(k){return this.values[k];}*[Symbol.iterator](){yield*Object.entries(this.values);}},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},document:{querySelector:node,addEventListener:(name,fn)=>events[name]=fn,modelContext:{registerTool:t=>tools.push(t)},body:{append(){}},createElement:()=>({click(){downloads.push({href:this.href,name:this.download});},remove(){}})}});
  vm.runInContext(source,context);
  return {context,events,nodes,tools,downloads,storage,run:code=>vm.runInContext(code,context),state:()=>JSON.parse(vm.runInContext('JSON.stringify(state)',context))};
}
function complete(a){a.run("setProduct('cup'); setReference({kind:'demo',name:'示例',description:'示例结构'}); analyze(); makeScript(); makeShots(); createTask();");}
function withEngine(a){a.context.ZaopianEngineClient=class{clearAssets(){}};a.run(engineSource);return a;}
test('failed browser re-analysis preserves already edited script, shots and task',async()=>{
  const a=withEngine(app());complete(a);a.run("state.scriptOrigin='reference';state.reference={kind:'local',name:'原片.mp4'};videoFile={name:'原片.mp4'};localEngine.upload=async()=>({id:'failed-analysis',status:'failed',message:'下载失败'});localEngine.job=localEngine.upload;");
  const before=a.state();await a.run('startLocalAnalysis()');
  const after=a.state();assert.deepEqual(after.script,before.script);assert.deepEqual(after.shots,before.shots);assert.deepEqual(after.tasks,before.tasks);
});
test('actual transcript imports all seven segments and retains editable timeline through shots',()=>{
  const a=withEngine(app());a.run("setProduct('cup'); setReference({kind:'local',name:'视频'}); mediaView.job={media:{duration:20},transcript:{segments:Array.from({length:7},(_,i)=>({id:i,start:i*2,end:i*2+1,text:'实际台词 '+i}))}}; useLocalTranscript(); makeShots();");
  const s=a.state();assert.equal(s.scriptOrigin,'reference');assert.equal(s.script.length,7);assert.equal(s.shots.length,7);
  assert.equal(s.shots[6].text,'实际台词 6');assert.ok(s.shots[6].visual);assert.equal(s.settings.duration,'20');
});
test('editing actual transcript invalidates derived production drafts and hides the old MP4',()=>{
  const a=withEngine(app());a.run("setProduct('cup'); setReference({kind:'local',name:'视频'}); mediaView.job={revision:1,media:{duration:20},transcript:{segments:[{id:0,start:0,end:2,text:'实际台词'}]}}; useLocalTranscript(); makeShots(); createTask();");
  let hidden=false;const lookup=a.context.document.querySelector;
  a.context.document.querySelector=selector=>selector.startsWith('video[')?{pause(){},set hidden(value){hidden=value;}}:lookup(selector);
  a.context.document.querySelectorAll=()=>[];
  a.events.input({target:{dataset:{transcript:'0'},value:'重新校正'}});
  const s=a.state();assert.equal(s.analysis,null);assert.equal(s.script,null);assert.equal(s.shots,null);assert.equal(s.tasks.length,0);
  assert.equal(s.reference.transcriptDraft.segments[0].text,'重新校正');assert.equal(hidden,true);
});
test('six-step workflow creates linked script, shots and task',()=>{const a=app();complete(a);const s=a.state();assert.equal(s.product.id,'cup');assert.equal(s.analysis.length,4);assert.equal(s.script.length,4);assert.equal(s.shots.length,4);assert.equal(s.tasks[0].status,'ready');assert.equal(s.shots[0].text,s.script[0].text);});
test('changing product invalidates dependent production results',()=>{const a=app();complete(a);a.run("setProduct('lamp')");const s=a.state();assert.equal(s.product.id,'lamp');assert.equal(s.analysis,null);assert.equal(s.script,null);assert.equal(s.shots,null);assert.equal(s.tasks.length,0);assert.equal(s.reference.kind,'demo');});
test('editing script invalidates shots and task, regeneration uses edited copy',()=>{const a=app();complete(a);a.events.input({target:{dataset:{script:'0'},value:'这是用户修改的真实口播'}});assert.equal(a.state().shots,null);assert.equal(a.state().tasks.length,0);a.run('makeShots()');assert.equal(a.state().shots[0].text,'这是用户修改的真实口播');});
test('editing shot invalidates exported task and retains new description',()=>{const a=app();complete(a);a.events.input({target:{dataset:{shot:'1',key:'visual'},value:'用户新增的通勤画面'}});assert.equal(a.state().shots[1].visual,'用户新增的通勤画面');assert.equal(a.state().tasks.length,0);});
test('15-second setting changes script timeline and task specification',()=>{const a=app();complete(a);a.events.change({target:{dataset:{setting:'duration'},value:'15'}});assert.equal(a.state().script,null);a.run('makeScript(); makeShots(); createTask()');assert.equal(a.state().shots[3].time,'12–15s');assert.equal(a.state().settings.duration,'15');});
test('persisted draft restores user edits across app initialization',()=>{const a=app();complete(a);a.events.input({target:{dataset:{script:'0'},value:'保留这条口播'}});const b=app(a.storage.get('zaopian-v1'));assert.equal(b.state().script[0].text,'保留这条口播');assert.equal(b.state().product.id,'cup');});
test('invalid link reports error and does not alter current reference',()=>{const a=app();complete(a);a.events.submit({preventDefault(){},target:{id:'url-form',values:{url:'javascript:alert(1)'}}});assert.match(a.nodes['#url-error'].textContent,/http/);assert.equal(a.state().reference.kind,'demo');});
test('valid share text stores link without claiming download',()=>{const a=app();a.run("setProduct('cup')");a.events.submit({preventDefault(){},target:{id:'url-form',values:{url:'看看这个 https://www.douyin.com/video/123 分享'}}});assert.equal(a.state().reference.url,'https://www.douyin.com/video/123');assert.match(a.state().reference.description,/未下载/);});
test('new custom product is isolated and selected',()=>{const a=app();a.events.submit({preventDefault(){},target:{id:'product-form',values:{name:'测试商品',price:'29.90',commission:'20',category:'家居日用',points:'便携、耐用',audience:'学生'}}});assert.equal(a.state().custom.length,1);assert.equal(a.state().product.name,'测试商品');assert.equal(a.state().product.price,29.9);});
test('export emits TXT, CSV and JSON downloads for the current task',()=>{const a=app();complete(a);a.run("exportFile('script');exportFile('shots');exportFile('project')");assert.equal(a.downloads.length,3);assert.ok(a.downloads[0].name.endsWith('.txt'));assert.ok(a.downloads[1].name.endsWith('.csv'));assert.ok(a.downloads[2].name.endsWith('.json'));});
test('WebMCP navigation validates inputs and shares the same visible state',()=>{const a=app();assert.equal(a.tools.length,2);assert.throws(()=>a.tools[1].execute({step:9}));assert.equal(a.state().step,0);const result=a.tools[1].execute({step:2});assert.equal(result.step,'AI拆解');assert.equal(a.state().step,2);assert.match(a.nodes['#app'].innerHTML,/先为项目选择一个商品/);});
test('untrusted product and script text is escaped in generated UI',()=>{const a=app();complete(a);a.run("state.product.name='<img src=x onerror=alert(1)>';state.step=3;render()");assert.ok(!a.nodes['#app'].innerHTML.includes('<img src=x'));assert.match(a.nodes['#app'].innerHTML,/&lt;img/);});

test('recorded WebM gets duration metadata while encoded media stays unchanged',async()=>{
  // Header captured from a real Chromium Canvas/MediaRecorder recording.
  const bytes=Buffer.from('1a45dfa39f4286810142f7810142f2810442f381084282847765626d42878104428581021853806701ffffffffffffff1549a966992ad7b1830f42404d80864368726f6d655741864368726f6d651654ae6bbeaebcd7810173c587f631721c10b33d83810155ee81018685565f565039e09fb08202d0ba82050053c0810155b09055b1810155b9810255ba810d55bb81011f43b67501ffffffffffffffe78100a0654ba163db8100000082498342502cf04ff66638241c19921003a85f5bf87f17fd7fe2eb6bedbf','hex');
  const a=app();a.context.recording=new Blob([bytes],{type:'video/webm;codecs=vp9'});
  const fixed=await a.run('withWebmDuration(recording,15000)');
  const output=Buffer.from(await fixed.arrayBuffer());
  assert.equal(fixed.type,'video/webm;codecs=vp9');
  assert.equal(output.length,bytes.length+11);
  const durationOffset=output.indexOf(Buffer.from('448988','hex'));
  assert.ok(durationOffset>0);
  assert.equal(output.readDoubleBE(durationOffset+3),15000);
  const tracks=Buffer.from('1654ae6b','hex');
  assert.deepEqual(output.subarray(output.indexOf(tracks)),bytes.subarray(bytes.indexOf(tracks)));
  a.context.recording=fixed;
  const again=await a.run('withWebmDuration(recording,30000)');
  const rewritten=Buffer.from(await again.arrayBuffer());
  assert.equal(rewritten.length,output.length);
  assert.equal(rewritten.readDoubleBE(durationOffset+3),30000);
});

test('upload reads finite duration after seeking a streaming WebM and releases the probe',async()=>{
  const a=app();let released=false,loaded=false;
  const probe={duration:Infinity,removeAttribute(name){released=name==='src';},load(){loaded=true;}};
  a.context.document.createElement=()=>probe;
  const pending=a.run("readVideoDuration('blob:recording')");
  probe.onloadedmetadata();
  assert.equal(probe.currentTime,1e10);
  probe.duration=14.977;probe.ondurationchange();
  assert.equal(await pending,14.977);
  assert.equal(released,true);assert.equal(loaded,true);
  assert.equal(probe.onerror,null);
});
