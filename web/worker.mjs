import { workspaceApi } from './workspace-api.mjs';
import assets from './assets.generated.mjs';
export default {
  async fetch(request,env){
    const path=new URL(request.url).pathname;
    if(path==='/api/workspace')return workspaceApi(request,env);
    if(path.startsWith('/api/'))return new Response('Not found',{status:404});
    if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});
    const asset=assets[path==='/'?'/index.html':path];
    if(!asset)return new Response('Not found',{status:404});
    return new Response(request.method==='HEAD'?null:asset.body,{headers:{'content-type':asset.type,'cache-control':'no-cache','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}});
  }
};
