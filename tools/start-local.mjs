// Desktop launcher: keep native processing local, run the service in the background.
import { readFile, mkdir, open, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const base='http://127.0.0.1:4173';
const health=async()=>{try{const res=await fetch(base+'/api/session',{headers:{'X-Zaopian-Client':'workbench'},signal:AbortSignal.timeout(1500)});return res.ok && (await res.json()).engine==='Hypit';}catch{return false;}};
async function main(){
  if(!await health()){
    const config=JSON.parse((await readFile(join(root,'.local','engine.json'),'utf8')).replace(/^\uFEFF/,''));
    await mkdir(join(root,'.local'),{recursive:true});
    const log=await open(join(root,'.local','service.log'),'a');
    const child=spawn(config.node || process.execPath,[join(root,'server.mjs')],{cwd:root,detached:true,windowsHide:true,stdio:['ignore',log.fd,log.fd]});
    child.unref();await log.close();
    await writeFile(join(root,'.local','service.pid'),String(child.pid));
    let ready=false;
    for(let i=0;i<30;i++){if(await health()){ready=true;break;}await new Promise(resolve=>setTimeout(resolve,500));}
    if(!ready)throw Error('Local service did not start. Check .local/service.log or whether port 4173 is occupied.');
  }
  if(!process.argv.includes('--no-open')){
    const openBrowser=process.platform==='win32'
      ?spawn('rundll32.exe',['url.dll,FileProtocolHandler',base],{windowsHide:true,detached:true,stdio:'ignore'})
      :spawn(process.platform==='darwin'?'open':'xdg-open',[base],{detached:true,stdio:'ignore'});
    openBrowser.unref();
  }
  console.log('Zaopian local processing is ready: '+base);
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});

