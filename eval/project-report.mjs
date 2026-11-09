import {markdown} from './report.mjs';
export function summarizeProjects(records,expectedPairs){
 const code=records.filter(x=>x.task.tests||x.task.project);
 const rates={};for(const arm of ['original','baseline','candidate']){
  const scored=code.filter(x=>x.answers[arm]);const passed=scored.filter(x=>x.answers[arm].check?.pass).length;
  rates[arm]={passed,total:scored.length,rate:scored.length?passed/scored.length:0};
 }
 const changed=x=>x.rewrites.candidate?.text!==x.task.draft;
 const evidence=records.filter(changed);
 const count=winner=>evidence.filter(x=>x.comparison.winner===winner).length;
 const analysis=evidence.filter(x=>x.task.category==='analysis');
 const analysisWins=analysis.filter(x=>x.comparison.winner==='candidate').length,analysisLosses=analysis.filter(x=>x.comparison.winner==='original').length;
 const violations=records.reduce((n,x)=>n+(x.answers.candidate?.violations?.length??0),0);
 const controlRegressions=evidence.filter(x=>x.task.category==='control'&&(x.comparison.winner==='original'||x.baselineComparison?.winner==='original')).length;
 const improvement=rates.candidate.rate-rates.original.rate;
 const creditedImprovement=code.filter(changed).reduce((n,x)=>n+Number(!!x.answers.candidate.check?.pass)-Number(!!x.answers.original.check?.pass),0)/(code.length||1);
 const complete=records.length===expectedPairs&&records.every(x=>['original','baseline','candidate'].every(arm=>x.answers[arm]));
 const passed=complete&&improvement>=.10&&creditedImprovement>=.10&&rates.candidate.rate>=rates.baseline.rate&&violations===0&&analysisWins>analysisLosses&&controlRegressions===0;
 return {pairs:records.length,expectedPairs,complete,rates,wins:count('candidate'),losses:count('original'),ties:count('tie'),uncertain:count('uncertain'),unchanged:records.length-evidence.length,analysisWins,analysisLosses,violations,controlRegressions,improvement,creditedImprovement,passed,conclusion:passed?'达到本轮验收标准':'收益尚未证实'};
}
export function projectMarkdown(report){
 let output=markdown(report);
 const s=report.summary;
 output=output.replace('打磨版胜出',`与原提示词相同的 ${s.unchanged} 对单独保留，胜负不归因于打磨。可归因的代码通过率差为 ${(s.creditedImprovement*100).toFixed(1)} 个百分点。\n\n打磨版胜出`);
 output+='\n\n# 当前生产基线与原文保留明细\n\n';
 for(const r of report.records)output+=`## ${r.task.id} / ${r.round+1}\n\n基线打磨：${r.rewrites.baseline.text??r.rewrites.baseline.error}\n\n对比当前生产基线：${JSON.stringify(r.baselineComparison)}\n\n原文保留：${r.rewrites.candidate.text===r.task.draft}\n\n`;
 return output;
}
