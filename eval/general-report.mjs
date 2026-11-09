export function summarizeGeneral(records, expected) {
  const all=records.flatMap(r=>r.steps);
  const judged=all.filter(s=>s.result?.ok && ['ready','needs_input','unchanged'].includes(s.result.status));
  const short=records.filter(r=>r.task.underSpecified);
  const useful=short.filter(r=>['ready','needs_input'].includes(r.steps[0]?.result?.status)&&r.steps[0].judgments?.length===2&&r.steps[0].judgments.every(j=>j.useful===true)).length;
  const violations=all.reduce((n,s)=>n+(s.deterministicViolations?.length??0)+(s.judgments??[]).reduce((m,j)=>m+(j.newFacts?.length??0)+(j.lostRestrictions?.length??0)+(j.repetition?1:0),0),0);
  const failures=all.filter(s=>!s.result?.ok||!['ready','needs_input','unchanged'].includes(s.result.status)||s.judgeError||s.judgments?.some(j=>j.acceptable!==true)).length;
  const controls=records.filter(r=>r.task.control);
  const controlRegressions=controls.filter(r=>!r.steps[0]?.judgments?.every(j=>j.acceptable===true)).length;
  const complete=records.length===expected && all.length>0 && judged.every(s=>s.judgments?.length===2);
  const rate=short.length?useful/short.length:0;
  return {complete,tasks:records.length,expected,steps:all.length,shortPrompts:short.length,usefulShortPrompts:useful,usefulRate:rate,violations,failures,controlRegressions,passed:complete&&rate>=.9&&violations===0&&failures===0&&controlRegressions===0};
}
export function generalMarkdown(report){
  let out='# 通用提示词打磨评测\n\n'+JSON.stringify(report.summary,null,2)+'\n\n';
  out+='有用性和语义事实风险由同一模型的两次独立评审判断，顺序交换；确定性检查独立保留。这些结果描述本题集观察，不代表所有输入。\n\n';
  for(const r of report.records){out+='## '+r.task.id+'\n\n原文：'+r.task.draft+'\n\n';for(const s of r.steps)out+='操作：'+s.operation+'；状态：'+(s.result.status??s.result.code)+'\n\n'+(s.result.candidates?.[0]?.text??JSON.stringify(s.result.questions))+'\n\n原因：'+(s.result.reason??s.result.message)+'\n\n评审：'+JSON.stringify(s.judgments??s.judgeError)+'\n\n';}
  return out;
}
