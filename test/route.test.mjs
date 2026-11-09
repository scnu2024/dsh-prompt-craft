import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resolveConfig } from '../index.js';
import { createHandlers } from '../lib/route.js';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prompt-craft-v2-'));
process.env.DSH_PROMPT_CRAFT_SETTINGS=path.join(dir,'settings.json');
const plan=(extra={})=>({decision:'rewrite',category:'everyday',goal:'clarify',confirmedFacts:[],restrictions:[],questions:[],improvements:[{id:'i1',gap:'The execution sequence is unclear',action:'Clarify the execution sequence'}],reason:'明确执行顺序。',...extra});
const output=text=>({candidates:[{id:'clear',text}],changes:[{id:'i1',summary:'明确执行步骤。'}]});
function fixture(replies,options={}) {
  let calls=0; const inputs=[];
  const llm={listProviders:()=>[{id:'p',name:'Provider'}],listModels:async()=>[{id:'m'}],prepareCall:async()=>{
    const reply=replies[Math.min(calls++,replies.length-1)];
    return {config:{},stream:async function*(input){inputs.push(input);
      if(reply instanceof Error)throw reply;
      if(reply?.pending) { await new Promise(()=>{}); return; }
      if(reply?.abort) { reply.abort.abort(); await new Promise(()=>{}); return; }
      yield {type:'text-delta',text:typeof reply==='string'?reply:JSON.stringify(reply?.value??reply)};
      yield {type:'finish',reason:{kind:reply?.finish??'stop'}};
    }};
  }};
  const ctx={get(name){if(name==='llm')return options.noLlm?undefined:llm;
    if(name==='agentDefaultModel')return {currentSelection:()=>({provider:'p',model:'m'})};
    if(name==='sessions')return {get:()=>({deriveMessages:()=> (options.history??[]).map(t=>({role:t.role,content:[{type:'text',text:t.text}]}))})};
  }};
  const controller=options.controller??new AbortController();
  const handlers=createHandlers(ctx,resolveConfig(options.config??{}),controller.signal,{readPrefs:()=>({context:true,preferences:'',provider:'',model:''})});
  const run=body=>handlers.enhance(new Request('http://local/api/prompt-craft/enhance',{method:'POST',body:JSON.stringify({protocolVersion:2,sessionId:'synthetic',...body})})).then(async r=>({http:r.status,...await r.json()}));
  return {run,handlers,inputs,llm,get calls(){return calls}};
}

