import { createServer } from 'node:http';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { workspaceApi } from '../web/workspace-api.mjs';
const root=resolve(new URL('..',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
mkdirSync(resolve(root,'.local'),{recursive:true});
const sqlite=new DatabaseSync(resolve(root,'.local/web-preview.sqlite'));
sqlite.exec('CREATE TABLE IF NOT EXISTS preview_migrations (name TEXT PRIMARY KEY)');
for(const name of readdirSync(resolve(root,'drizzle')).filter(f=>f.endsWith('.sql')).sort())if(!sqlite.prepare('SELECT name FROM preview_migrations WHERE name=?').get(name)){sqlite.exec(readFileSync(resolve(root,'drizzle',name),'utf8'));sqlite.prepare('INSERT INTO preview_migrations(name) VALUES (?)').run(name);}
const DB={prepare(sql){return {bind(...values){return {async first(){return sqlite.prepare(sql).get(...values) || null;}};}};}};
const worker=(await import('../dist/server/index.js')).default;
const server=createServer(async(req,res)=>{
  try{
    const origin=`http://${req.headers.host}`;
    if(!/^http:\/\/(localhost|127\.0\.0\.1):4174$/.test(origin)){res.writeHead(403).end();return;}
    const body=[];for await(const chunk of req){body.push(chunk);if(body.reduce((sum,b)=>sum+b.length,0)>524388){res.writeHead(413).end();return;}}
    const request=new Request(origin+req.url,{method:req.method,headers:req.headers,...(body.length?{body:Buffer.concat(body)}:{})});
    const response=await worker.fetch(request,{DB});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch(error){res.writeHead(500).end('Preview failed');console.error(error.message);}
});
server.listen(4174,'127.0.0.1',()=>console.log('Browser preview: http://127.0.0.1:4174 (local database emulates the private Site; media is processed in the browser)'));
