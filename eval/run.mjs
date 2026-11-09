import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const split=process.argv[2]??'dev';
const general=process.env.DSH_EVAL_SUITE==='general';
const projects=!general && process.env.DSH_EVAL_SUITE!=='legacy';
if(!['dev','accept','holdout'].includes(split)||(split==='holdout'&&!general))throw new Error('Usage: node eval/run.mjs dev|accept|holdout [output-directory]');
const directory=resolve(process.argv[3]??`eval/reports/${split}-${new Date().toISOString().replace(/[:.]/g,'-')}`);
await mkdir(directory,{recursive:true});
const base=process.env.DSH_EVAL_INSPECTOR??'http://127.0.0.1:9230';
if(!['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname))throw new Error('Only the local Host inspector is supported');
const endpoints=await fetch(base+'/json/list').then(r=>r.json());
const endpoint=endpoints.find(e=>e.title==='DeepSeek Harness Host');
if(!endpoint)throw new Error('Enable the installed DSH developer tools and keep Harness running');
const socket=new WebSocket(endpoint.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
const root=fileURLToPath(new URL('../',import.meta.url));
const files=['index.js','package.json',...(await readdir(resolve(root,'lib'))).filter(x=>x.endsWith('.js')).map(x=>'lib/'+x),'eval/host.mjs','eval/check.mjs','eval/cases.mjs','eval/report.mjs','eval/conditions.mjs','eval/baseline/prompt.js'];
if(projects){files.push('eval/project-host.mjs','eval/projects.mjs','eval/project-check.mjs','eval/project-report.mjs','eval/production-baseline/index.js','eval/production-baseline/package.json',...(await readdir(resolve(root,'eval/production-baseline/lib'))).filter(x=>x.endsWith('.js')).map(x=>'eval/production-baseline/lib/'+x));}
if(!general && !projects)files.push('eval/production-baseline/index.js','eval/production-baseline/package.json',...(await readdir(resolve(root,'eval/production-baseline/lib'))).filter(x=>x.endsWith('.js')).map(x=>'eval/production-baseline/lib/'+x));
if(general)files.push('eval/general-host.mjs','eval/general-cases.mjs','eval/general-report.mjs');
const sources=await Promise.all(files.map(async path=>({path,bytes:await readFile(resolve(root,path))})));
const sourceHashes=Object.fromEntries(sources.map(x=>[x.path,createHash('sha256').update(x.bytes).digest('hex')]));
const snapshotId=createHash('sha256').update(JSON.stringify(sourceHashes)).digest('hex');
const snapshot=resolve(root,'eval/.runtime',snapshotId);
for(const source of sources){const target=resolve(snapshot,source.path);await mkdir(dirname(target),{recursive:true});await writeFile(target,source.bytes);}
const hostFile=resolve(snapshot,general?'eval/general-host.mjs':projects?'eval/project-host.mjs':'eval/host.mjs');
const config={split,directory,sourceHashes,snapshotId,executables:{node:process.execPath,python:process.env.DSH_EVAL_PYTHON??'/Library/Developer/CommandLineTools/usr/bin/python3'}};
const expression=`(async()=>{const key=Symbol.for('prompt-craft.development-evaluation');if(globalThis[key]?.running&&globalThis[key]?.promise)throw Error('An evaluation is already running');let ctx;for(const r of globalThis[Symbol.for('dsh.inspector.realm-object-registries')].values())for(const v of r.retained.values())if(!ctx&&typeof v?.get==='function'){try{if(v.get('llm'))ctx=v;}catch{}}if(!ctx)throw Error('Host context unavailable');const controller=new AbortController();const run={running:true,controller};globalThis[key]=run;const module=process.getBuiltinModule('module').createRequire(${JSON.stringify(fileURLToPath(import.meta.url))})(${JSON.stringify(hostFile)});run.promise=module.runSuite(ctx,{...${JSON.stringify(config)},signal:controller.signal}).then(result=>{run.result=result;return result;}).catch(async error=>{run.error=error.message;const fs=process.getBuiltinModule('fs/promises');await fs.writeFile(${JSON.stringify(directory+'/ERROR.txt')},error.stack??error.message);}).finally(()=>{run.running=false;});return {started:true,directory:${JSON.stringify(directory)}};})()`;
const response=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Host inspector timeout')),10000);
  socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.id===1){clearTimeout(timer);resolve(m.result??m.error);}};
  socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}));
});
socket.close();
if(response.exceptionDetails||!response.result?.value?.started)throw new Error(JSON.stringify(response));
console.log(JSON.stringify(response.result.value));
