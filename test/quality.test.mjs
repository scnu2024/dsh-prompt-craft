import assert from 'node:assert/strict';
import test from 'node:test';
import { detectViolations } from '../lib/gate.js';
import { buildSystemPrompt, buildUserContent } from '../lib/prompt.js';
import { parseEnvelope } from '../lib/protocol.js';

const faithful = [
  ['中文短句', '总结这段话', '概括这段话的内容。'],
  ['English', 'Make this email clearer, keep it polite.', 'Rewrite this email clearly and politely.'],
  ['多步请求', '先检查报告的数据再整理结论，别改数据', '先检查报告中的数据，再整理结论。保留原始数据。'],
  ['代码引用', '检查 `parseEnvelope`，用 `npm test` 验证', '检查 `parseEnvelope` 的实现，完成后用 `npm test` 验证。'],
  ['中文路径', '整理 /Users/me/report.md，不修改原文件', '整理 /Users/me/report.md 中的内容，不修改原文件。'],
  ['已有占位内容', '解释【路径】这个占位符的含义', '说明【路径】这个占位符表示什么。'],
  ['确认回答', '整理报告', '整理 report.md 中的 12 条记录。', ['report.md，12 条记录']],
  ['附件名称', '请总结附件', '总结 slides.pdf 的内容。', ['slides.pdf']],
];

for (const [name, draft, text, sources = []] of faithful) {
  test(`quality fixture: ${name}`, () => {
    assert.deepEqual(detectViolations({ draft, text, sources, id: 'clear' }).codes, []);
    const parsed = parseEnvelope(JSON.stringify({ candidates: [{ id: 'clear', text }] }));
    assert.equal(parsed.candidates[0].text, text);
  });
}

test('new single-digit constraints are flagged but list numbering is ignored', () => {
  assert.ok(detectViolations({ draft: 'Summarize the report', text: 'Summarize the report in 5 bullets.', id: 'clear' }).codes.includes('invented:1'));
  assert.deepEqual(detectViolations({ draft: '检查后保存', text: '1. 检查\n2. 保存', id: 'clear' }).codes, []);
});

test('prompt contract preserves restrictions and uses answers without repeating material questions', () => {
  const system = buildSystemPrompt();
  assert.match(system, /keep every existing ask and restriction/);
  assert.match(system, /Never invent paths/i);
  const content = buildUserContent({ draft: 'Summarize the attached report', attachments: [{ index: 1, name: 'report.md' }], answers: [{ q: 'Length?', a: '12 bullets' }] });
  assert.match(content, /report\.md/);
  assert.match(content, /12 bullets/);
});

test('balanced JSON parsing handles braces inside strings and surrounding examples', () => {
  const text = 'Explain {value} and the escaped quote " safely.';
  const parsed = parseEnvelope('Example: {}\n' + JSON.stringify({ candidates: [{ text }] }) + '\nDone: {}');
  assert.equal(parsed.candidates[0].text, text);
});
