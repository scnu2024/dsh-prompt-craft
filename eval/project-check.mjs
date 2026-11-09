import { mkdtemp,writeFile,mkdir,rm,realpath } from 'node:fs/promises';
import { join,dirname,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';

export function projectEdits(task,answer){
 const value=JSON.parse(String(answer).trim().replace(/^```(?:json)?\s*\n/,'').replace(/\n```\s*$/,''));
 if(!value||!Array.isArray(value.files))throw Error('Expected JSON files array');
 const seen=new Set(),files={...task.project.files};
 for(const file of value.files){
  if(!file||typeof file.path!=='string'||typeof file.content!=='string'||!Object.hasOwn(files,file.path)||seen.has(file.path))throw Error('Invalid, duplicate or out-of-scope source path');
  if(file.content.length>100000)throw Error('Source file too large');
  seen.add(file.path);files[file.path]=file.content;
 }
 return files;
}
export async function checkProject(task,answer,binaries){
 let files;
 try{files=projectEdits(task,answer);}catch(error){return {pass:false,passed:0,total:1,failures:[error.message]};}
 const directory=await mkdtemp(join(tmpdir(),'prompt-craft-project-'));
 try{
  for(const [path,content] of Object.entries(files)){
   const target=resolve(directory,path);if(!target.startsWith(directory+'/'))throw Error('Path escape');
   await mkdir(dirname(target),{recursive:true});await writeFile(target,content);
  }
  const python=task.language==='python';
  const test=python?'check.py':'check.cjs';
  const source=python?'import sys,os\nsys.path.insert(0,os.getcwd())\n'+task.project.test:task.project.test;
  await writeFile(join(directory,test),source);
  const real=await realpath(directory);
  const profile=`(version 1)(allow default)(deny network*)(deny file-read* (subpath "/Users") (subpath "/System/Volumes/Data/Users") (subpath "/Volumes"))(deny file-write*)(allow file-write* (subpath ${JSON.stringify(real)}))(deny file-write* (literal ${JSON.stringify(join(real,test))}))`;
  const output=await new Promise((resolve,reject)=>{
   const child=spawn('/usr/bin/sandbox-exec',['-p',profile,python?binaries.python:binaries.node,...(python?['-I','-S',test]:[test])],{cwd:directory,env:{PATH:'/usr/bin:/bin',LANG:'en_US.UTF-8',TMPDIR:directory},stdio:['ignore','pipe','pipe']});
   let stdout='',stderr='';let exceeded=false;
   const timer=setTimeout(()=>{exceeded=true;child.kill('SIGKILL');},5000);
   child.stdout.on('data',b=>{stdout+=b;if(stdout.length>100000){exceeded=true;child.kill('SIGKILL');}});
   child.stderr.on('data',b=>{stderr+=b;if(stderr.length>100000){exceeded=true;child.kill('SIGKILL');}});
   child.on('error',e=>{clearTimeout(timer);reject(e);});
   child.on('close',code=>{clearTimeout(timer);if(code!==0||exceeded)reject(Error((exceeded?'Execution limit exceeded: ':'')+stderr.slice(0,4000)||'Execution failed: '+code));else resolve(stdout);});
  });
  return {pass:true,passed:1,total:1,failures:[],output:output.slice(0,2000)};
 }catch(error){return {pass:false,passed:0,total:1,failures:[error.message]};}
 finally{await rm(directory,{recursive:true,force:true});}
}
