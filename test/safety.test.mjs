import test from 'node:test';
import assert from 'node:assert/strict';
import {selectTechnicalStrategy,strengthenTechnicalPrompt} from '../lib/strategy.js';
import {hardConstraints,constraintViolations} from '../lib/constraints.js';
import {collectHistory} from '../lib/history.js';
import {detectViolations} from '../lib/gate.js';
import {createHandlers} from '../lib/route.js';
import {resolveConfig} from '../index.js';

test('negated explanation and tests do not reclassify implementation',()=>{
 const s=selectTechnicalStrategy('实现 add(a,b)，直接返回 a+b。只输出函数代码，不添加解释或测试。');
 assert.equal(s.kind,'implement');assert.equal(s.noTests,true);assert.equal(s.preserveOriginal,true);
});
test('positive compound goals survive in Chinese and English',()=>{
 for(const text of ['解释原因并修复问题，不新增依赖。','Explain the failure and fix the bug. Do not add tests.']){
  const s=selectTechnicalStrategy(text);assert.ok(s.kinds.includes('debug'));assert.ok(s.kinds.includes('explain'));assert.equal(s.preserveOriginal,false);
 }
});
test('output-length restrictions remain unchanged with no suffix',()=>{
 const text='用一句话解释 HTTP 403，不提供解决方案。';
 assert.equal(selectTechnicalStrategy(text).preserveOriginal,true);assert.equal(strengthenTechnicalPrompt(text,text),text);
});
test('lost restrictions and conflicting positive requirements are detected',()=>{
 const draft='只解释原因，不改代码，不写测试，不新增依赖。';
 const v=constraintViolations(draft,'解释原因并修改代码，补充测试，安装新依赖。');
 assert.ok(v.missing.length>=3);assert.ok(v.conflicts.length>=3);
 assert.deepEqual(constraintViolations(draft,draft),{missing:[],conflicts:[]});
 assert.ok(!hardConstraints('分析 `do not add tests` 这段字符串').length);
});
test('history reports omitted old turns and preserves head and tail of clipped turns',()=>{
 const scope={get:()=>({get:()=>({deriveMessages:()=>['old','middle','head '+'x'.repeat(60)+' TAIL'].map(text=>({role:'user',content:[{type:'text',text}]}))})})};
 const result=collectHistory(scope,'s',{maxMessages:1,maxCharsPerMessage:20,maxTotalChars:30});
 assert.equal(result.truncated,true);assert.equal(result.turns[0].truncated,true);assert.match(result.turns[0].text,/^head/);assert.match(result.turns[0].text,/TAIL$/);
 assert.ok(detectViolations({draft:'修复问题',text:'修复 hidden.py',sources:result.turns.map(t=>t.text),id:'clear'}).invented.includes('hidden.py'));
});

test('general task restrictions cover examples, assumptions, estimates and recommendations',()=>{
  for(const clause of ['不举例','不展开推导','不推断受访者动机','不假设日期','不估算热量','不推荐购买商品','不提出解决方案','只使用现有食材']){
    assert.ok(hardConstraints(clause).includes(clause),clause);
    assert.ok(constraintViolations(clause,'给出完整结果。').missing.includes(clause),clause);
  }
});

test('confirming an excluded action was not taken is not a positive obligation',()=>{
  for(const candidate of ['不新增外部依赖。完成后确认未引入新依赖。','不新增外部依赖。确认没有新增依赖。']){
    assert.deepEqual(constraintViolations('不新增外部依赖。',candidate),{missing:[],conflicts:[]});
  }
  assert.deepEqual(constraintViolations('Do not add dependencies.','Do not add dependencies. Confirm we did not introduce dependencies.'),{missing:[],conflicts:[]});
});
