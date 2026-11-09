import { hardConstraints, explicitRestrictions, instructionText } from './constraints.js';

/** Execution guidance is promoted only by independent outcome acceptance. */
export const TECHNICAL_POLICY_ENABLED = false;

export function selectTechnicalStrategy(raw) {
  const draft=String(raw??'');
  const restrictions=explicitRestrictions(draft);
  let positive=instructionText(draft);
  for(const clause of hardConstraints(draft))positive=positive.replace(clause,' ');
  const kinds=[];
  if(/修复|修好|排查|debug|fix|bug/iu.test(positive))kinds.push('debug');
  if(/修改|重构|优化.{0,8}(?:代码|函数|接口)|refactor|modify|change/iu.test(positive))kinds.push('modify');
  if(/实现|写.{0,10}(?:函数|代码|接口)|implement|write.{0,20}(?:function|code)|build/iu.test(positive))kinds.push('implement');
  if(/解释|什么是|简述|原理|为什么|分析|explain|what is|why|diagnos/iu.test(positive)||restrictions.noChanges||/(?:用|使用|以)(?:一|1)句话(?:解释|说明)|\bin one sentence\b/iu.test(draft))kinds.push('explain');
  const active=restrictions.noChanges?kinds.filter(x=>x==='explain'):kinds;
  const kind=active[0]??'none';
  const referential=/这个|这段|上述|上面|附件|为什么|为何|最后|该(?:函数|问题|代码)|\b(?:this|that|above|attached|why)\b/iu.test(draft);
  const simpleExplanation=active.length===1&&kind==='explain'&&draft.length<=120&&!referential&&!/[`\n]/u.test(draft)&&(/^(?:请)?(?:解释|什么是|简述)|^(?:what is|explain)\b/iu.test(draft)||/(?:用一句话|in one sentence)/iu.test(draft));
  const simpleFunction=active.length===1&&kind==='implement'&&draft.length<=180&&!referential&&/直接返回|返回\s*\w+\s*[+*]\s*\w+|\breturn\s+\w+\s*[+*]\s*\w+/iu.test(draft);
  return {kind,kinds:active,...restrictions,preserveOriginal:simpleExplanation||simpleFunction};
}

/** Compatibility export: complete candidates are never modified after generation. */
export function strengthenTechnicalPrompt(text) { return text; }

export function filterClarifyingQuestions(questions,draft) {
  if(!/只(?:返回|输出).*代码/u.test(draft))return questions;
  return questions.filter(q=>!/(?:是否|需要|要不要|需不需要).{0,20}(?:解释|说明)|(?:解释|说明).{0,20}(?:是否|需要)/u.test(q.q));
}

export function strategyInstructions(strategy) {
  if(strategy.kind==='none'||strategy.preserveOriginal)return '';
  const parts=['Technical task policy: improve execution only where the original request leaves an actionable gap. Preserve clear requests unchanged. Add no automatic checklist, fixed suffix, written plan, tools, test commands, metrics, dependencies or new deliverables. Keep every explicit restriction verbatim.'];
  if(strategy.kinds.includes('debug'))parts.push('For investigation and repair, concise guidance may connect the supplied code and logs to the cause, make a focused correction, and check the affected behavior. Add it only if useful and not already implied clearly. Never assert an unverified cause or mistake the assistant\'s previous hypothesis for confirmed evidence.');
  if(strategy.kinds.some(x=>x==='modify'||x==='implement'))parts.push('Respect existing interfaces and scope. Clarify only the actual missing relationship between the requested change and supplied implementation. Do not assume unspecified input types or add features.');
  if(strategy.kinds.includes('explain'))parts.push('Explain causes using available evidence. Do not downgrade an explicitly observed fact into an unconfirmed hypothesis. For explanation-only requests, add no repair, investigation steps or code changes.');
  if(strategy.noTests)parts.push('The user excluded tests. Do not add a requirement to write or run tests.');
  return parts.join('\n');
}
