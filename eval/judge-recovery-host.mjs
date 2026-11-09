/** Replay malformed judge outputs only. Original reports remain immutable. */
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {summarizeGeneral,generalMarkdown} from './general-report.mjs';

export async function recoverJudges(ctx,directory){
  const report=JSON.parse(await readFile(join(directory,'results.json'),'utf8'));
  const originalSummary=report.summary;
  const recoveries=[];
  for(const record of report.records)for(const step of record.steps){
    if(!step.judgeError)continue;
    for(const reverse of [false,true]){
      if(step.judgments.some(j=>j.reverse===reverse))continue;
      if(recoveries.length>=3)throw Error('Judge recovery limit exceeded');
      const original={draft:record.task.draft,confirmedAnswers:step.request.answers,history:record.task.history??[]};
      const outcome={status:step.result.status,text:step.result.candidates?.[0]?.text,questions:step.result.questions};
      const text=JSON.stringify({operation:step.operation,...(reverse?{outcome,original}:{original,outcome})});
      const failed=report.calls.find(c=>c.label===record.task.id+':judge'&&c.input?.messages?.[0]?.content?.[0]?.text===text);
      if(!failed)throw Error('Exact failed judge input not found');
      const log={task:record.task.id,operation:step.operation,reverse,originalError:step.judgeError,originalOutput:failed.output,input:failed.input,started:Date.now(),output:''};
      recoveries.push(log);
      const signal=AbortSignal.timeout(90000);
      const prepared=await ctx.get('llm').prepareCall({...report.route,maxTokens:2400},signal,(controls,info)=>{
        const ids=info.reasoning?.efforts?.map(x=>typeof x==='string'?x:x.id)??[];
        const effort=['off','low'].find(id=>ids.includes(id));return {...controls,...(effort?{reasoningEffort:effort}:{})};
      });
      log.config={provider:prepared.config.provider,model:prepared.config.model,maxTokens:prepared.config.maxTokens,reasoningEffort:prepared.config.reasoningEffort};
      for await(const chunk of prepared.stream({...prepared.config,...failed.input,signal})){
        if(chunk.type==='text-delta')log.output+=chunk.text;
        if(chunk.type==='finish')log.finish=chunk.reason;
      }
      if(log.finish&&log.finish.kind!=='stop')throw Error('Recovery finish: '+JSON.stringify(log.finish));
      const j=JSON.parse(log.output.trim().replace(/^```(?:json)?\s*/u,'').replace(/\s*```$/u,''));
      if(typeof j.useful!=='boolean'||typeof j.acceptable!=='boolean'||!Array.isArray(j.newFacts)||!Array.isArray(j.lostRestrictions)||typeof j.repetition!=='boolean')throw Error('Invalid recovered judge schema');
      log.elapsedMs=Date.now()-log.started;step.judgments.push({...j,reverse,recovered:true});
    }
    step.originalJudgeError=step.judgeError;delete step.judgeError;
  }
  report.judgeRecoveries=recoveries;report.originalSummary=originalSummary;
  report.summary=summarizeGeneral(report.records,report.summary.expected);
  await writeFile(join(directory,'recovered-results.json'),JSON.stringify(report,null,2));
  await writeFile(join(directory,'RECOVERED-REPORT.md'),generalMarkdown(report));
  return {originalSummary,recoveries:recoveries.length,summary:report.summary};
}
