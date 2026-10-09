import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MediaEngine } from './engine/media-engine.mjs';

const root=fileURLToPath(new URL('./',import.meta.url));
const SITE='https://ai-video-v3-simon-workbench.simon000888.chatgpt.site';
const files={'/':['index.html','text/html'],'/index.html':['index.html','text/html'],'/style.css':['style.css','text/css'],'/app.js':['app.js','text/javascript'],'/engine-client.js':['engine-client.js','text/javascript'],'/engine-ui.js':['engine-ui.js','text/javascript']};

export function allowedOrigin(req) {
  const host=req.headers.host || '';
  if(!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host))return false;
  const origin=req.headers.origin;
  if(origin)return origin===SITE || origin===`http://${host}`;
  return !req.headers['sec-fetch-site'] || ['same-origin','none'].includes(req.headers['sec-fetch-site']);
}

async function jsonBody(req) {
  if(!String(req.headers['content-type'] || '').startsWith('application/json'))throw Object.assign(Error('请求格式不正确'),{status:415});
  const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>1024*1024)throw Object.assign(Error('请求内容过大'),{status:413});chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');}catch{throw Object.assign(Error('请求内容无法读取'),{status:400});}
}

export async function createWorkbenchServer({engine=null,projectRoot=root}={}) {
  engine ||= await new MediaEngine({root:projectRoot}).initialize();
  // Issue tokens only to this local UI or the exact existing private Site.
  // Tokens stay out of the repository and artifact URLs; reject DNS rebinding Hosts.
  const token=randomBytes(32).toString('base64url');
  const authorized=req=>{const provided=Buffer.from(String(req.headers.authorization || '').replace(/^Bearer /,''));const expected=Buffer.from(token);return provided.length===expected.length && timingSafeEqual(provided,expected);};
  const server=createServer(async(req,res)=>{
    const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
    try {
      if(!allowedOrigin(req)) {send(403,{error:'此页面无法访问本机处理服务'});req.resume();return;}
      const origin=req.headers.origin;
      if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
      if(req.method==='OPTIONS') {
        res.writeHead(204,{'Access-Control-Allow-Methods':'GET, POST, PATCH, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type, X-Zaopian-Client, X-File-Name','Access-Control-Allow-Private-Network':'true','Access-Control-Max-Age':'300'});res.end();return;
      }
      const url=new URL(req.url,`http://${req.headers.host}`),path=url.pathname;
      if(path==='/api/session' && req.method==='GET') {
        if(req.headers['x-zaopian-client']!=='workbench'){send(403,{error:'请从工作台连接本机处理'});return;}
        send(200,{token,...await engine.health()});return;
      }
      if(path.startsWith('/api/')) {
        if(!authorized(req)){send(401,{error:'请重新连接本机处理服务'});req.resume();return;}
        if(path==='/api/engine' && req.method==='GET'){send(200,await engine.health());return;}
        if(path==='/api/jobs' && req.method==='POST') {
          const filename=decodeURIComponent(String(req.headers['x-file-name'] || 'video.mp4'));
          send(202,await engine.upload(req,filename));return;
        }
        const match=path.match(/^\/api\/jobs\/([a-f0-9-]{36})(?:\/(transcript|export|files)(?:\/(.+))?)?$/);
        if(match) {
          const [,id,action,file]=match;
          if(!action && req.method==='GET'){send(200,engine.publicJob(engine.get(id)));return;}
          if(action==='transcript' && req.method==='PATCH'){const data=await jsonBody(req);send(200,await engine.correct(id,data.segments));return;}
          if(action==='export' && req.method==='POST'){await jsonBody(req);send(202,await engine.export(id));return;}
          if(action==='files' && file && req.method==='GET') {
            const artifact=await engine.artifact(id,decodeURIComponent(file));
            res.writeHead(200,{'Content-Type':artifact.type,'Content-Length':artifact.size,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
            createReadStream(artifact.path).on('error',()=>res.destroy()).pipe(res);return;
          }
        }
        send(404,{error:'处理接口不存在'});req.resume();return;
      }
      if(!['GET','HEAD'].includes(req.method)){send(405,{error:'不支持此操作'});req.resume();return;}
      const entry=files[path];if(!entry){res.writeHead(404);res.end('Not found');return;}
      const body=await readFile(join(projectRoot,entry[0]));res.writeHead(200,{'Content-Type':`${entry[1]}; charset=utf-8`,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:body);
    } catch(error){if(!res.headersSent)send(error.status || 400,{error:error.message || '处理未完成，请重试'});else res.destroy();}
  });
  return {server,engine};
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const {server}=await createWorkbenchServer();
  server.listen(4173,'127.0.0.1',()=>console.log('造片本机处理: http://127.0.0.1:4173'));
  server.on('error',err=>{console.error(err.code==='EADDRINUSE'?'4173 端口已被占用，请先检查现有服务。':err.message);process.exitCode=1;});
}
