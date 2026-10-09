export const MAX_PROJECT_BYTES = 524288;
export function projectData(input, strict = false) {
  const object = (value, keys) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('无效的项目资料');
    if (strict && Object.keys(value).some(k => !keys.includes(k))) throw Error('只允许同步项目文字与进度');
    return value;
  };
  const text = (value, max = 1000) => {
    if (typeof value !== 'string' || value.length > max || /(?:^data:|^blob:|base64,)/i.test(value)) throw Error('项目字段必须是限定长度的文字，不能包含素材');
    return value;
  };
  const number = (value, min = 0, max = 1e9) => {if (!Number.isFinite(value) || value < min || value > max) throw Error('无效的项目数字'); return value;};
  const list = (value, fn, max = 512) => {if (!Array.isArray(value) || value.length > max) throw Error('项目条目过多');return value.map(fn);};
  const pick = (value, spec) => {
    object(value, Object.keys(spec));const result={};
    for (const [key, fn] of Object.entries(spec)) if (value[key] !== undefined) result[key] = fn(value[key]);
    return result;
  };
  const product = value => pick(value, {id:v=>text(v,100),name:v=>text(v,100),short:v=>text(v,40),category:v=>text(v,40),price:v=>number(v,0,999999),commission:v=>number(v,0,100),audience:v=>text(v,200),points:v=>text(v,1000),color:v=>{if(!/^#[a-f0-9]{6}$/i.test(v))throw Error('无效的商品颜色');return v;}});
  const segment = value => pick(value,{id:v=>typeof v==='number'?number(v):text(v,100),start:v=>number(v,0,3600),end:v=>number(v,0,3600),text:v=>text(v),corrected:v=>Boolean(v)});
  const transcript = value => pick(value,{segments:v=>list(v,segment),reason:v=>text(v),engine:v=>text(v,120),language:v=>text(v,40),model:v=>text(v,200)});
  const evidence = value => pick(value,{
    id:v=>text(v,100),revision:v=>number(v),media:v=>pick(v,{duration:x=>number(x,0,3600),width:x=>number(x,1,4096),height:x=>number(x,1,4096),frameRate:x=>typeof x==='number'?number(x,0,240):text(x,40),hasAudio:x=>Boolean(x)}),
    boundaries:v=>list(v,b=>pick(b,{at:x=>number(x,0,3600),score:x=>number(x,0,255)})),
    frameTimes:v=>list(v,t=>number(t,0,3600),12),raw:v=>transcript(v),transcript:v=>transcript(v)
  });
  const reference = value => pick(value,{
    kind:v=>{if(!['local','link','demo'].includes(v))throw Error('无效的对标类型');return v;},name:v=>text(v,200),description:v=>text(v),
    url:v=>{text(v,4096);if(!/^https?:\/\//i.test(v))throw Error('无效的参考链接');return v;},duration:v=>number(v,0,3600),size:v=>number(v,0,104857600),fingerprint:v=>{if(!/^[a-f0-9]{64}$/.test(v))throw Error('无效的素材指纹');return v;},
    engineJobId:v=>text(v,100),evidence,
    transcriptDraft:v=>pick(v,{revision:x=>number(x),segments:x=>list(x,s=>pick(s,{id:y=>typeof y==='number'?number(y):text(y,100),text:y=>text(y)}))})
  });
  const paragraph = value => pick(value,{title:v=>text(v,120),time:v=>text(v,80),content:v=>text(v),text:v=>text(v),visual:v=>text(v),camera:v=>text(v,80)});
  const nullable = fn => v => v === null ? null : fn(v);
  const result=pick(input,{
    step:v=>number(v,0,5),product:nullable(product),reference:nullable(reference),analysis:nullable(v=>list(v,paragraph)),script:nullable(v=>list(v,paragraph)),shots:nullable(v=>list(v,paragraph)),
    tasks:v=>list(v,t=>{const clean=pick(t,{id:x=>text(x,100),name:x=>text(x,200),status:x=>['ready','failed'].includes(x)?x:'ready',created:x=>text(x,80),progress:x=>number(x,0,100),error:x=>text(x)});if(t.status==='rendering')clean.progress=0;return clean;},10),
    settings:v=>pick(v,{platform:x=>text(x,40),tone:x=>text(x,40),duration:x=>text(x,20),audience:x=>text(x,200)}),custom:v=>list(v,product,200),observation:v=>text(v),scriptOrigin:v=>text(v,40)
  });
  if (!Number.isInteger(result.step) || !result.settings || !result.custom || !result.tasks) throw Error('项目资料不完整');
  if (new TextEncoder().encode(JSON.stringify(result)).length > MAX_PROJECT_BYTES) throw Error('项目文字资料过大，请先导出归档');
  return result;
}
