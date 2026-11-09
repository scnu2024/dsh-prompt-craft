// Replay saved answers only. This entry never connects to DSH or calls a model.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { checkCode } from './check.mjs';
import { summarize, markdown } from './report.mjs';

const input=resolve(process.argv[2]??'eval/reports/acceptance-v1/results.json');
const directory=resolve(process.argv[3]??'eval/reports/acceptance-v1-regraded');
if(input===join(directory,'results.json'))throw new Error('Regrading must preserve the original report');
const raw=await readFile(input,'utf8');
const report=JSON.parse(raw);
report.regrade={source:input,sourceSha256:createHash('sha256').update(raw).digest('hex'),originalSummary:report.summary,reason:'Python returned sequences use JSON normalization, matching the JSON fixtures and JavaScript grader. The task did not require lists rather than tuples. No task, expected output, prompt, answer or model judgment changed.',at:new Date().toISOString(),additionalModelCalls:0,changes:[]};
for(const record of report.records){
  if(!record.task.tests)continue;
  for(const [arm,answer] of Object.entries(record.answers)){
    if(answer.error||!answer.text)continue;
    const previous=answer.check;
    answer.check=await checkCode(record.task,answer.text,{node:process.execPath,python:process.env.DSH_EVAL_PYTHON??'/Library/Developer/CommandLineTools/usr/bin/python3'});
    if(JSON.stringify(previous)!==JSON.stringify(answer.check))report.regrade.changes.push({id:record.task.id,round:record.round,arm,previous,current:answer.check});
  }
  // Preserve constraint and call-failure precedence from the frozen run.
  if(record.comparison.reason==='Executable tests take precedence'){
    const a=record.answers.original.check.pass,b=record.answers.candidate.check.pass;
    record.comparison={winner:a===b?'tie':b?'candidate':'original',reason:'Executable tests take precedence'};
  }
}
report.summary=summarize(report.records,report.summary.expectedPairs);
await mkdir(directory,{recursive:true});
await writeFile(join(directory,'results.json'),JSON.stringify(report,null,2));
await writeFile(join(directory,'REPORT.md'),markdown(report));
console.log(JSON.stringify({summary:report.summary,changes:report.regrade.changes.length,additionalModelCalls:0},null,2));