test('v2 defaults use a ninety second total timeout and an absolute output bound',()=>{
  const c=resolveConfig({});assert.equal(c.timeoutMs,90000);assert.equal(c.maxOutputChars,12000);
});
test('an eight-character draft reaches both stages and produces execution guidance',async()=>{
  const f=fixture([plan(),output('分析现有代码的性能问题，针对主要瓶颈调整实现，并检查调整前后的行为是否一致。')]);
  const r=await f.run({draft:'帮我优化这段代码'});
  assert.equal(r.status,'ready');assert.equal(f.calls,2);assert.equal(r.meta.attempts,2);assert.equal(r.changes.length,1);
  assert.match(f.inputs[0].system,/STAGE: ANALYZE/);assert.match(f.inputs[1].system,/STAGE: GENERATE/);
});
test('critical questions are valid without a candidate or a generation call',async()=>{
  const f=fixture([plan({decision:'ask',questions:[{q:'这篇文章给谁看？',options:['同学','老师']}],improvements:[],reason:'受众会影响表达方式。'})]);
  const r=await f.run({draft:'帮我写一篇文章'});assert.equal(r.status,'needs_input');assert.deepEqual(r.candidates,[]);assert.equal(r.questions.length,1);assert.equal(f.calls,1);
});
test('complete short prompts are analyzed and preserved with a concrete reason',async()=>{
  const draft='用一句话解释 HTTP 403，不提供解决方案。';
  const f=fixture([plan({decision:'unchanged',improvements:[],reason:'已明确主题、篇幅和排除项。'})]);
  const r=await f.run({draft});assert.equal(r.status,'unchanged');assert.equal(r.candidates[0].text,draft);assert.equal(f.calls,1);assert.match(r.reason,/篇幅/);
});
test('specific exhaustion preserves the current version and disables that direction',async()=>{
  const text='说明闭包的概念，并用简短例子展示变量捕获。';
  const f=fixture([plan({decision:'unchanged',reason:'现有要求已经覆盖概念和例子。'})]);
  const r=await f.run({draft:'解释闭包',revise:{id:'clear',text,instruction:'specific'}});
  assert.equal(r.meta.specificExhausted,true);assert.equal(r.candidates[0].text,text);
});
test('continue mode stays general and does not ask again',async()=>{
  const f=fixture([plan(),output('围绕文章主题组织主要观点，使段落衔接自然，并检查表达是否清楚。')]);
  const r=await f.run({draft:'写篇文章',clarificationMode:'proceed'});assert.equal(r.status,'ready');assert.match(f.inputs[0].system,/Do NOT ask questions again/);
});
test('continue mode that still asks is repaired once or visibly rejected',async()=>{
  const ask=plan({decision:'ask',questions:[{q:'受众？'}]});
  const f=fixture([ask,ask]);const r=await f.run({draft:'写文章',clarificationMode:'proceed'});
  assert.equal(r.code,'INVALID_OUTPUT');assert.equal(f.calls,2);
});
test('confirmed answers, attachment names and only user history authorize facts',async()=>{
  const text='整理 report.md、slides.pdf 和 notes.txt 中的 12 条记录。';
  const body={draft:'整理资料',answers:[{q:'文件和数量?',a:'report.md，12 条记录'}],attachments:[{name:'slides.pdf'}]};
  const f=fixture([plan(),output(text)],{history:[{role:'user',text:'另有 notes.txt'}]});
  assert.equal((await f.run(body)).status,'ready');
  const g=fixture([plan(),output(text),output(text)],{history:[{role:'assistant',text:'可能有 notes.txt'}]});
  const r=await g.run(body);assert.equal(r.status,'blocked');assert.ok(r.violations.includes('invented:1'));assert.deepEqual(r.candidates,[]);
});
test('analysis facts and previous generated versions never authorize invented facts',async()=>{
  const text='修改 fabricated.py 的实现。';
  const f=fixture([plan({confirmedFacts:['fabricated.py']}),output(text),output(text)]);
  const r=await f.run({draft:'修改实现',revisionContext:{versions:[{text,operation:'specific'}]}});
  assert.equal(r.status,'blocked');assert.equal(f.calls,3);
});
test('missing restrictions are repaired or blocked without falling back to the original',async()=>{
  const draft='修复问题，不写测试。';const current='排查现有实现并修复问题，不写测试。';
  const f=fixture([plan(),output('排查并修复问题。'),output('排查现有实现并修复问题，不写测试。定位触发条件，检查修复是否覆盖该条件。')]);
  const r=await f.run({draft,revise:{id:'clear',text:current,instruction:'specific'}});
  assert.equal(r.status,'ready');assert.equal(r.meta.repaired,true);assert.equal(f.calls,3);
  const g=fixture([plan(),output('补充测试。'),output('补充测试。')]);
  const blocked=await g.run({draft,revise:{id:'clear',text:current,instruction:'specific'}});
  assert.equal(blocked.status,'blocked');assert.deepEqual(blocked.candidates,[]);assert.ok(blocked.violations.includes('constraint-missing'));
});
test('six pasted copies for a tiny draft fail the repetition check',async()=>{
  const duplicate='先分析现有实现，再优化代码。'.repeat(6);
  const f=fixture([plan(),output(duplicate),output(duplicate)]);
  const r=await f.run({draft:'优化代码'});assert.equal(r.status,'blocked');assert.ok(r.violations.includes('repetition'));assert.equal(f.calls,3);
});
test('same-direction revision cycles are blocked',async()=>{
  const text='解释闭包原理，并举例说明变量捕获。';
  const f=fixture([plan(),output(text),output(text)]);
  const r=await f.run({draft:'解释闭包',revise:{id:'clear',text:'解释闭包原理，并举例说明变量捕获和作用域。',instruction:'specific'},revisionContext:{versions:[{text,operation:'specific'}]}});
  assert.equal(r.status,'blocked');assert.ok(r.violations.includes('revision-cycle'));
});
test('shortening is allowed to revisit a version from a different direction',async()=>{
  const text='解释闭包原理，举例说明。';
  const f=fixture([plan(),output(text)]);
  const r=await f.run({draft:'解释闭包',revise:{id:'clear',text:'解释闭包原理，举例说明变量捕获如何保留外部作用域。',instruction:'shorter'},revisionContext:{versions:[{text,operation:'specific'}]}});
  assert.equal(r.status,'ready');
});
test('punctuation-only rewrites report no substantive improvement',async()=>{
  const f=fixture([plan(),output('解释闭包。')]);const r=await f.run({draft:'解释闭包'});
  assert.equal(r.status,'unchanged');assert.equal(r.candidates[0].text,'解释闭包');
});
test('a changed candidate must report implemented improvement ids',async()=>{
  const bad={candidates:[{text:'解释闭包，并说明捕获变量的方式。'}],changes:[{id:'not-planned',summary:'changed'}]};
  const f=fixture([plan(),bad,bad]);assert.equal((await f.run({draft:'解释闭包'})).status,'blocked');
});
test('malformed analysis uses one recovery and reserves the generation call',async()=>{
  const f=fixture(['{"decision":',plan(),output('总结材料的核心观点，并按内容关系组织结论。')]);
  const r=await f.run({draft:'总结材料'});assert.equal(r.status,'ready');assert.equal(f.calls,3);
});
test('format repair and quality repair share the same total allowance',async()=>{
  const bad=output('整理 invented.py。');const f=fixture(['{"decision":',plan(),bad]);
  const r=await f.run({draft:'整理资料'});assert.equal(r.status,'blocked');assert.equal(f.calls,3);
});
test('truncation recovery leaves a call for generation and never dispatches a fourth',async()=>{
  const f=fixture([{value:plan(),finish:'max-tokens'},plan(),{value:output('总结材料。'),finish:'max-tokens'}]);
  const r=await f.run({draft:'总结资料'});assert.equal(r.code,'OUTPUT_TRUNCATED');assert.equal(f.calls,3);
});
test('malformed candidate JSON never becomes an applicable prompt',async()=>{
  const f=fixture([plan(),'{"candidates":[','{"candidates":[']);const r=await f.run({draft:'整理报告'});
  assert.equal(r.code,'INVALID_OUTPUT');assert.equal(f.calls,3);
});
test('network failure during repair remains visible',async()=>{
  const f=fixture([plan(),output('修改 bad.py。'),new TypeError('network failed')]);
  const r=await f.run({draft:'修改代码'});assert.equal(r.ok,false);assert.match(r.message,/网络|network/i);
});
test('a stalled model is bounded by the operation timeout',async()=>{
  const f=fixture([{pending:true}],{config:{timeoutMs:15}});const r=await f.run({draft:'总结报告'});assert.equal(r.http,504);assert.equal(r.code,'TIMEOUT');
});
test('cancellation during generation prevents returning a result',async()=>{
  const controller=new AbortController();const f=fixture([plan(),{abort:controller}],{controller});
  assert.equal((await f.run({draft:'总结报告'})).code,'ABORTED');
});
test('unsupported clients get an explicit refresh message',async()=>{
  const f=fixture([]);const r=await f.run({draft:'整理报告',protocolVersion:undefined});assert.equal(r.http,409);assert.equal(r.code,'CLIENT_OUTDATED');assert.match(r.message,/刷新/);assert.equal(f.calls,0);
});
test('invalid input and missing services fail before any model call',async()=>{
  const f=fixture([]);
  assert.equal((await f.run({draft:'  '})).code,'EMPTY_DRAFT');
  assert.equal((await f.run({draft:'x'.repeat(6001)})).code,'DRAFT_TOO_LONG');
  assert.equal((await f.run({draft:'总结',revise:{text:'',instruction:'specific'}})).code,'BAD_REQUEST');
  assert.equal((await fixture([],{noLlm:true}).run({draft:'总结'})).code,'LLM_UNAVAILABLE');
});
test('actual body bytes are bounded without trusting content-length',async()=>{
  const f=fixture([]);const response=await f.handlers.enhance(new Request('http://local/api/prompt-craft/enhance',{method:'POST',body:' '.repeat(270000)}));
  assert.equal(response.status,413);assert.equal(f.calls,0);
});
test('answers beyond the old six-item limit remain available in both stages',async()=>{
  const answers=Array.from({length:10},(_,i)=>({q:'问题'+i,a:'确认'+i}));const f=fixture([plan(),output('整理资料，并核对内容是否完整。')]);
  const r=await f.run({draft:'整理资料',answers});assert.equal(r.meta.answersUsed,10);assert.ok(f.inputs.every(x=>x.messages[0].content[0].text.includes('确认9')));
});
test('settings remain compatible and lightweight reads avoid model catalogs',async()=>{
  const f=fixture([]);f.llm.listModels=()=>{throw Error('must not run')};
  const light=await f.handlers.settings(new Request('http://local/api/prompt-craft/settings?catalog=0')).then(r=>r.json());
  assert.equal(light.limits.timeoutMs,90000);assert.equal(light.catalog,undefined);
  const written=await f.handlers.settings(new Request('http://local/api/prompt-craft/settings',{method:'POST',body:JSON.stringify({preferences:'结论先行',context:false})})).then(r=>r.json());
  assert.equal(written.values.preferences,'结论先行');assert.equal(written.values.context,false);
});

