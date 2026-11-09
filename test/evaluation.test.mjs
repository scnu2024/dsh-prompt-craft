import test from 'node:test';
import assert from 'node:assert/strict';
import { cases } from '../eval/cases.mjs';
import { summarize } from '../eval/report.mjs';
import { checkCode, constraintViolations } from '../eval/check.mjs';
import { answerInput } from '../eval/conditions.mjs';

test('fixed suite has ten development tasks and twenty independent acceptance tasks',()=>{
  assert.equal(cases.length,30);assert.equal(cases.filter(x=>x.split==='dev').length,10);assert.equal(cases.filter(x=>x.split==='accept').length,20);
  assert.equal(new Set(cases.map(x=>x.id)).size,30);
  for(const task of cases)if(task.tests)assert.ok(task.tests.length>=2);
});
test('unfinished comparisons cannot meet acceptance and failures remain in denominator',()=>{
  const record={task:{tests:[{}]},round:0,answers:{original:{check:{pass:false}},candidate:{check:{pass:true},violations:[]}},comparison:{winner:'candidate'}};
  const report=summarize([record],40);assert.equal(report.complete,false);assert.equal(report.passed,false);assert.equal(report.rates.original.total,1);
});
test('answer arms share the supplied material without leaking tests or judge answers',()=>{
  const task=cases.find(x=>x.tests);
  const original=JSON.parse(answerInput(task,task.draft));
  const candidate=JSON.parse(answerInput(task,'Rewritten request'));
  assert.equal(original.context,candidate.context);
  assert.deepEqual(Object.keys(candidate).sort(),['context','request']);
  assert.equal(candidate.request,'Rewritten request');
});
test('a real sandboxed implementation passes predefined tests and mutation is detected',async()=>{
  const task={name:'copy',language:'javascript',immutable:true,tests:[{args:[[2,1]],expected:[1,2]}]};
  const binaries={node:process.execPath,python:'/Library/Developer/CommandLineTools/usr/bin/python3'};
  assert.equal((await checkCode(task,'function copy(a){return [...a].sort()}',binaries)).pass,true);
  assert.equal((await checkCode(task,'function copy(a){return a.sort()}',binaries)).pass,false);
});
test('object property ordering does not create a false code failure',async()=>{
  const task={name:'obj',language:'javascript',tests:[{args:[],expected:{a:1,b:2}}]};
  assert.equal((await checkCode(task,'function obj(){return {b:2,a:1}}',{node:process.execPath})).pass,true);
});
test('Python JSON results normalize tuple sequences but preserve scalar types',async()=>{
  const binaries={python:'/Library/Developer/CommandLineTools/usr/bin/python3'};
  const task={name:'result',language:'python',tests:[{args:[],expected:[[0,3]]}]};
  assert.equal((await checkCode(task,'def result():\n return [(0,3)]',binaries)).pass,true);
  assert.equal((await checkCode({...task,tests:[{args:[],expected:true}]},'def result():\n return 1',binaries)).pass,false);
});
test('forbidden output additions are counted independently of code correctness',()=>{
  assert.equal(constraintViolations({draft:'只输出代码，不添加解释或测试'},'Here is the code:\n```js\nfunction f(){}\n```').length,1);
});
