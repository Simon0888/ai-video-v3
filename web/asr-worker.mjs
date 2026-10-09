import { pipeline, env } from '@huggingface/transformers';
env.allowLocalModels=false;
env.backends.onnx.wasm.numThreads=1;
env.backends.onnx.wasm.proxy=false;
let recognizer;
self.onmessage=async ({data})=>{
  try{
    recognizer ||= await pipeline('automatic-speech-recognition','onnx-community/whisper-tiny',{
      device:'wasm',dtype:'q8',progress_callback:p=>self.postMessage({type:'progress',message:p.status==='progress'?`下载语音模型 ${p.file} · ${Math.round(p.progress || 0)}%`:'正在准备浏览器语音模型…'})
    });
    self.postMessage({type:'progress',message:'语音模型已准备，正在这台电脑识别台词…'});
    const result=await recognizer(data.audio,{language:'chinese',task:'transcribe',return_timestamps:true,chunk_length_s:30,stride_length_s:5});
    self.postMessage({type:'result',result});
  }catch(error){recognizer=null;self.postMessage({type:'error',message:error.message});}
};
