import test from 'node:test';
import assert from 'node:assert/strict';
import { selectTechnicalStrategy, strategyInstructions, strengthenTechnicalPrompt, filterClarifyingQuestions } from '../lib/strategy.js';
import { buildSystemPrompt } from '../lib/prompt.js';

test('technical intent separates debugging, modification, implementation and explanation',()=>{
  for(const [draft,kind] of [['修复这个函数','debug'],['重构这个接口','modify'],['实现这个函数','implement'],['为什么报错，只解释，不改代码','explain'],['整理我的会议记录','none']])assert.equal(selectTechnicalStrategy(draft).kind,kind);
});
test('explicit exclusions win over technical execution guidance',()=>{
  const strategy=selectTechnicalStrategy('只解释这个 bug，不改代码，不写测试');
  assert.equal(strategy.noChanges,true);assert.equal(strategy.noTests,true);assert.equal(strategy.kind,'explain');
  assert.match(strategyInstructions(strategy),/Do not add a requirement to write or run tests/);
  const result=strengthenTechnicalPrompt('只解释这个 bug。','只解释这个 bug，不改代码，不写测试');
  assert.ok(!result.includes('必要修改'));assert.ok(!result.includes('测试'));
});
test('simple complete concepts are preserved but referential diagnosis is not bypassed',()=>{
  assert.equal(selectTechnicalStrategy('什么是闭包？').preserveOriginal,true);
  assert.equal(strengthenTechnicalPrompt('什么是闭包？','什么是闭包？'),'什么是闭包？');
  assert.equal(selectTechnicalStrategy('解释这个报错').preserveOriginal,false);
  assert.equal(selectTechnicalStrategy('解释为什么最后输出同一个值').preserveOriginal,false);
});
test('post-generation normalization preserves language and mutation contracts',()=>{
  const result=strengthenTechnicalPrompt('Implement sort in place.','Implement this function in place.');
  assert.ok(!/[\u3400-\u9fff]/u.test(result));assert.equal(result,'Implement sort in place.');
  assert.ok(!result.includes('do not mutate'));
});
test('object-key guidance requires applicable supplied material',()=>{
  const draft='实现这个函数';
  assert.ok(!strengthenTechnicalPrompt(draft,draft,'python 列表旋转').includes('原型'));
  assert.equal(strengthenTechnicalPrompt(draft,draft,'javascript 统计字符串词频，返回对象'),draft);
});
test('production prompt no longer depends on the legacy technical feature switch',()=>{
  for(const technicalPolicy of [false,true]){
    const prompt=buildSystemPrompt({technicalPolicy});
    assert.match(prompt,/writing, learning, coding, analysis and everyday/);
    assert.ok(!prompt.includes('Technical task policy:'));
  }
});
test('questions do not reopen an already fixed code-only output requirement',()=>{
  const questions=[{q:'修复后的代码需要附一行原因说明吗？'},{q:'目标运行环境是哪个版本？'}];
  assert.deepEqual(filterClarifyingQuestions(questions,'只返回代码'),[questions[1]]);
});
