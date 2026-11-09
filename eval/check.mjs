import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

export function extractCode(answer) {
  const blocks = [...String(answer).matchAll(/```[^\n]*\n([\s\S]*?)```/g)];
  return blocks.length ? blocks.map(x=>x[1]).join('\n').trim() : String(answer).trim();
}

export function constraintViolations(task, answer) {
  const violations = [];
  if (/只(?:返回|输出).*代码/u.test(task.draft)) {
    const rest = String(answer).replace(/```[^\n]*\n[\s\S]*?```/g, '').trim();
    if (answer.includes('```') && rest) violations.push('代码以外的解释');
  }
  if (/不添加.*测试/u.test(task.draft) && /\b(?:assert|unittest|pytest|describe\s*\(|test\s*\()/u.test(extractCode(answer))) violations.push('用户排除的测试代码');
  if (/只解释|不修改代码|不改动代码/u.test(task.draft) && /```(?:js|javascript|python|py)?\s*\n[\s\S]*?(?:function |def |const |let )/u.test(answer)) violations.push('用户排除的修改代码');
  return violations;
}

const jsDriver = `const fs=require('node:fs'),vm=require('node:vm');
const data=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const code=fs.readFileSync(process.argv[3],'utf8').replace(/export\\s+default\\s+/g,'').replace(/export\\s+/g,'');
const context=vm.createContext({console:{log(){}},module:{exports:{}},exports:{}});
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
let result={passed:0,total:data.tests.length,failures:[]};
try {vm.runInContext(code+'\\n;globalThis.__target='+data.name,context,{timeout:1000});
for(const t of data.tests){const before=JSON.stringify(t.args);context.__args=JSON.parse(before);try{
const value=vm.runInContext('__target(...__args)',context,{timeout:1000});
if(JSON.stringify(canonical(value))!==JSON.stringify(canonical(t.expected))) throw Error('Unexpected return: '+JSON.stringify(value));
if(data.immutable&&JSON.stringify(context.__args)!==before) throw Error('Input mutated');result.passed++;
}catch(e){result.failures.push(String(e.message));}}}catch(e){result.failures.push(String(e.message));}
process.stdout.write(JSON.stringify(result));`;

const pyDriver = `import json,sys\ndata=json.load(open(sys.argv[1]));source=open(sys.argv[2]).read();scope={};result={'passed':0,'total':len(data['tests']),'failures':[]}\ntry:\n exec(compile(source,'candidate.py','exec'),scope)\n for t in data['tests']:\n  args=json.loads(json.dumps(t['args']));before=json.dumps(args,sort_keys=True)\n  try:\n   value=scope[data['name']](*args)\n   assert json.dumps(value,sort_keys=True)==json.dumps(t['expected'],sort_keys=True), 'Unexpected return: '+repr(value)\n   if data.get('immutable'): assert json.dumps(args,sort_keys=True)==before, 'Input mutated'\n   result['passed']+=1\n  except Exception as e: result['failures'].append(str(e))\nexcept Exception as e: result['failures'].append(str(e))\nprint(json.dumps(result))\n`;

export async function checkCode(task, answer, executables) {
  const dir = await mkdtemp(join(tmpdir(), 'prompt-craft-case-'));
  const realDir = await import('node:fs/promises').then(x=>x.realpath(dir));
  const lang = task.language === 'python' ? 'python' : 'javascript';
  const binary = lang === 'python' ? executables.python : executables.node;
  const driver = join(dir, lang === 'python' ? 'driver.py' : 'driver.cjs');
  const candidate = join(dir, lang === 'python' ? 'candidate.py' : 'candidate.js');
  const data = join(dir, 'case.json');
  await Promise.all([writeFile(driver,lang==='python'?pyDriver:jsDriver),writeFile(candidate,extractCode(answer)),writeFile(data,JSON.stringify(task))]);
  // OS sandbox: no network, no user document access, writes only inside this case directory.
  const profile = `(version 1)(allow default)(deny network*)(deny file-read* (subpath "/Users") (subpath "/System/Volumes/Data/Users") (subpath "/Volumes"))(deny file-write*)(allow file-write* (subpath ${JSON.stringify(realDir)}))`;
  const args = lang === 'python' ? ['-I','-S',driver,data,candidate] : [driver,data,candidate];
  try {
    const output = await new Promise((resolve,reject)=>{
      const child=spawn('/usr/bin/sandbox-exec',['-p',profile,binary,...args],{cwd:dir,env:{PATH:'/usr/bin:/bin',TMPDIR:dir,LANG:'en_US.UTF-8'},stdio:['ignore','pipe','pipe']});
      let stdout='',stderr='';const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Code execution timeout'));},5000);
      child.stdout.on('data',b=>{stdout+=b;if(stdout.length>100000)child.kill('SIGKILL');});child.stderr.on('data',b=>{stderr+=b;if(stderr.length>100000)child.kill('SIGKILL');});
      child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',status=>{clearTimeout(timer);if(status!==0)reject(new Error(stderr.slice(0,2000)||'Code execution failed (status '+status+')'));else resolve(stdout);});
    });
    const result=JSON.parse(output.trim().split('\n').at(-1));return {...result,pass:result.passed===result.total};
  } catch(error) { return {passed:0,total:task.tests.length,pass:false,failures:[error.message]}; }
  finally { await rm(dir,{recursive:true,force:true}); }
}
