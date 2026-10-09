import { projectData, MAX_PROJECT_BYTES } from './project-data.mjs';
const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
const key='owner-workspace';
const read=async db=>{
  const row=await db.prepare('SELECT revision, state_json, updated_at FROM workspace WHERE id = ?').bind(key).first();
  return row?{revision:row.revision,state:JSON.parse(row.state_json),updatedAt:row.updated_at}:{revision:0,state:null,updatedAt:null};
};
// The existing Site is owner-private. Platform dispatch authenticates its sole
// owner (or its scoped service credential) before this shared workspace API.
// Do not change the Site to public/shared without adding workspace authorization.
export async function workspaceApi(request,env) {
  if (!env.DB) return json({error:'项目同步尚未准备完成'},503);
  try {
    if (request.method==='GET') return json(await read(env.DB));
    if (request.method!=='PUT') return json({error:'只支持读取与保存文字资料'},405);
    const origin=request.headers.get('origin');
    if (origin && origin!==new URL(request.url).origin) return json({error:'不能从其他网站保存项目'},403);
    if (!request.headers.get('content-type')?.startsWith('application/json')) return json({error:'此接口不接收素材文件'},415);
    if (Number(request.headers.get('content-length') || 0)>MAX_PROJECT_BYTES+100) return json({error:'资料过大'},413);
    const reader=request.body?.getReader();let total=0,parts=[];
    if(!reader)return json({error:'缺少项目资料'},400);
    while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>MAX_PROJECT_BYTES+100){await reader.cancel();return json({error:'资料过大'},413);}parts.push(value);}
    const bytes=new Uint8Array(total);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
    const payload=JSON.parse(new TextDecoder().decode(bytes));
    if(Object.keys(payload).some(k=>!['revision','state'].includes(k)) || !Number.isSafeInteger(payload.revision) || payload.revision<0)throw Error('无效的保存请求');
    const state=projectData(payload.state,true),updatedAt=new Date().toISOString(),next=payload.revision+1;
    const result=payload.revision===0
      ? await env.DB.prepare('INSERT INTO workspace (id, revision, state_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING RETURNING revision').bind(key,next,JSON.stringify(state),updatedAt).first()
      : await env.DB.prepare('UPDATE workspace SET revision = ?, state_json = ?, updated_at = ? WHERE id = ? AND revision = ? RETURNING revision').bind(next,JSON.stringify(state),updatedAt,key,payload.revision).first();
    if(!result)return json({error:'另一台设备更新了项目，请选择要继续使用的版本',...await read(env.DB)},409);
    return json({revision:next,updatedAt});
  } catch(error){return json({error:error.message || '项目保存失败'},400);}
}
