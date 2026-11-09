export function summarize(records, expectedPairs = records.length) {
  const completed=records.filter(x=>x.round!==undefined);
  const code=completed.filter(x=>x.task.tests);
  const rates={};
  for(const arm of ['original','baseline','candidate']){
    const scored=code.filter(x=>x.answers[arm]);
    if(scored.length) rates[arm]={passed:scored.filter(x=>x.answers[arm].check?.pass).length,total:scored.length,rate:scored.filter(x=>x.answers[arm].check?.pass).length/scored.length};
  }
  const comparisons=completed.map(x=>x.comparison).filter(Boolean);
  const wins=comparisons.filter(x=>x.winner==='candidate').length;
  const losses=comparisons.filter(x=>x.winner==='original').length;
  const analysis=completed.filter(x=>!x.task.tests);
  const analysisWins=analysis.filter(x=>x.comparison?.winner==='candidate').length;
  const analysisLosses=analysis.filter(x=>x.comparison?.winner==='original').length;
  const violations=completed.reduce((n,x)=>n+(x.answers.candidate?.violations?.length??0),0);
  const controlRegressions=completed.filter(x=>x.task.category==='control'&&x.comparison?.winner==='original').length;
  const improvement=rates.candidate&&rates.original ? rates.candidate.rate-rates.original.rate : null;
  const complete=completed.length===expectedPairs;
  const passed=complete&&completed.length>0&&improvement>=0.10&&violations===0&&analysisWins>analysisLosses&&controlRegressions===0;
  return {pairs:completed.length,expectedPairs,complete,rates,wins,losses,ties:comparisons.filter(x=>x.winner==='tie').length,uncertain:comparisons.filter(x=>x.winner==='uncertain').length,analysisWins,analysisLosses,violations,controlRegressions,improvement,passed,conclusion:passed?'达到本轮验收标准':'收益尚未证实'};
}

export function markdown(report) {
  const s=report.summary;
  const ended=report.finished??Math.max(report.started,...report.calls.map(c=>c.started+(c.elapsedMs??0)));
  const lines=['# 技术提示词真实效果评测','',`结论：**${s.conclusion}**`,'',`数据集：${report.split}；样例哈希：${report.suiteHash}；已完成对比：${s.pairs}。`,`回答模型：${report.route.provider}/${report.route.model}；推理：${report.effort}；回答上限：${report.maxTokens} tokens。`,`调用量：${report.calls.length}；总耗时：${((ended-report.started)/1000).toFixed(1)} 秒。`,'','| 版本 | 代码题通过次数 | 通过率 |','|---|---:|---:|'];
  for(const [arm,r] of Object.entries(s.rates))lines.push(`| ${arm} | ${r.passed}/${r.total} | ${(r.rate*100).toFixed(1)}% |`);
  if(report.regrade)lines.push('',`统计修正：${report.regrade.reason}`,`原始报告：${report.regrade.source}；SHA256：${report.regrade.sourceSha256}；额外模型调用：0。`,`原始统计：${JSON.stringify(report.regrade.originalSummary)}`);
  lines.push('',`打磨版胜出 ${s.wins} 次，退步 ${s.losses} 次，持平 ${s.ties} 次，不确定 ${s.uncertain} 次。`,`分析题胜出 ${s.analysisWins} 次，退步 ${s.analysisLosses} 次；候选约束违例 ${s.violations} 项；对照组退步 ${s.controlRegressions} 次。`,'','本报告覆盖固定合成任务；代码以预先固定的测试为准，分析采用匿名交换顺序复判。相同模型评审存在相关性，不能代替独立人工判断。失败和超时保留在分母内。','');
  for(const r of report.records){
    lines.push(`## ${r.task.id} / 第 ${r.round+1} 轮`,'',`原提示词：${r.task.draft}`,'',`打磨结果：${r.rewrites.candidate?.text??r.rewrites.candidate?.error??'未生成'}`,'',`比较：${r.comparison?.winner??'未完成'}`,'');
    for(const [arm,a] of Object.entries(r.answers))lines.push(`### ${arm}`,'',a.error?`调用失败：${a.error}`:a.text,'',a.check?`代码测试：${a.check.passed}/${a.check.total}；${a.check.failures.join('；')}`:'',a.violations?.length?`约束违例：${a.violations.join('；')}`:'','');
    if(r.comparison?.judgments)lines.push('复判明细：',...r.comparison.judgments.map(j=>JSON.stringify(j)),'');
  }
  return lines.join('\n');
}
