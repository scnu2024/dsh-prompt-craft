import test from 'node:test';
import assert from 'node:assert/strict';
import {cases} from '../eval/projects.mjs';
import {checkProject,projectEdits} from '../eval/project-check.mjs';
import {summarizeProjects} from '../eval/project-report.mjs';
import {answerInput} from '../eval/conditions.mjs';
const binaries={node:process.execPath,python:'/Library/Developer/CommandLineTools/usr/bin/python3'};
test('new project suite has a fixed independent split and no hidden test leakage',()=>{
 assert.equal(cases.length,30);assert.equal(cases.filter(x=>x.split==='accept').length,20);
 const accept=cases.filter(x=>x.split==='accept');assert.equal(accept.filter(x=>x.project).length,12);assert.equal(accept.filter(x=>x.category==='analysis').length,4);assert.equal(accept.filter(x=>x.category==='control').length,4);
 for(const t of cases){const payload=JSON.parse(answerInput(t,t.draft));assert.equal(payload.context,t.context);assert.deepEqual(Object.keys(payload).sort(),['context','request']);if(t.project)assert.ok(!payload.context.includes(t.project.test));}
});
test('project file replacements cannot write tests, escape, duplicate or invent paths',()=>{
 const task=cases.find(x=>x.project);
 for(const path of ['../main.cjs','/tmp/out','check.cjs','new.cjs'])assert.throws(()=>projectEdits(task,JSON.stringify({files:[{path,content:''}]})));
 assert.throws(()=>projectEdits(task,JSON.stringify({files:[{path:'main.cjs',content:''},{path:'main.cjs',content:''}]})));
});
test('reference repairs pass and known defects fail for every mini-project',async()=>{
 for(const task of cases.filter(x=>x.project)){
  const fixed=JSON.stringify({files:Object.entries(task.project.reference).map(([path,content])=>({path,content}))});
  assert.equal((await checkProject(task,fixed,binaries)).pass,true,task.id+' reference');
  assert.equal((await checkProject(task,'{"files":[]}',binaries)).pass,false,task.id+' seed');
 }
});
test('unchanged prompt answer variance earns no improvement credit or analysis win',()=>{
 const records=[{task:{category:'analysis',draft:'Explain'},rewrites:{candidate:{text:'Explain'}},round:0,answers:{original:{},baseline:{},candidate:{violations:[]}},comparison:{winner:'candidate'}}];
 const s=summarizeProjects(records,1);assert.equal(s.wins,0);assert.equal(s.analysisWins,0);assert.equal(s.unchanged,1);assert.equal(s.passed,false);
});
test('baseline regression, violations and incomplete arms prevent promotion',()=>{
 const task={category:'fix',draft:'fix',project:{}};
 const row={task,round:0,rewrites:{candidate:{text:'fix carefully'}},answers:{original:{check:{pass:false}},baseline:{check:{pass:true}},candidate:{check:{pass:false},violations:[]}},comparison:{winner:'tie'}};
 const s=summarizeProjects([row],2);assert.equal(s.complete,false);assert.equal(s.rates.candidate.total,1);assert.equal(s.passed,false);
});
