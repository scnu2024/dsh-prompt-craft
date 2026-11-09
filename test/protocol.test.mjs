import assert from 'node:assert/strict';
import test from 'node:test';

import { parseEnvelope, stripFence } from '../lib/protocol.js';

const valid = JSON.stringify({
	questions: [{ q: '目标文件是哪个？', why: '草稿没说', options: ['report.md'] }],
	candidates: [{ id: 'clear', text: '把 report.md 转成一份 PDF，版面保持原样。' }],
});

test('stripFence removes one outer fence', () => {
	assert.equal(stripFence('```json\n{"a":1}\n```'), '{"a":1}');
	assert.equal(stripFence('{"a":1}'), '{"a":1}');
});

test('a bare JSON object parses', () => {
	const parsed = parseEnvelope(valid);
	assert.equal(parsed.parsed, true);
	assert.equal(parsed.questions.length, 1);
	assert.equal(parsed.questions[0].q, '目标文件是哪个？');
	assert.equal(parsed.candidates.length, 1);
	assert.equal(parsed.candidates[0].id, 'clear');
	assert.equal(parsed.candidates[0].label, '标准');
});

test('a fenced object with a sentence before it still parses', () => {
	const raw = `好的，这是结果：\n\n\`\`\`json\n${valid}\n\`\`\`\n`;
	const parsed = parseEnvelope(raw);
	assert.equal(parsed.parsed, true);
	assert.equal(parsed.candidates.length, 1);
});

test('a bare array of candidates keeps the first and drops the rest', () => {
	const parsed = parseEnvelope(JSON.stringify([{ text: '一版' }, { text: '另一版' }]));
	assert.equal(parsed.parsed, true);
	assert.equal(parsed.candidates.length, 1);
	assert.equal(parsed.candidates[0].id, 'clear');
	assert.equal(parsed.candidates[0].text, '一版');
});

test('more than two questions are cut to two', () => {
	const raw = JSON.stringify({
		questions: [{ q: 'a' }, { q: 'b' }, { q: 'c' }],
		candidates: [{ id: 'terse', text: 'x' }],
	});
	assert.equal(parseEnvelope(raw).questions.length, 2);
});

test('invalid questions are dropped, invalid options are dropped', () => {
	const raw = JSON.stringify({
		questions: [{ q: '' }, { q: 'ok', options: ['', 3, 'fine'] }, { why: 'no q' }],
		candidates: [{ id: 'terse', text: 'x' }],
	});
	const parsed = parseEnvelope(raw);
	assert.equal(parsed.questions.length, 1);
	assert.deepEqual(parsed.questions[0].options, ['fine']);
});

test('extra candidates beyond the one we ask for are dropped', () => {
	const raw = JSON.stringify({ questions: [], candidates: [{ id: 'clear', text: '第一版' }, { id: 'clear', text: '第二版' }] });
	const parsed = parseEnvelope(raw);
	assert.equal(parsed.candidates.length, 1);
	assert.equal(parsed.candidates[0].text, '第一版');
});

test('unparseable output degrades to one plain-text candidate', () => {
	const parsed = parseEnvelope('把 report.md 转成 PDF，版面别动。');
	assert.equal(parsed.parsed, false);
	assert.equal(parsed.candidates.length, 1);
	assert.equal(parsed.candidates[0].text, '把 report.md 转成 PDF，版面别动。');
});

test('empty output has no candidates', () => {
	assert.deepEqual(parseEnvelope('   ').candidates, []);
	assert.deepEqual(parseEnvelope(undefined).candidates, []);
});

test('a truncated object never becomes an applicable candidate', () => {
	const parsed = parseEnvelope('{"questions":[],"candidates":[{"id":"terse","text":"写到一半');
	assert.equal(parsed.candidates.length, 0);
	assert.equal(parsed.invalid, true);
	assert.equal(parsed.parsed, false);
});

test('v2 needs_input accepts questions without candidates',()=>{
  const parsed=parseEnvelope(JSON.stringify({status:'needs_input',questions:[{q:'Audience?'}],candidates:[]}));
  assert.equal(parsed.parsed,true);assert.equal(parsed.questions.length,1);assert.deepEqual(parsed.candidates,[]);
});

test('analysis can recover its explanation from the targeted question without another call', async()=>{
  const {parseAnalysis}=await import('../lib/protocol.js');
  const result=parseAnalysis(JSON.stringify({decision:'ask',questions:[{q:'Which failure?',why:'The error and operation are unknown.'}]}));
  assert.equal(result.reason,'The error and operation are unknown.');
  assert.equal(parseAnalysis(JSON.stringify({decision:'unchanged'})),undefined);
});
