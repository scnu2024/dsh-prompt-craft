import { cases } from './projects.mjs';
import { checkProject } from './project-check.mjs';
const binaries={node:process.execPath,python:process.env.DSH_EVAL_PYTHON??'/Library/Developer/CommandLineTools/usr/bin/python3'};
let failures=0;
for(const task of cases.filter(x=>x.project)){
 const good=await checkProject(task,JSON.stringify({files:Object.entries(task.project.reference).map(([path,content])=>({path,content}))}),binaries);
 const bad=await checkProject(task,'{"files":[]}',binaries);
 console.log(JSON.stringify({id:task.id,reference:good.pass,seedFails:!bad.pass,...(!good.pass?{failure:good.failures}:{})}));
 if(!good.pass||bad.pass)failures++;
}
if(failures)process.exitCode=1;