test('analysis may not reopen answered questions or offer excluded activities',async()=>{
  for(const body of [
    {draft:'修复问题，不写测试。',questions:[{q:'是否补充测试？'}]},
    {draft:'整理资料',answers:[{q:'哪个文件？',a:'report.md'}],questions:[{q:'哪个文件？'}]},
  ]){
    const f=fixture([plan({decision:'ask',questions:body.questions}),plan({decision:'ask',questions:body.questions})]);
    const r=await f.run(body);assert.equal(r.code,'INVALID_OUTPUT');assert.equal(f.calls,2);
  }
});

test('shortening cannot silently drop facts confirmed in the clarification panel',async()=>{
  const f=fixture([plan(),output('整理报告。'),output('整理报告。')]);
  const r=await f.run({draft:'整理报告',answers:[{q:'哪个文件?',a:'report.md'}],revise:{id:'clear',text:'整理 report.md 中的材料，按内容关系组织。',instruction:'shorter'}});
  assert.equal(r.status,'blocked');assert.ok(r.violations.includes('confirmed-fact-missing'));
});

test('analysis cannot return unchanged while omitting newly confirmed facts',async()=>{
  const keep=plan({decision:'unchanged',reason:'Looks complete.'});
  const f=fixture([keep,plan(),output('整理 report.md 中的资料，核对主要内容是否完整。')]);
  const r=await f.run({draft:'整理资料',answers:[{q:'文件?',a:'report.md'}]});
  assert.equal(r.status,'ready');assert.equal(f.calls,3);
});
test('a generated no-progress result does not falsely report a repair',async()=>{
  const f=fixture([plan(),output('整理资料。')]);const r=await f.run({draft:'整理资料'});
  assert.equal(r.status,'unchanged');assert.equal(r.meta.repaired,false);
});

