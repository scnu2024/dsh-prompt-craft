/** Conservative protection of explicit instructions, independent of task intent. */
export function instructionText(raw) {
  return String(raw ?? '').replace(/```[^\n]*\n[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ');
}

export function hardConstraints(raw) {
  const body = instructionText(raw);
  const patterns = [
    /(?:只|仅)(?:需|要)?(?:解释|分析|输出|返回|基于|依据|使用|采用|调整|纠正|保留|列出)[^，。；;\n!?！？]{0,70}/gu,
    /(?:不(?:要|用|需|得|能)?(?:写|加|添加|新增|修改|改动|改|提供|提出|给出|推断|假设|估算|推荐|安排|举例|展开|跳步|省略|遗漏|补充|补造|捏造|输出|运行|改变|引入|重构)|无需)[^，。；;\n!?！？]{0,70}/gu,
    /保持[^，。；;\n]{0,30}(?:不变|原样)/gu,
    /(?:接口|API|输入|内容|行为|签名)[^，。；;\n]{0,15}(?:不变|保持原样)/gu,
    /(?:用|使用|以)(?:一|1)句话[^，。；;\n]{0,60}/gu,
    /\b(?:do not|don't|without|no)\s+(?:add(?:ing)?|writ(?:e|ing)|run(?:ning)?|chang(?:e|ing)|modify(?:ing)?|tests?\b|new dependenc)[^.\n;!?]{0,100}/giu,
    /\b(?:only (?:explain|analy[sz]e|return|output)|(?:explain|code) only|keep [^.\n;!?]{0,40} unchanged|in (?:one|1) sentence)[^.\n;!?]{0,100}/giu,
  ];
  return [...new Set(patterns.flatMap(re=>[...body.matchAll(re)].map(m=>m[0].trim())))];
}

export function explicitRestrictions(raw) {
  const text=hardConstraints(raw).join('\n');
  return {
    noChanges: /只(?:需|要)?(?:解释|分析)|仅(?:需|要)?(?:解释|分析)|不(?:要|用|需|得|能)?(?:修改|改动|改)代码|only (?:explain|analy[sz]e)|explain only|do not (?:modify|change)|without (?:changing|modifying)/iu.test(text),
    noTests: /(?:不|无需)[^\n]{0,50}测试|(?:no|without) tests|do not (?:add|write|run)[^\n]{0,30}tests/iu.test(text),
    noDependencies: /(?:不|无需)[^\n]{0,40}依赖|(?:no|without)[^\n]{0,30}dependenc|do not (?:add|introduce)[^\n]{0,30}dependenc/iu.test(text),
    noSolution: /不(?:要)?(?:提供|提出|给出|给)[^\n]{0,10}(?:解决|修复|改进)(?:方案|建议)|no solutions?|do not (?:provide|suggest)[^\n]{0,20}(?:fix|solution)/iu.test(text),
  };
}

export function constraintViolations(draft, candidate) {
  const normalize=s=>s.toLowerCase().replace(/[\s，,。.;；!?！？]/gu,'');
  const normalized=normalize(candidate);
  const missing=hardConstraints(draft).filter(clause=>!normalized.includes(normalize(clause)));
  const restrictions=explicitRestrictions(draft);
  const positive=instructionText(candidate).replace(/(?:不(?:要|用|需|得|能)?|无需|未|没有|禁止|只|仅)[^，。；;\n!?！？]*/gu,' ').replace(/\b(?:do not|don't|without|never|not|no|only)\b[^.\n;!?]*/giu,' ');
  const conflicts=[];
  if(restrictions.noTests&&/(?:编写|补充|添加|新增|运行|执行).{0,8}测试|\b(?:write|add|run)\s+(?:\w+\s+){0,2}tests/iu.test(positive))conflicts.push('新增测试要求');
  if(restrictions.noChanges&&/(?:修改|改动|重写|修复).{0,8}(?:代码|函数|实现)|\b(?:modify|change|rewrite|fix)\s+(?:the\s+)?(?:code|function|implementation)/iu.test(positive))conflicts.push('新增代码修改要求');
  if(restrictions.noDependencies&&/(?:安装|引入|添加|新增).{0,8}(?:依赖|库)|\b(?:install|add|introduce)\s+(?:\w+\s+){0,2}(?:dependency|dependencies|library)/iu.test(positive))conflicts.push('新增依赖要求');
  if(restrictions.noSolution&&/(?:查看|检查|查阅).{0,12}(?:日志|响应体)|(?:提供|提出|给出|补充).{0,8}(?:修复|解决|改进)(?:方案|建议)/iu.test(positive))conflicts.push('新增排查或解决建议');
  return {missing,conflicts};
}
