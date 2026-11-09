// Fixed synthetic tasks. Expected answers and tests are never sent to the rewriter or executor.
function code(id, split, category, language, name, spec, source, tests, extra = {}) {
  const draft = category === 'fix' ? '修复这个函数，保持接口不变，只返回代码。' : '实现这个函数，只输出代码，遵守现有接口。';
  return { id, split, category, language, name, draft, context: `语言：${language}。接口：${name}。要求：${spec}\n现有代码：\n${source}`, tests: tests.map(([args, expected]) => ({ args, expected })), ...extra };
}
function analysis(id, split, draft, context, rubric) { return { id, split, category: 'analysis', draft, context, rubric }; }
function control(id, split, draft, context, rubric) { return { ...analysis(id, split, draft, context, rubric), category: 'control' }; }

export const cases = [
  code('dev-fix-zero', 'dev', 'fix', 'javascript', 'readValue', '读取对象的 value；仅 null 或 undefined 使用 fallback，其他值原样保留。', 'function readValue(obj, fallback) { return obj.value || fallback; }', [[[ {value:0},9],0],[[{value:false},9],false],[[{},9],9],[[{value:''},9],'']]),
  code('dev-fix-default', 'dev', 'fix', 'python', 'append_item', '将 item 加入本次调用的独立列表并返回；显式传入列表时在该列表上追加。', 'def append_item(item, items=[]):\n    items.append(item)\n    return items', [[[1],[1]],[[2],[2]],[[3,[0]],[0,3]]]),
  code('dev-fix-binary', 'dev', 'fix', 'javascript', 'search', '在升序数组中查找 target，返回下标，缺失时返回 -1。', 'function search(a,t) { let l=0,r=a.length-1; while(l<r){let m=(l+r)>>1;if(a[m]<t)l=m+1;else r=m;} return a[l]===t?l:-1; }', [[[[],3],-1],[[[1],1],0],[[[1,3,7],7],2],[[[1,3,7],2],-1]]),
  code('dev-impl-chunks', 'dev', 'implement', 'python', 'chunks', '按 size 分块；size 非正数返回空列表；输入为空返回空列表；不修改输入。', 'def chunks(values, size):\n    pass', [[[[1,2,3,4,5],2],[[1,2],[3,4],[5]]],[[[],2],[]],[[[1],0],[]]], { immutable: true }),
  code('dev-impl-count', 'dev', 'implement', 'javascript', 'countWords', '统计字符串按空白分隔的词频，大小写不敏感，返回普通对象；空字符串返回空对象。', 'function countWords(text) {}', [[[' A a B '],{a:2,b:1}],[[''],{}],[['constructor __proto__ constructor'],{constructor:2,['__proto__']:1}]]),
  code('dev-impl-rotate', 'dev', 'implement', 'python', 'rotate', '将列表向右旋转 k 位，k 可为负数或大于长度，空列表仍为空；不修改输入。', 'def rotate(values, k):\n    pass', [[[[1,2,3],1],[3,1,2]],[[[1,2,3],-1],[2,3,1]],[[[],3],[]]], { immutable: true }),
  analysis('dev-analysis-closure','dev','解释为什么最后都输出同一个值，只解释，不改代码。','JavaScript: for (var i=0;i<3;i++) setTimeout(()=>console.log(i),0); 实际打印 3,3,3。',['var 为函数作用域，共享同一个绑定','回调执行时循环已经结束','不得提供修改后的代码']),
  analysis('dev-analysis-race','dev','分析这段异步代码偶尔覆盖新数据的原因，不修改代码。','两次搜索分别发出 A、B 请求，A 较慢；每次请求完成后直接 setResults(response)。输入先 A 后 B，最后显示 A。',['完成顺序与发起顺序不同','较早请求晚到覆盖新结果','证据限定于给出的请求次序，不断言服务端故障']),
  control('dev-control-concept','dev','什么是闭包？','无额外上下文。',['解释函数持有其词法环境','不要求修改项目或运行测试']),
  control('dev-control-format','dev','用一句话解释 HTTP 404，不给解决办法。','无额外上下文。',['表示请求的资源未找到','只用一句话','不提供排查或修复步骤']),

  code('accept-fix-unique','accept','fix','javascript','uniqueById','按 id 去重，保留首次出现的对象及顺序，id 可为 0、空字符串或字符串；不修改输入。','function uniqueById(xs){const seen={};return xs.filter(x=>x.id&&!seen[x.id]&&(seen[x.id]=true));}', [[[[{id:0,v:1},{id:0,v:2},{id:'',v:3},{id:'constructor',v:4}]],[{id:0,v:1},{id:'',v:3},{id:'constructor',v:4}]],[[[]],[]]],{immutable:true}),
  code('accept-fix-merge','accept','fix','javascript','mergeRanges','合并相交或接触的闭区间并按起点排序；不得修改输入数组或其中的区间。','function mergeRanges(a){a.sort((x,y)=>x[0]-y[0]);const out=[];for(const r of a){const p=out.at(-1);if(p&&r[0]<=p[1])p[1]=Math.max(p[1],r[1]);else out.push(r)}return out}', [[[[[5,6],[1,3],[3,5]]],[[1,6]]],[[[]],[]],[[[[1,2],[4,5]]],[[1,2],[4,5]]]],{immutable:true}),
  code('accept-fix-get','accept','fix','javascript','getPath','按点分隔的路径读取嵌套字段；不存在时返回 fallback，已有的 0、false、空字符串或 null 原样返回。空路径返回整个对象。','function getPath(obj,path,fallback){return path.split(".").reduce((x,k)=>x&&x[k],obj)||fallback}', [[[{a:{b:0}},'a.b',9],0],[[{a:false},'a',9],false],[[{a:null},'a',9],null],[[{a:1},'',9],{a:1}],[[{},'x.y',9],9]]),
  code('accept-fix-flatten','accept','fix','python','flatten','递归展开 list 类型，其他类型包括字符串当作原子元素；不修改输入。','def flatten(xs):\n    out=[]\n    for x in xs:\n        if hasattr(x,"__iter__"):\n            out.extend(flatten(x))\n        else:\n            out.append(x)\n    return out', [[[[1,[2,[],['ab']],3]],[1,2,'ab',3]],[[[]],[]]],{immutable:true}),
  code('accept-fix-page','accept','fix','python','page','page_number 从 1 开始；返回对应 size 个元素，page_number 或 size 非正数返回空列表；不得修改输入。','def page(values, page_number, size):\n    return values[page_number*size:(page_number+1)*size]', [[[[1,2,3,4,5],1,2],[1,2]],[[[1,2,3],2,2],[3]],[[[1],0,2],[]],[[[],1,2],[]]],{immutable:true}),
  code('accept-fix-median','accept','fix','python','median','返回数值列表的中位数，偶数长度取中间两项平均；空列表返回 None；不得修改输入。','def median(xs):\n    xs.sort()\n    return xs[len(xs)//2]', [[[[3,1,2]],2],[[[4,1,3,2]],2.5],[[[]],null]],{immutable:true}),
  code('accept-impl-version','accept','implement','javascript','compareVersions','比较点分隔的非负整数版本段，缺失的尾段按零处理；返回 -1、0 或 1。版本段数值可超过安全整数范围，须精确比较。','function compareVersions(a,b) {}', [[['1.2','1.2.0'],0],[['1.10','1.2'],1],[['9007199254740993','9007199254740992'],1],[['0002.0','2'],0]]),
  code('accept-impl-csv','accept','implement','javascript','parseCsvRow','解析单行 CSV，逗号分列，双引号包围的字段可含逗号，连续双引号表示一个字面引号；保留空字段；空行表示一个空字段。','function parseCsvRow(line) {}', [[['a,"b,c","d""e",'],['a','b,c','d"e','']],[[''],['']],[['"",x'],['','x']]]),
  code('accept-impl-pointer','accept','implement','javascript','jsonPointer','按 JSON Pointer 读取，解码 ~1 为 /、~0 为 ~；空指针返回原对象，不存在返回 fallback，保留 null 和 false。','function jsonPointer(obj,pointer,fallback) {}', [[[{"a/b":{"~x":false}},'/a~1b/~0x',9],false],[[{a:null},'/a',9],null],[[{a:1},'',9],{a:1}],[[{},'/missing',9],9]]),
  code('accept-impl-lru','accept','implement','python','lru','接收 capacity 和操作列表，每项为 ["put",key,value] 或 ["get",key]。返回所有 get 的结果；缺失返回 -1，get 和 put 均更新最近使用顺序，满容量淘汰最久未使用项，capacity 为零时不存储。','def lru(capacity, operations):\n    pass', [[[2,[['put','a',1],['put','b',2],['get','a'],['put','c',3],['get','b'],['get','c']]],[1,-1,3]],[[0,[['put','x',1],['get','x']]],[-1]],[[1,[['put','x',1],['put','x',2],['get','x']]],[2]]]),
  code('accept-impl-group','accept','implement','python','group_records','按 key 分组，返回 [[分组值,记录列表],...]；分组值可为列表等不可哈希对象，按相等性分组，保留首次出现的分组顺序和组内顺序。','def group_records(records, key):\n    pass', [[[[{k:[1],v:1},{k:[2],v:2},{k:[1],v:3}],'k'],[[[1],[{k:[1],v:1},{k:[1],v:3}]],[[2],[{k:[2],v:2}]]]],[[[],'k'],[]]]),
  code('accept-impl-diff','accept','implement','python','subtract_ranges','从半开区间列表 intervals 中减去半开区间 cut，输出剩余非空区间；保留输入顺序且不修改输入。','def subtract_ranges(intervals, cut):\n    pass', [[[[[0,10],[12,15]],[3,7]],[[0,3],[7,10],[12,15]]],[[[[0,3]],[3,5]],[[0,3]]],[[[[1,2]],[0,3]],[]]],{immutable:true}),
  analysis('accept-analysis-memory','accept','为什么反复打开再关闭面板后内存持续增加？只分析给出的证据，不提供改动代码。','mount 时 window.addEventListener("resize", () => refresh(data)); close 只移除面板 DOM；堆快照中 Window listener 持有闭包，闭包持有旧 data。',['事件监听器仍挂在 Window','闭包保留 data 使其可达','移除 DOM 不会自动移除该监听器','不编造精确内存数值或其他泄漏来源']),
  analysis('accept-analysis-index','accept','解释这条查询为什么没有按预期使用索引，只基于给出的信息。','SQLite 索引为 (tenant_id, created_at)。查询 WHERE created_at > ?，没有 tenant_id 条件。EXPLAIN QUERY PLAN 显示 SCAN events。',['复合索引的最左列条件缺失','执行计划已显示全表扫描','不得声称所有数据库在所有条件下都不能使用后续索引列']),
  analysis('accept-analysis-promise','accept','这段代码为什么 catch 没抓住错误？只解释，不修改代码。','function work(){ try { Promise.reject(new Error("bad")); } catch(e){ console.log("caught"); } } 实际出现 unhandled rejection。',['try/catch 捕获同步抛出','Promise 拒绝在异步链中传播，当前代码没有等待','不输出修复代码']),
  analysis('accept-analysis-cache','accept','排查缓存为什么串用户，先根据现有证据分析，不要直接断言其他故障。','缓存键仅包含 path；两个用户用不同 Authorization 请求同一个 path；第二个用户命中第一个用户的响应；来源服务直接请求时返回正确。',['缓存键没有区分用户授权身份','给定的命中过程足以解释串用户','来源服务直接请求正确，不应先断言来源服务鉴权错误']),
  control('accept-control-closure','accept','什么是闭包？','无额外上下文。',['解释词法作用域及环境捕获','不强加项目排查与测试流程']),
  control('accept-control-status','accept','用一句话解释 HTTP 403，不提供解决方案。','无额外上下文。',['服务端拒绝访问或权限不足','只用一句话','不列排查或修改步骤']),
  {...code('accept-control-add','accept','implement','javascript','add','接收两个数并返回和。','function add(a,b) {}', [[[2,3],5],[[0,-1],-1]]), category:'control', draft:'实现 JavaScript 函数 add(a, b)，直接返回 a + b。只输出函数代码，不添加解释或测试。'},
  {...code('accept-control-square','accept','implement','python','square','接收数值 x 并返回 x 的平方。','def square(x):\n    pass', [[[3],9],[[-2],4]]), category:'control', draft:'实现 Python 函数 square(x)，返回 x*x。只输出函数代码，不添加解释或测试。'},
];

if (cases.length !== 30 || cases.filter(x=>x.split==='dev').length !== 10) throw new Error('Invalid fixed suite');
