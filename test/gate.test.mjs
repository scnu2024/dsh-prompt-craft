import assert from 'node:assert/strict';
import test from 'node:test';

import { countTemplateMarkers, detectViolations, extractFacts, findPlaceholders, normalizeOutput, repairLines } from '../lib/gate.js';

test('normalizeOutput removes a fence wrapped around the whole answer', () => {
	const raw = '```text\n帮我把这份报告整理成三行摘要。\n```';
	assert.equal(normalizeOutput(raw), '帮我把这份报告整理成三行摘要。');
});

test('normalizeOutput removes a leading filler line and a trailing closer', () => {
	const raw = '好的，以下是改写后的提示词：\n\n把 /a/b.md 里的表格转成 CSV。\n\n希望对你有帮助！';
	assert.equal(normalizeOutput(raw), '把 /a/b.md 里的表格转成 CSV。');
});

test('normalizeOutput unwraps a quoted answer but leaves internal quotes alone', () => {
	assert.equal(normalizeOutput('“把这句话改成更短的版本”'), '把这句话改成更短的版本');
	const internal = '把「先做 A 再做 B」的顺序调过来';
	assert.equal(normalizeOutput(internal), internal);
});

test('normalizeOutput keeps a short draft that happens to start with 好', () => {
	assert.equal(normalizeOutput('好，继续\n不要停'), '好，继续\n不要停');
});

test('countTemplateMarkers counts headings and label lines', () => {
	const text = ['## 目标', '把这个文件转成 PDF', '## 要求', '不要改内容', '## 输出格式', 'PDF'].join('\n');
	assert.equal(countTemplateMarkers(text), 3);
	assert.equal(countTemplateMarkers('把这个文件转成 PDF'), 0);
	assert.equal(countTemplateMarkers('目标文件：/a/b.md'), 1);
});

test('extractFacts finds the concrete facts a prompt states', () => {
	const facts = extractFacts('把 /Users/me/report.md 里的第 2 节改成 3 条，参考 https://example.com/x 和 v1.2.3 的写法，用 `npm test` 验证');
	assert.ok(facts.has('/Users/me/report.md'));
	assert.ok(facts.has('report.md'));
	assert.ok(facts.has('https://example.com/x'));
	assert.ok(facts.has('v1.2.3') || facts.has('1.2.3'));
	assert.ok(facts.has('`npm test`'));
});

test('extractFacts ignores list numbering', () => {
	const facts = extractFacts('1. 打开文件\n2. 保存\n3. 退出');
	assert.equal(facts.size, 0);
});

test('findPlaceholders finds angle and bracket placeholders but not HTML tags', () => {
	assert.deepEqual(findPlaceholders('把 <目标文件> 转成 PDF'), ['<目标文件>']);
	assert.deepEqual(findPlaceholders('把【路径】转成 PDF'), ['【路径】']);
	assert.deepEqual(findPlaceholders('把 <div> 标签去掉'), []);
	assert.deepEqual(findPlaceholders('结果写进 target.md'), []);
});

test('a faithful rewrite is clean', () => {
	const draft = '帮我把 /Users/me/report.md 里的表格整理成 CSV，别改内容';
	const text = '把 /Users/me/report.md 里的表格整理成一份 CSV；表格内容保持原样，不要修改。';
	const verdict = detectViolations({ draft, text, id: 'terse' });
	assert.deepEqual(verdict.codes, []);
	assert.equal(verdict.invented.length, 0);
});

test('an invented path or number is flagged', () => {
	const draft = '帮我把这份报告整理一下';
	const text = '把 /Users/me/report.md 里 2026 年的数据整理成 12 条要点。';
	const verdict = detectViolations({ draft, text, id: 'clear' });
	assert.ok(verdict.codes.some((code) => code.startsWith('invented:')));
	assert.ok(verdict.invented.includes('/Users/me/report.md'));
});

test('template headings are flagged only when the draft had none', () => {
	const draft = '帮我把这个函数拆成两个';
	const templated = '## 目标\n把这个函数拆成两个。\n## 要求\n保持行为不变。';
	assert.ok(detectViolations({ draft, text: templated, id: 'clear' }).codes.includes('template'));

	const structuredDraft = '## 目标\n拆分函数\n## 要求\n行为不变';
	assert.ok(!detectViolations({ draft: structuredDraft, text: structuredDraft, id: 'clear' }).codes.includes('template'));
});

test('a placeholder in the rewrite is flagged', () => {
	const verdict = detectViolations({ draft: '帮我改一下这个文件', text: '帮我改一下 <文件路径> 里的代码', id: 'clear' });
	assert.ok(verdict.codes.includes('placeholder'));
});

test('padding is flagged for a long draft but exempted for a tiny one', () => {
	const draft = '帮我把这份季度销售报告里的所有数字按地区汇总成一张表，并且标注每个地区的同比变化，最后给出三条结论。';
	const bloated = `${draft}另外请注意保持格式整洁，不要遗漏任何内容，确保结果清晰可读，方便后续使用和分享给大家。`.repeat(2);
	assert.ok(detectViolations({ draft, text: bloated, id: 'clear' }).codes.includes('bloat'));
	assert.ok(!detectViolations({ draft: '帮我改个名字', text: '帮我改个名字，尽量简短', id: 'terse' }).codes.includes('bloat'));
});

test('a number range counts as a concrete fact', () => {
	const verdict = detectViolations({ draft: '把这个任务分步做', text: '把这个任务拆成 2-3 步来做', id: 'clear' });
	assert.ok(verdict.codes.some((code) => code.startsWith('invented:')));
});

test('repairLines names what has to go', () => {
	const verdict = detectViolations({ draft: '整理一下', text: '## 目标\n把 /a/b.md 整理成 <表格>\n## 要求\n别改内容', id: 'clear' });
	const lines = repairLines(verdict);
	assert.ok(lines.some((line) => line.includes('/a/b.md')));
	assert.ok(lines.some((line) => line.includes('template') || line.includes('template') || line.includes('headings')));
	assert.ok(lines.length >= 2);
});
