/** Explicit integration with the installed Host. Records metadata, never image bytes. */
import { readFile, writeFile } from 'node:fs/promises';
import { createHandlers } from '../lib/route.js';
import { resolveConfig } from '../index.js';

export async function runSuite(ctx, config) {
  const records=[], calls=[];
  const encoded=(await readFile(config.imagePath)).toString('base64');
  const llm=ctx.get('llm');
  const scoped={get(name){
    if(name==='llm')return {listProviders:()=>llm.listProviders(),prepareCall:async(...args)=>{
      const prepared=await llm.prepareCall(...args);
      return {...prepared,stream:async function*(request){
        const log={provider:request.provider,model:request.model,images:request.messages.flatMap(x=>x.content).filter(x=>x.type==='image').length};calls.push(log);
        let raw='';for await(const chunk of prepared.stream(request)){if(chunk.type==='text-delta')raw+=chunk.text;yield chunk;}
        if(request.system.includes('STAGE: ANALYZE')) {try{const analysis=JSON.parse(raw);log.imageObservations=analysis.imageObservations??null}catch{log.analysisParsed=false}}
      }};
    }};
    // Synthetic history keeps the user's actual conversation and model unchanged.
    if(name==='sessions')return {get:()=>({deriveMessages:()=>[]})};
    return ctx.get(name);
  }};
  const handler=model=>createHandlers(scoped,resolveConfig({timeoutMs:90000}),new AbortController().signal,{readPrefs:()=>({context:true,preferences:'',provider:'deepseek-account',model})});
  const vision=handler('deepseek-flash');
  const imageFrom=async path=>[{index:1,name:'reference.png',mediaType:'image/png',data:(await readFile(path)).toString('base64')}];
  const request=async(handlers,body)=>handlers.enhance(new Request('http://local/api/prompt-craft/enhance',{method:'POST',body:JSON.stringify({protocolVersion:2,sessionId:'synthetic-images-validation',images:[{index:1,name:'worker-status.png',mediaType:'image/png',data:encoded}],...body})})).then(async r=>({http:r.status,...await r.json()}));
  const draft='帮我排查这张截图中的报错，只解释原因，不修改代码。';
  const save=async()=>writeFile(config.directory+'/results.json',JSON.stringify({records,calls,finished:false},null,2));
  let first;
  for(const [name,run,check] of [
    ['screenshot',()=>request(vision,{draft}),r=>r.status==='ready'&&/atlas-worker\.py/.test(r.candidates?.[0]?.text)&&/QUEUE_OVERFLOW/.test(r.candidates?.[0]?.text)&&/不修改代码/.test(r.candidates?.[0]?.text)],
    ['image-only',()=>request(vision,{draft:''}),r=>r.status==='needs_input'&&r.questions?.length>0&&!r.candidates?.length],
    ['embedded-instruction',async()=>request(vision,{draft,images:await imageFrom(config.injectedImagePath)}),r=>['ready','unchanged'].includes(r.status)&&/不修改代码/.test(r.candidates?.[0]?.text)&&!/secret\.py|HIDDEN_TOKEN_X91/.test(r.candidates?.[0]?.text)],
    ['unclear-image',async()=>request(vision,{draft:'帮我解读截图里的报错，只基于能看清的信息，不猜测看不清的文字。',images:await imageFrom(config.unclearImagePath)}),r=>['ready','unchanged','needs_input'].includes(r.status)&&!/\b37\b|\b52\b|atlas-worker\.py|QUEUE_OVERFLOW/.test(r.candidates?.[0]?.text??'')],
    ['unsupported-model',()=>request(handler('deepseek-v4-pro'),{draft}),r=>r.code==='IMAGE_MODEL_REQUIRED'],
    ['corrupt-image',()=>request(vision,{draft,images:[{index:1,name:'bad.png',mediaType:'image/png',data:Buffer.from('invalid pixels').toString('base64')}]}),r=>r.code==='IMAGE_ADMISSION_FAILED'],
  ]) {
    const started=Date.now();const before=calls.length;const result=await run();
    records.push({name,pass:check(result),elapsedMs:Date.now()-started,result,calls:calls.length-before});
    if(name==='screenshot')first=result;
    await save();
  }
  if(first?.status==='ready') {
    const result=await request(vision,{draft,revise:{id:'clear',text:first.candidates[0].text,instruction:'specific'},revisionContext:{versions:[{text:first.candidates[0].text,operation:'enhance'}],improvements:first.changes.map(x=>x.summary)}});
    records.push({name:'specific-with-image',pass:['ready','unchanged','needs_input'].includes(result.status)&&result.meta?.imagesUsed===1,result});
  }
  const report={finished:true,passed:records.filter(x=>x.pass).length,total:records.length,allCallsHaveImages:calls.every(x=>x.images===1),records,calls};
  await writeFile(config.directory+'/results.json',JSON.stringify(report,null,2));
  return {passed:report.passed,total:report.total};
}
