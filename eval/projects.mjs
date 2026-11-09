// Hand-authored synthetic mini-projects. Private tests and reference fixes never reach a model.
const deliver='保持接口不变，不新增依赖。只返回 JSON 对象，格式为 {"files":[{"path":"相对路径","content":"修改后的完整内容"}]}，仅列出需要修改的源文件。';
function project(id,split,language,requirements,logs,files,reference,test){
 const context=`要求：${requirements}\n观测日志：${logs}\n源文件：\n${Object.entries(files).map(([p,s])=>`${p}\n${s}`).join('\n\n')}`;
 return {id,split,category:'fix',language,draft:'排查并修复这里的问题。'+deliver,context,turns:[{role:'user',text:`要求：${requirements}\n观测日志：${logs}`},...Object.entries(files).map(([p,s])=>({role:'user',text:p+'\n'+s}))],project:{files,reference,test}};
}
function js(id,split,requirements,logs,bad,good,test,helper='module.exports={};'){
 return project(id,split,'javascript',requirements,logs,{'main.cjs':bad,'support.cjs':helper},{'main.cjs':good},"const assert=require('node:assert/strict');const api=require('./main.cjs');\n(async()=>{\n"+test+"\n})().catch(e=>{console.error(e.stack);process.exitCode=1});");
}
function py(id,split,requirements,logs,bad,good,test,helper=''){
 return project(id,split,'python',requirements,logs,{'main.py':bad,'support.py':helper},{'main.py':good},'from main import *\n'+test);
}
function analysis(id,split,draft,context,rubric,category='analysis'){return {id,split,category,draft,context,rubric};}
const tasks=[];
// Development fixtures: separate failure mechanisms from the acceptance projects.
tasks.push(js('project-dev-inflight','dev','create(fetcher) 返回 load(key)。同 key 的进行中请求复用同一个 Promise；成功或失败后都允许新请求。','首个请求 reject 后，后续同 key 请求始终收到旧错误。',
`const {identity}=require('./support.cjs');exports.create=fetcher=>{const pending=new Map();return key=>{key=identity(key);if(!pending.has(key))pending.set(key,Promise.resolve().then(()=>fetcher(key)));return pending.get(key)}};`,
`const {identity}=require('./support.cjs');exports.create=fetcher=>{const pending=new Map();return key=>{key=identity(key);if(!pending.has(key)){const p=Promise.resolve().then(()=>fetcher(key));pending.set(key,p);const clear=()=>{if(pending.get(key)===p)pending.delete(key)};p.then(clear,clear)}return pending.get(key)}};`,
`let n=0;const load=api.create(async()=>{if(++n===1)throw Error('offline');return n});const p=load('a');assert.equal(load('a'),p);await assert.rejects(p);assert.equal(await load('a'),2);assert.equal(await load('a'),3);`,
`exports.identity=x=>x;`));
tasks.push(js('project-dev-query','dev','encode(params) 使用 support.escape，过滤 null 和 undefined；保留 0、false、空字符串，并按键排序。','false 和 0 的查询参数消失，服务端使用错误默认值。',
`const {escape}=require('./support.cjs');exports.encode=p=>Object.entries(p).filter(([k,v])=>v).map(([k,v])=>escape(k)+'='+escape(v)).join('&');`,
`const {escape}=require('./support.cjs');exports.encode=p=>Object.keys(p).sort().filter(k=>p[k]!==null&&p[k]!==undefined).map(k=>escape(k)+'='+escape(p[k])).join('&');`,
`assert.equal(api.encode({z:null,b:false,a:0,c:'',d:'x y'}),'a=0&b=false&c=&d=x%20y');assert.equal(api.encode({}),'');`,
`exports.escape=x=>encodeURIComponent(String(x));`));
tasks.push(js('project-dev-reference','dev','create(start,stop) 返回 acquire。首次 acquire 调 start，每个 acquire 返回独立且幂等的 release。最后一个 release 调 stop。','一个订阅者重复 release 导致其他订阅者的共享连接提前关闭。',
`require('./support.cjs');exports.create=(start,stop)=>{let count=0;return()=>{if(count++===0)start();return()=>{if(--count===0)stop()}}};`,
`require('./support.cjs');exports.create=(start,stop)=>{let count=0;return()=>{if(count++===0)start();let done=false;return()=>{if(done)return;done=true;if(--count===0)stop()}}};`,
`let starts=0,stops=0;const acquire=api.create(()=>starts++,()=>stops++);const a=acquire(),b=acquire();a();a();assert.equal(stops,0);b();b();assert.equal(stops,1);const c=acquire();assert.equal(starts,2);c();assert.equal(stops,2);`));
tasks.push(py('project-dev-default','dev','make_config(overrides) 从 support.DEFAULTS 生成独立嵌套配置，overrides 的字典递归合并，不修改两个输入。','第一次修改 retry.limit 后，后续默认配置也随之改变。',
`from support import DEFAULTS\ndef make_config(overrides):\n result=DEFAULTS.copy()\n for key,value in overrides.items():\n  if isinstance(value,dict): result[key].update(value)\n  else: result[key]=value\n return result`,
`from support import DEFAULTS\nfrom copy import deepcopy\ndef make_config(overrides):\n def merge(base,extra):\n  out=deepcopy(base)\n  for k,v in extra.items():\n   out[k]=merge(out[k],v) if isinstance(v,dict) and isinstance(out.get(k),dict) else deepcopy(v)\n  return out\n return merge(DEFAULTS,overrides)`,
`from support import DEFAULTS\nextra={'retry':{'limit':9}}\na=make_config(extra);a['retry']['limit']=99\nassert make_config({})['retry']['limit']==3\nassert extra=={'retry':{'limit':9}}\nassert DEFAULTS['retry']['delay']==1\nassert make_config({'retry':None})['retry'] is None`,
`DEFAULTS={'retry':{'limit':3,'delay':1},'enabled':True}`));
tasks.push(py('project-dev-generator','dev','summarize(rows) 可接收一次性迭代器，返回 count 和 amount 总和；每条行只消费一次。','列表输入正确，生成器输入的金额总是零。',
`from support import amount\ndef summarize(rows):\n return {'count':sum(1 for _ in rows),'amount':sum(amount(r) for r in rows)}`,
`from support import amount\ndef summarize(rows):\n count=total=0\n for row in rows: count+=1;total+=amount(row)\n return {'count':count,'amount':total}`,
`assert summarize(iter([{'amount':2},{'amount':3}]))=={'count':2,'amount':5}\nassert summarize(iter([]))=={'count':0,'amount':0}`,
`def amount(row): return row['amount']`));
tasks.push(py('project-dev-money','dev','total(lines) 的 price 是十进制字符串，qty 是整数；每行金额先按 ROUND_HALF_UP 四舍五入至分，再求和，返回两位小数字符串。','两行 price=0.105、qty=1，返回 0.21，预期 0.22。',
`from support import rows\ndef total(lines):\n return format(sum(float(x['price'])*x['qty'] for x in rows(lines)),'.2f')`,
`from support import rows\nfrom decimal import Decimal,ROUND_HALF_UP\ndef total(lines):\n value=sum((Decimal(x['price'])*x['qty']).quantize(Decimal('.01'),rounding=ROUND_HALF_UP) for x in rows(lines))\n return format(value,'.2f')`,
`assert total([{'price':'0.105','qty':1}]*2)=='0.22'\nassert total([])=='0.00'\nassert total([{'price':'-0.105','qty':1}])=='-0.11'`,
`def rows(lines): return iter(lines)`));
tasks.push(analysis('project-dev-closure','dev','解释这里为什么串值，只解释，不改代码。','for (var i=0;i<3;i++) setTimeout(()=>send(i),0)。send 收到 3,3,3。',['共享同一个 var 绑定','回调执行时循环结束','不提供改动代码']));
tasks.push(analysis('project-dev-await','dev','分析为什么接口先返回成功，后台才报错，不修改代码。','async function handle(){ save(); return {ok:true} }。save 是 async，稍后 reject。',['save 返回 Promise','handle 没有等待或关联拒绝','不声称数据库必然损坏']));
tasks.push(analysis('project-dev-concept','dev','什么是闭包？','无额外上下文。',['解释函数及其词法环境','不要求排查项目或运行测试'],'control'));
tasks.push({id:'project-dev-add',split:'dev',category:'control',language:'javascript',name:'add',draft:'实现 JavaScript 函数 add(a,b)，直接返回 a+b。只输出函数代码，不添加解释或测试。',context:'输入为数值，返回两数之和。',tests:[{args:[2,3],expected:5},{args:[0,-1],expected:-1}]});
// Acceptance fixtures are frozen before the first development model call.
tasks.push(js('project-accept-race','accept','create(fetcher,render) 返回 search(query)。只有最近发起的请求允许 render；每次 search 仍返回自己请求的数据。拒绝照常向调用者传播。','先搜索 A 后 B，B 先完成，A 后完成时界面变回 A。',
`const {read}=require('./support.cjs');exports.create=(fetcher,render)=>async q=>{const data=await read(fetcher,q);render(data);return data};`,
`const {read}=require('./support.cjs');exports.create=(fetcher,render)=>{let version=0;return async q=>{const own=++version;const data=await read(fetcher,q);if(own===version)render(data);return data}};`,
`const pending={},shown=[];const search=api.create(q=>new Promise((r,j)=>pending[q]={r,j}),x=>shown.push(x));const a=search('A'),b=search('B');pending.B.r('new');assert.equal(await b,'new');pending.A.r('old');assert.equal(await a,'old');assert.deepEqual(shown,['new']);const c=search('C');pending.C.j(Error('offline'));await assert.rejects(c);assert.deepEqual(shown,['new']);`,
`exports.read=(fetcher,q)=>fetcher(q);`));
tasks.push(js('project-accept-cache','accept','create(fetcher) 返回 load(tenant,user,path)。缓存按三个字符串共同隔离；字段可含分隔符；缓存 null 等值；失败不缓存。','tenant 相同、path 相同的第二个用户拿到第一个用户的响应。',
`const {key}=require('./support.cjs');exports.create=fetcher=>{const cache=new Map();return async(t,u,p)=>{const k=key(p);if(cache.has(k))return cache.get(k);const value=await fetcher(t,u,p);cache.set(k,value);return value}};`,
`const {key}=require('./support.cjs');exports.create=fetcher=>{const cache=new Map();return async(t,u,p)=>{const k=JSON.stringify([t,u,key(p)]);if(cache.has(k))return cache.get(k);const value=await fetcher(t,u,p);cache.set(k,value);return value}};`,
`let n=0;const load=api.create(async(t,u,p)=>{n++;return u==='none'?null:[t,u,p]});assert.deepEqual(await load('t','a','/me'),['t','a','/me']);assert.deepEqual(await load('t','b','/me'),['t','b','/me']);await load('t','none','/me');await load('t','none','/me');assert.equal(n,3);assert.notDeepEqual(await load('a|b','c','d'),await load('a','b|c','d'));`,
`exports.key=path=>path;`));
tasks.push(js('project-accept-listener','accept','mount(bus,data,render) 注册 change 监听，返回幂等 close。close 后不再 render，并移除本次 mount 的全部监听；其他面板正常。','反复打开关闭后 bus 上 listener 数量增长，旧 data 仍被引用。',
`const {event}=require('./support.cjs');exports.mount=(bus,data,render)=>{bus.on(event,()=>render(data));return()=>bus.off(event,()=>render(data))};`,
`const {event}=require('./support.cjs');exports.mount=(bus,data,render)=>{const listener=()=>render(data);bus.on(event,listener);let closed=false;return()=>{if(closed)return;closed=true;bus.off(event,listener)}};`,
`const {EventEmitter}=require('node:events');const bus=new EventEmitter(),seen=[];const a=api.mount(bus,'a',x=>seen.push(x)),b=api.mount(bus,'b',x=>seen.push(x));a();a();bus.emit('change');assert.deepEqual(seen,['b']);assert.equal(bus.listenerCount('change'),1);b();assert.equal(bus.listenerCount('change'),0);`,
`exports.event='change';`));
tasks.push(js('project-accept-retry','accept','request(send,options) 最多调用两次，仅 GET、HEAD 或具有非空 idempotencyKey 的请求允许在 status=503 时重试。method 大小写不敏感，缺省 GET；其他状态或异常不重试。','POST 创建订单在 503 后重复发送，创建两笔订单。',
`const {method}=require('./support.cjs');exports.request=async(send,options={})=>{let r=await send(options);if(r.status===503)r=await send(options);return r};`,
`const {method}=require('./support.cjs');exports.request=async(send,options={})=>{let r=await send(options);const m=method(options);if(r.status===503&&(['GET','HEAD'].includes(m)||!!options.idempotencyKey))r=await send(options);return r};`,
`for(const [o,want] of [[{method:'POST'},1],[{method:'get'},2],[{method:'POST',idempotencyKey:'x'},2],[{},2]]){let n=0;await api.request(async()=>({status:++n===1?503:200}),o);assert.equal(n,want)}let n=0;await assert.rejects(api.request(async()=>{n++;throw Error('network')},{method:'GET'}));assert.equal(n,1);`,
`exports.method=o=>(o.method??'GET').toUpperCase();`));
tasks.push(js('project-accept-config','accept','build(overrides) 只合并顶层和 retry 的字段，返回独立配置；结果、defaults、overrides 之间不得共享可变对象；保留 false 和 0。','某次调用把 retry.limit 改为 9，下一次默认值也变成 9。',
`const {defaults}=require('./support.cjs');exports.build=(o={})=>{const result={...defaults,...o};Object.assign(result.retry,o.retry||{});return result};`,
`const {defaults}=require('./support.cjs');exports.build=(o={})=>{const base=structuredClone(defaults),extra=structuredClone(o);return {...base,...extra,retry:{...base.retry,...extra.retry}}};`,
`const input={retry:{limit:0},enabled:false};const a=api.build(input);assert.equal(a.retry.limit,0);assert.equal(a.enabled,false);a.retry.delay=99;assert.equal(api.build().retry.delay,1);assert.equal(input.retry.delay,undefined);const b=api.build();b.retry.limit=9;assert.equal(api.build().retry.limit,3);`,
`exports.defaults={retry:{limit:3,delay:1},enabled:true};`));
tasks.push(js('project-accept-batch','accept','run(items,worker,limit) 按输入顺序返回异步 worker 的结果；同时运行数不超过正整数 limit，空输入返回 []；worker 失败则拒绝。','慢任务排到结果末尾，并且 limit=2 时观察到超过两个并发 worker。',
`require('./support.cjs');exports.run=async(items,worker,limit)=>{const out=[];await Promise.all(items.map(async x=>{out.push(await worker(x))}));return out};`,
`require('./support.cjs');exports.run=async(items,worker,limit)=>{const out=new Array(items.length);let next=0;await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(next<items.length){const i=next++;out[i]=await worker(items[i])}}));return out};`,
`let active=0,peak=0;const out=await api.run([3,1,2,0],async x=>{peak=Math.max(peak,++active);await new Promise(r=>setTimeout(r,x*3));active--;return x*2},2);assert.deepEqual(out,[6,2,4,0]);assert.ok(peak<=2);assert.deepEqual(await api.run([],()=>{throw Error('never')},2),[]);await assert.rejects(api.run([1],async()=>{throw Error('bad')},1));`));
tasks.push(py('project-accept-ttl','accept','Cache(clock,ttl) 的 clock 是注入的秒数函数。get(key,loader) 在 now < expires 时命中，包括 None；到期时重新加载；loader 异常不缓存。','clock 正好到期时仍读旧值；None 反复触发 loader。',
`from support import entry\nclass Cache:\n def __init__(self,clock,ttl): self.clock=clock;self.ttl=ttl;self.values={}\n def get(self,key,loader):\n  value,expires=self.values.get(key,(None,0))\n  if value and self.clock()<=expires:return value\n  value=loader();self.values[key]=entry(value,self.clock()+self.ttl);return value`,
`from support import entry\nclass Cache:\n def __init__(self,clock,ttl): self.clock=clock;self.ttl=ttl;self.values={}\n def get(self,key,loader):\n  now=self.clock()\n  if key in self.values:\n   value,expires=self.values[key]\n   if now<expires:return value\n  value=loader();self.values[key]=entry(value,self.clock()+self.ttl);return value`,
`t=[0];calls=[0]\ndef load(): calls[0]+=1;return None\nc=Cache(lambda:t[0],5)\nassert c.get('a',load) is None\nt[0]=4;assert c.get('a',load) is None;assert calls[0]==1\nt[0]=5;c.get('a',load);assert calls[0]==2\ndef fail(): raise ValueError('bad')\ntry:c.get('x',fail)\nexcept ValueError:pass\nassert c.get('x',lambda:7)==7`,
`def entry(value,expires):return (value,expires)`));
tasks.push(py('project-accept-pages','accept','collect(fetch) 从页号 1 开始。fetch 返回 {items,next}；next 是下一页号或 None，可返回空 items 但仍有 next；每页只请求一次，保持顺序。','第一页为空但 next=2，后面有效记录完全丢失。',
`from support import rows\ndef collect(fetch):\n page=1;out=[]\n while True:\n  result=fetch(page)\n  if not rows(result):break\n  out.extend(rows(result));page+=1\n return out`,
`from support import rows\ndef collect(fetch):\n page=1;out=[]\n while page is not None:\n  result=fetch(page);out.extend(rows(result));page=result['next']\n return out`,
`calls=[]\npages={1:{'items':[],'next':3},3:{'items':[4,5],'next':8},8:{'items':[6],'next':None}}\ndef fetch(p):calls.append(p);return pages[p]\nassert collect(fetch)==[4,5,6];assert calls==[1,3,8]\nassert collect(lambda p:{'items':[],'next':None})==[]`,
`def rows(result):return result['items']`));
tasks.push(py('project-accept-transfer','accept','transfer(store,source,target,amount) 修改余额字典，金额必须正数，余额足够。任一 store.set 失败时恢复整个 store.balances 原值并继续抛出异常。成功时两个余额正确。','第二次 set 失败后，付款方已扣款而收款方未入账。',
`from support import validate\ndef transfer(store,source,target,amount):\n validate(store,source,amount)\n store.set(source,store.balances[source]-amount)\n store.set(target,store.balances.get(target,0)+amount)`,
`from support import validate\ndef transfer(store,source,target,amount):\n validate(store,source,amount)\n before=dict(store.balances)\n try:\n  store.set(source,store.balances[source]-amount)\n  store.set(target,store.balances.get(target,0)+amount)\n except Exception:\n  store.balances.clear();store.balances.update(before);raise`,
`class Store:\n def __init__(self,fail=False):self.balances={'a':10,'b':1};self.n=0;self.fail=fail\n def set(self,k,v):\n  self.n+=1\n  if self.fail and self.n==2:raise RuntimeError('disk')\n  self.balances[k]=v\ns=Store(True)\ntry:transfer(s,'a','b',3);assert False\nexcept RuntimeError:pass\nassert s.balances=={'a':10,'b':1}\ns=Store();transfer(s,'a','b',3);assert s.balances=={'a':7,'b':4}\ntry:transfer(s,'a','b',0);assert False\nexcept ValueError:pass`,
`def validate(store,source,amount):\n if amount<=0 or store.balances.get(source,0)<amount:raise ValueError('amount')`));
tasks.push(py('project-accept-timezone','accept','elapsed(start,end) 接受带 UTC 偏移的 ISO 日期时间字符串，返回真实经过秒数，包括跨时区与负值。不得去掉时区后直接相减。','相同瞬间 10:00+08:00 与 02:00+00:00 得到 -28800 秒。',
`from support import parse\ndef elapsed(start,end):return (parse(end).replace(tzinfo=None)-parse(start).replace(tzinfo=None)).total_seconds()`,
`from support import parse\ndef elapsed(start,end):return (parse(end)-parse(start)).total_seconds()`,
`assert elapsed('2025-01-01T10:00:00+08:00','2025-01-01T02:00:00+00:00')==0\nassert elapsed('2025-01-01T23:30:00-02:00','2025-01-02T02:00:00+00:00')==1800\nassert elapsed('2025-01-01T03:00:00+00:00','2025-01-01T02:00:00+00:00')==-3600`,
`from datetime import datetime\ndef parse(text):return datetime.fromisoformat(text)`));
tasks.push(py('project-accept-callbacks','accept','make_jobs(records,send) 返回无参回调列表，每个回调发送创建时对应记录的 id；records 后续变化不影响已创建 job；保持顺序。','所有 job 都发送最后一个 id，且修改原 records 后 job 也跟着变化。',
`from support import identifier\ndef make_jobs(records,send):\n jobs=[]\n for record in records:jobs.append(lambda:send(identifier(record)))\n return jobs`,
`from support import identifier\ndef make_jobs(records,send):\n jobs=[]\n for record in records:\n  value=identifier(record);jobs.append(lambda value=value:send(value))\n return jobs`,
`seen=[];records=[{'id':1},{'id':2}];jobs=make_jobs(records,seen.append);records[0]['id']=9\nfor job in jobs:job()\nassert seen==[1,2]\nassert make_jobs([],seen.append)==[]`,
`def identifier(record):return record['id']`));
tasks.push(py('project-accept-dedup','accept','process(events,apply) 按字符串 id 去重，成功 apply 后才记录已处理；失败的事件可在同次列表后续重复位置重试；返回成功的 id 顺序，apply 异常仅跳过本次。','第一次 apply 临时失败后，后续同 id 永久跳过，事件丢失。',
`from support import event_id\ndef process(events,apply):\n seen=set();done=[]\n for event in events:\n  key=event_id(event)\n  if key in seen:continue\n  seen.add(key)\n  try:apply(event);done.append(key)\n  except Exception:pass\n return done`,
`from support import event_id\ndef process(events,apply):\n seen=set();done=[]\n for event in events:\n  key=event_id(event)\n  if key in seen:continue\n  try:apply(event)\n  except Exception:continue\n  seen.add(key);done.append(key)\n return done`,
`calls=[]\ndef apply(e):\n calls.append(e['id'])\n if len(calls)==1:raise RuntimeError('transient')\nassert process([{'id':'x'},{'id':'x'},{'id':'y'},{'id':'x'}],apply)==['x','y']\nassert calls==['x','x','y']\nassert process([],apply)==[]`,
`def event_id(event):return event['id']`));
tasks.push(analysis('project-accept-plan','accept','解释为什么这个查询没有按预期使用索引，只基于这些证据，不提供改动代码。','SQLite 有索引 (account_id,created_at)，查询只有 WHERE created_at>?。EXPLAIN QUERY PLAN 为 SCAN events。未提供统计信息或索引提示。',['查询缺少最左列条件','观测结果是扫描','不能断言所有数据库在任何条件下都不支持后续列','不猜测索引损坏']));
tasks.push(analysis('project-accept-ownership','accept','排查关闭弹窗后旧数据还在内存中的原因，只解释，不修改代码。','mount 注册 window resize 监听，回调捕获 data；close 仅移除 DOM。堆快照路径 Window -> listener -> closure -> data。',['监听器未解除','闭包让 data 可达','删除 DOM 不移除 Window 上监听','不把 GC 不及时当已证实原因']));
tasks.push(analysis('project-accept-auth','accept','根据已有日志分析串用户原因，不要直接断言其他故障。','cache key 为 path。用户 A GET /me 后 MISS，用户 B GET /me 后 HIT 且得到 A 内容。绕过缓存分别直连时均正确。',['键不区分用户','给定 HIT 日志证明缓存复用','不能把命中事实降级为需要确认的猜测','不能断言后端鉴权损坏']));
tasks.push(analysis('project-accept-order','accept','分析日志为什么显示已完成后又报写入失败，只解释，不改代码。','async function submit(){ writeFileAsync(); log("done") }。writeFileAsync 返回 Promise，100ms 后 reject，日志先 done 后 unhandled rejection。',['没有等待 Promise','done 对应调用发起而非落盘成功','错误未关联处理','不输出修复代码']));
tasks.push(analysis('project-accept-status','accept','用一句话解释 HTTP 403，不提供解决方案。','无额外上下文。',['理解请求但拒绝授权访问','一句话','不提供日志排查建议'],'control'));
tasks.push(analysis('project-accept-constant','accept','只解释为什么下面输出 2，不改代码，不写测试。','const box={n:1}; const alias=box; alias.n=2; console.log(box.n);',['alias 与 box 指向同一对象','修改同一对象的 n','不提供改动代码或测试'],'control'));
tasks.push({id:'project-accept-add',split:'accept',category:'control',language:'javascript',name:'add',draft:'实现 JavaScript 函数 add(a,b)，直接返回 a+b。只输出函数代码，不添加解释或测试。',context:'输入为数值，返回和。',tests:[{args:[2,3],expected:5},{args:[0,-1],expected:-1}]});
tasks.push({id:'project-accept-square',split:'accept',category:'control',language:'python',name:'square',draft:'实现 Python 函数 square(x)，返回 x*x。只输出函数代码，不添加解释或测试。',context:'输入为数值，返回平方。',tests:[{args:[3],expected:9},{args:[-2],expected:4}]});
export const cases=tasks;
if(cases.length!==30||cases.filter(x=>x.split==='accept').length!==20)throw Error('Project suite split invalid');
