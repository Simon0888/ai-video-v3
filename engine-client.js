// Private Site / local UI client. Media processing stays on this computer.
class ZaopianEngineClient {
  constructor(){this.base='http://127.0.0.1:4173';this.token=null;this.assets=new Map();}
  async connect(){
    this.base=['127.0.0.1','localhost'].includes(location.hostname)?location.origin:'http://127.0.0.1:4173';
    const response=await fetch(this.base+'/api/session',{headers:{'X-Zaopian-Client':'workbench'},signal:AbortSignal.timeout(8000),cache:'no-store'});
    const session=await response.json();if(!response.ok)throw Error(session.error || '无法连接本机处理');
    this.token=session.token;return session;
  }
  async request(path,options={}) {
    if(!this.token)throw Error('请先连接本机处理');
    const response=await fetch(this.base+path,{...options,headers:{Authorization:'Bearer '+this.token,...options.headers},cache:'no-store'});
    if(response.status===401)this.token=null;
    if(!response.ok){const error=await response.json().catch(()=>({}));throw Error(error.error || '本机处理未完成');}
    return response;
  }
  async upload(file){return (await this.request('/api/jobs',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(file.name)},body:file})).json();}
  async job(id){return (await this.request('/api/jobs/'+id)).json();}
  async correct(id,segments){return (await this.request('/api/jobs/'+id+'/transcript',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({segments})})).json();}
  async export(id){return (await this.request('/api/jobs/'+id+'/export',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).json();}
  async blob(id,file){return (await this.request('/api/jobs/'+id+'/files/'+file.split('/').map(encodeURIComponent).join('/'))).blob();}
  async asset(id,file){const key=id+'/'+file;if(!this.assets.has(key))this.assets.set(key,URL.createObjectURL(await this.blob(id,file)));return this.assets.get(key);}
  releaseAsset(id,file){const key=id+'/'+file,url=this.assets.get(key);if(url)URL.revokeObjectURL(url);this.assets.delete(key);}
  clearAssets(){for(const url of this.assets.values())URL.revokeObjectURL(url);this.assets.clear();}
}
window.ZaopianEngineClient=ZaopianEngineClient;