test('routine style questions do not block a contextual rewrite',async()=>{
  const f=fixture([plan({decision:'ask',questions:[{q:'结果希望以什么结构呈现？',why:'结构选择'}]}),plan(),output('按前文已经确认的依赖关系整理待办，保留原有事项。')],{history:[{role:'user',text:'上面列出了待办及依赖关系。'}]});
  const r=await f.run({draft:'整理待办'});assert.equal(r.status,'ready');assert.equal(f.calls,3);
});
test('material format choices and missing task subjects remain valid questions',async()=>{
  const f=fixture([plan({decision:'ask',questions:[{q:'输出格式是什么？',why:'转换必须确定目标格式'}]})]);
  assert.equal((await f.run({draft:'转换这个文件'})).status,'needs_input');
  const g=fixture([plan({decision:'ask',questions:[{q:'要分析什么对象？',why:'对象未知'},{q:'输出格式是什么？',why:'默认风格'}]})]);
  const r=await g.run({draft:'分析一下'});assert.equal(r.questions.length,1);assert.equal(r.questions[0].q,'要分析什么对象？');
});

test('return-contract questions and genuinely new material are not filtered as style',async()=>{
  const f=fixture([plan({category:'coding',decision:'ask',questions:[{q:'函数返回值需要什么结构？',why:'必须明确返回契约'}]})]);
  assert.equal((await f.run({draft:'实现这个函数'})).status,'needs_input');
  const g=fixture([plan({category:'coding',decision:'ask',questions:[{q:'请提供异常日志',why:'缺少触发异常的信息'}]})],{history:[{role:'user',text:'上面提供了函数代码。'}]});
  assert.equal((await g.run({draft:'排查这个异常'})).status,'needs_input');
});
