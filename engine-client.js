// Browser-only engine. No material upload or localhost API exists in this client.
class ZaopianEngineClient {
  constructor(){this.assets=new Map();this.engine=null;}
  async connect(){
    this.module ||= await import('/media/browser-engine.js');this.engine ||= new this.module.BrowserMediaEngine();return this.engine.connect();
  }
  async upload(file){return this.engine.upload(file);}
  async job(id){return this.engine.job(id);}
  async correct(id,segments){return this.engine.correct(id,segments);}
  async export(id){return this.engine.export(id);}
  async blob(id,file){return this.engine.blob(id,file);}
  snapshot(id){return this.engine?.snapshot(id);}
  restore(snapshot){return this.engine?.restore(snapshot);}
  async attach(id,file){return this.engine.attach(id,file);}
  async fingerprint(file){await this.connect();return this.module.fingerprint(file);}
  async asset(id,file){const key=id+'/'+file;if(!this.assets.has(key))this.assets.set(key,URL.createObjectURL(await this.blob(id,file)));return this.assets.get(key);}
  releaseAsset(id,file){const key=id+'/'+file,url=this.assets.get(key);if(url)URL.revokeObjectURL(url);this.assets.delete(key);}
  clearAssets(){for(const url of this.assets.values())URL.revokeObjectURL(url);this.assets.clear();this.engine?.clear();}
}
window.ZaopianEngineClient=ZaopianEngineClient;
