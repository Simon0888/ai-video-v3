import { mkdirSync, copyFileSync, readFileSync, writeFileSync, readdirSync, rmSync, cpSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { build } from 'esbuild';
const root=resolve('.'),dist=resolve(root,'dist');
if(relative(root,dist)!=='dist')throw Error('Invalid build directory');
rmSync(dist,{recursive:true,force:true});mkdirSync('dist/client/media',{recursive:true});mkdirSync('dist/server',{recursive:true});
for(const file of ['index.html','style.css','app.js','engine-client.js','engine-ui.js'])copyFileSync(file,`dist/client/${file}`);
await build({entryPoints:['web/browser-engine.mjs'],outfile:'dist/client/media/browser-engine.js',bundle:true,format:'esm',platform:'browser',minify:true});
await build({entryPoints:['node_modules/@ffmpeg/ffmpeg/dist/esm/worker.js'],outfile:'dist/client/media/ffmpeg-worker.js',bundle:true,format:'esm',platform:'browser',minify:true});
await build({entryPoints:['web/asr-worker.mjs'],outfile:'dist/client/media/asr-worker.js',bundle:true,format:'esm',platform:'browser',minify:true});
await build({entryPoints:['web/cloud-sync.mjs'],outfile:'dist/client/cloud-sync.js',bundle:true,format:'iife',platform:'browser',minify:true});
const assets={};
function collect(dir){for(const file of readdirSync(dir,{withFileTypes:true})){const name=resolve(dir,file.name);if(file.isDirectory())collect(name);else{const path='/'+relative(resolve('dist/client'),name).replaceAll('\\','/');assets[path]={body:readFileSync(name,'utf8'),type:path.endsWith('.html')?'text/html; charset=utf-8':path.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8'};}}}
collect('dist/client');writeFileSync('web/assets.generated.mjs','export default '+JSON.stringify(assets)+';\n');
try{await build({entryPoints:['web/worker.mjs'],outfile:'dist/server/index.js',bundle:true,format:'esm',platform:'browser',minify:true});}finally{rmSync('web/assets.generated.mjs',{force:true});}
mkdirSync('dist/.openai',{recursive:true});copyFileSync('.openai/hosting.json','dist/.openai/hosting.json');cpSync('drizzle','dist/.openai/drizzle',{recursive:true});
console.log('Private web build ready; database contains project text only.');
