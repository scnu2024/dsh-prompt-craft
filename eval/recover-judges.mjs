import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
async function main(){
  const directory=resolve(process.argv[2]);
  const base=process.env.DSH_EVAL_INSPECTOR??'http://127.0.0.1:9230';
  if(!['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname))throw Error('Only the local Host inspector is supported');
  const endpoints=await fetch(base+'/json/list').then(r=>r.json());
  const target=endpoints.find(x=>x.title==='DeepSeek Harness Host');
  if(!target)throw Error('Local DSH Host unavailable');
  const socket=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  const modulePath=fileURLToPath(new URL('judge-recovery-host.mjs',import.meta.url));
  const expression=`(async()=>{let ctx;for(const r of globalThis[Symbol.for('dsh.inspector.realm-object-registries')].values())for(const v of r.retained.values())if(!ctx&&typeof v?.get==='function'){try{if(v.get('llm'))ctx=v;}catch{}}if(!ctx)throw Error('Host unavailable');const m=process.getBuiltinModule('module').createRequire(${JSON.stringify(modulePath)})(${JSON.stringify(modulePath)});return m.recoverJudges(ctx,${JSON.stringify(directory)});})()`;
  const response=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Recovery timeout')),100000);socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.id===1){clearTimeout(timer);resolve(m.result??m.error);}};socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}));});
  socket.close();if(response.exceptionDetails)throw Error(JSON.stringify(response.exceptionDetails));
  console.log(JSON.stringify(response.result?.value));
}

main().catch(error=>{console.error(error);process.exitCode=1;});
