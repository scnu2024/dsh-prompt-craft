/** Development evaluation controls promotion of the technical policy. */
export const TECHNICAL_POLICY_ENABLED = false;

export function selectTechnicalStrategy(raw) {
  const draft = String(raw ?? '');
  const noChanges = /只(?:需|要)?解释|仅(?:需|要)?解释|不(?:要|用|需|能)?(?:修改|改动|改)代码|explain only|only explain|do not (?:modify|change)|without (?:changing|modifying)/iu.test(draft);
  const noTests = /不(?:要|用|需|写|加|运行).{0,6}测试|无需测试|不要测|no tests|without tests|do not (?:add|write|run) tests/iu.test(draft);
  let kind = 'none';
  if (noChanges || /解释|什么是|简述|原理|为什么|分析原因|explain|what is|why|diagnos/iu.test(draft)) kind = 'explain';
  else if (/修复|修好|报错|异常|排查|debug|fix|bug|错误/iu.test(draft)) kind = 'debug';
  else if (/修改|重构|优化.{0,8}(?:代码|函数|接口)|refactor|modify|change/iu.test(draft)) kind = 'modify';
  else if (/实现|写.{0,10}(?:函数|代码|接口)|implement|write.{0,20}(?:function|code)|build/iu.test(draft)) kind = 'implement';
  const preserveOriginal = kind === 'explain' && draft.length <= 96 && !/[`\n]/u.test(draft) && !/这个|这段|上述|为什么|为何|this|that|above|why/iu.test(draft) && /^(?:请)?(?:解释|什么是|简述)|^(?:what is|explain)\b/iu.test(draft);
  return { kind, noChanges, noTests, preserveOriginal };
}

/** A concise task-derived procedure, never a fabricated environmental fact. */
export function strengthenTechnicalPrompt(text, draft, material = '') {
  const strategy = selectTechnicalStrategy(draft);
  if (strategy.kind === 'none' || strategy.preserveOriginal || /直接返回|返回\s*\w+\s*[+*]\s*\w+/u.test(draft)) return text;
  let guidance = '';
  if (strategy.kind === 'implement' || strategy.kind === 'modify') guidance = '实现时核对输入类型所隐含的边界行为，遵守用户要求的接口和输入数据修改约定，最终只交付原请求要求的内容。';
  if (strategy.kind === 'debug') guidance = '先依据现有代码和现象定位原因，针对原因作必要修改，遵守用户要求的接口，并在内部核对受影响的行为。';
  if (strategy.kind === 'explain') guidance = '按现象、证据与原因的关联进行解释，区分已知事实和推测；信息不足时明确指出依据的边界。';
  const jsObjectKeys = /javascript|\bjs\b/iu.test(material) && /词频|按.{0,5}(?:id|键)去重|任意字符串键|arbitrary.*keys/iu.test(material);
  if (jsObjectKeys && ['implement','debug','modify'].includes(strategy.kind)) guidance += '将输入中的字符串键当作数据处理，注意它们可能与对象原型属性同名，不能把继承属性当作已有数据。';
  if (!/[\u3400-\u9fff]/u.test(draft)) {
    guidance = {
      implement: 'Check boundary behavior implied by the input types, respect the requested interface and mutation contract, and deliver only the requested output.',
      modify: 'Check boundary behavior implied by the input types, respect the requested interface and mutation contract, and deliver only the requested output.',
      debug: 'Connect the supplied evidence to the cause, make the necessary correction within the requested interface, and internally verify the affected behavior.',
      explain: 'Connect observations, evidence, and causes; distinguish established facts from hypotheses and state the limits of the available evidence.',
    }[strategy.kind] ?? '';
    if (jsObjectKeys && ['implement','debug','modify'].includes(strategy.kind)) guidance += ' Treat input string keys as data, including keys that collide with inherited object properties.';
  }
  if (strategy.noChanges && strategy.kind !== 'explain') return text;
  if (!guidance || text.includes(guidance)) return text;
  return text + '\n\n' + guidance;
}

export function filterClarifyingQuestions(questions, draft) {
  if (!/只(?:返回|输出).*代码/u.test(draft)) return questions;
  return questions.filter(q=>!/(?:是否|需要|要不要|需不需要).{0,20}(?:解释|说明)|(?:解释|说明).{0,20}(?:是否|需要)/u.test(q.q));
}

export function strategyInstructions(strategy) {
  if (strategy.kind === 'none' || strategy.preserveOriginal) return '';
  const common = 'Technical task policy: add only useful execution guidance implied by this request. Existing restrictions and requested output format take precedence. Do not invent files, dependencies, tools, environments, metrics, or acceptance criteria. Avoid boilerplate; do not demand a written plan for a simple task.';
  const instruction = {
    debug: 'Ask the executor to connect the symptom to the supplied evidence, check the relevant existing implementation, address the cause rather than hide the symptom, preserve the existing contract, and verify the reported behavior. Consider ownership and implicit state only when the supplied code suggests them. If the request asks for diagnosis, stop at an evidence-based diagnosis instead of adding a requirement to implement a fix. Do not assert a cause before investigation.',
    modify: 'Ask the executor to understand the relevant implementation and call sites, preserve existing public behavior outside the requested change, make a focused modification, and verify the affected behavior.',
    implement: 'Ask the executor to implement the requested interface using the supplied context, account for boundary cases implied by the input types and language semantics, and check that the implementation meets the original requirements. Identify the relevant representation risk, such as arbitrary string keys in objects, falsey values, numeric precision, or ownership of mutable inputs, only when the task makes it applicable. Mention the applicable check concisely; do not paste this checklist or invent extra features.',
    explain: 'Focus on causal reasoning backed by the supplied code, logs or documented facts. Distinguish observations from hypotheses, avoid premature certainty, and do not turn a request for explanation into a code modification.',
  }[strategy.kind];
  return [common, instruction, strategy.noTests ? 'The user excluded tests. Do not add a requirement to write or run tests, or suggest a workaround that violates that restriction.' : 'If verification is useful, leave its exact method to the existing project context. Do not invent test commands or libraries.', strategy.noChanges ? 'The user excluded code changes. Request explanation only.' : ''].filter(Boolean).join('\n');
}
