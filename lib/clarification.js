/** Keep clarification focused on decisions that block a faithful instruction. */
export function focusClarification(analysis, input) {
  if (!analysis || analysis.decision !== 'ask') return analysis;
  const explicitlyFormatting = /转成|转为|转换|导出|格式|\b(?:convert|export|format)\b/iu.test(input.draft);
  const supplied = input.history.filter(turn => turn.role === 'user' && /上面|上文|前面|此前|已(?:经)?(?:提供|给出|列出)|already (?:provided|supplied)|above/iu.test(turn.text)).map(turn=>turn.text).join('\n');
  const questions = analysis.questions.filter(question => {
    const text = question.q;
    const routine = /详细程度|篇幅|语气|怎样呈现|怎么呈现|如何呈现|(?:输出|呈现|结果).{0,12}(?:形式|格式|结构)|(?:什么|哪种).{0,8}(?:格式|结构)|\b(?:verbosity|tone|presentation format|output format)\b/iu.test(text);
    const requestsMaterial = /请提供|能否提供|粘贴|贴出|上传|发来|\b(?:paste|upload|provide)\b/iu.test(text) && /正文|材料|记录|事项|列表|代码|证明|日志|\b(?:text|material|record|list|code|proof|log)\b/iu.test(text);
    const materialContract = analysis.category === 'coding' && /函数|返回值|接口|输入|schema|json|csv|payload/iu.test(text);
    const sameMaterial = [[/代码|code/iu,/代码|函数|模块|code|function/iu], [/记录|日志|record|log/iu,/记录|日志|record|log/iu], [/事项|列表|清单|待办|list/iu,/事项|列表|清单|待办|list/iu], [/证明|proof/iu,/证明|proof/iu], [/正文|材料|text|material/iu,/正文|材料|文字|邮件|文案|text|material/iu]].some(([questionType, suppliedType])=>questionType.test(text) && suppliedType.test(supplied));
    return !(routine && !explicitlyFormatting && !materialContract) && !(sameMaterial && requestsMaterial);
  });
  if (!questions.length) return undefined;
  if (questions.length === analysis.questions.length) return analysis;
  return {...analysis, questions, reason:questions.map(q=>q.why || q.q).join(' ').slice(0,500)};
}
