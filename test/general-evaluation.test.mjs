import test from 'node:test';
import assert from 'node:assert/strict';
import {generalCases} from '../eval/general-cases.mjs';
import {summarizeGeneral} from '../eval/general-report.mjs';

test('general suite has separate dev and acceptance cases across five categories',()=>{
  assert.equal(generalCases.filter(t=>t.split==='dev').length,10);
  const accept=generalCases.filter(t=>t.split==='accept');assert.equal(accept.length,20);
  assert.equal(new Set(generalCases.map(t=>t.id)).size,50);
  assert.equal(generalCases.filter(t=>t.split==='holdout').length,20);
  for(const category of ['coding','writing','learning','analysis','everyday']){
    const cases=accept.filter(t=>t.category===category);assert.equal(cases.length,4);
    assert.equal(cases.filter(t=>t.iterate).length,1);assert.equal(cases.filter(t=>t.control).length,1);
  }
});
const judgment={useful:true,acceptable:true,newFacts:[],lostRestrictions:[],repetition:false};
function row(extra={}){return {task:{underSpecified:true},steps:[{result:{ok:true,status:'ready'},judgments:[judgment,judgment],deterministicViolations:[],...extra}]};}
test('incomplete runs, failed calls, missing judges and blocked results cannot pass acceptance',()=>{
  assert.equal(summarizeGeneral([row()],2).passed,false);
  for(const extra of [{result:{ok:false}},{result:{ok:true,status:'blocked'}},{judgments:[judgment]},{judgeError:'truncated'}])assert.equal(summarizeGeneral([row(extra)],1).passed,false);
});
test('semantic violations and repetition fail acceptance regardless of usefulness',()=>{
  for(const j of [{...judgment,newFacts:['fabricated path']},{...judgment,lostRestrictions:['no tests']},{...judgment,repetition:true}])assert.equal(summarizeGeneral([row({judgments:[j,judgment]})],1).passed,false);
  assert.equal(summarizeGeneral([row({deterministicViolations:['repetition']})],1).passed,false);
});
test('both independent judgments must confirm useful short-prompt improvement',()=>{
  assert.equal(summarizeGeneral([row({judgments:[judgment,{...judgment,useful:false}]})],1).usefulRate,0);
  assert.equal(summarizeGeneral([row()],1).passed,true);
});
