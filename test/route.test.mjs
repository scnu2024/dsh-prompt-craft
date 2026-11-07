import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolveConfig } from '../index.js';
import { createHandlers } from '../lib/route.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-craft-route-'));
process.env.DSH_PROMPT_CRAFT_SETTINGS = path.join(dir, 'settings.json');
// Keep the diagnostic trace out of the real one the desktop app writes.
process.env.DSH_PROMPT_CRAFT_DEBUG = path.join(dir, 'debug.log');

/** A fake `llm` service that replays one scripted answer per call. */
function makeLlm(replies) {
	let index = 0;
	return {
		listProviders: () => [{ id: 'deepseek-account', name: 'DeepSeek' }],
		listModels: async () => [{ id: 'deepseek-flash', name: 'DeepSeek V4.1 Flash' }],
		prepareCall: async () => {
			const reply = replies[Math.min(index, replies.length - 1)];
			index += 1;
			return {
				config: { provider: 'deepseek-account', model: 'deepseek-flash', maxTokens: 3000 },
				stream: async function* stream() {
					yield { type: 'text-delta', text: reply };
					yield { type: 'finish', reason: { kind: 'stop' } };
				},
			};
		},
	};
}

function makeCtx(llm) {
	return {
		effect(fn) {
			return fn();
		},
		get(name) {
			if (name === 'llm') return llm;
			if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }) };
			return undefined;
		},
	};
}

function post(body) {
	return new Request('http://127.0.0.1/api/prompt-craft/enhance', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});
}

const CLEAN = JSON.stringify({
	questions: [{ q: '要转成哪个格式？', why: '草稿没说' }],
	candidates: [{ id: 'clear', text: '把 report.md 转成一份 PDF，内容保持原样。' }],
});

const TEMPLATED = JSON.stringify({
	questions: [],
	candidates: [{ id: 'clear', text: '## 目标\n把 /Users/me/report.md 转成 PDF。\n## 输出格式\nPDF 文件。' }],
});

test('a clean answer comes back as one candidate with no warnings', async () => {
	const handlers = createHandlers(makeCtx(makeLlm([CLEAN])), resolveConfig({}), new AbortController().signal);
	const response = await handlers.enhance(post({ draft: '帮我把 report.md 转成 PDF' }));
	assert.equal(response.status, 200);
	const payload = await response.json();
	assert.equal(payload.ok, true);
	assert.equal(payload.candidates.length, 1);
	assert.deepEqual(payload.candidates[0].warnings, []);
	assert.equal(payload.candidates[0].label, '标准');
	assert.equal(payload.questions.length, 1);
	assert.equal(payload.meta.repaired, false);
	assert.equal(payload.meta.context, false);
	assert.equal(payload.meta.provider, 'deepseek-account');
});

test('a rejected first answer is repaired once and the repair is used', async () => {
	const handlers = createHandlers(makeCtx(makeLlm([TEMPLATED, CLEAN])), resolveConfig({}), new AbortController().signal);
	const response = await handlers.enhance(post({ draft: '帮我把 report.md 转成 PDF' }));
	const payload = await response.json();
	assert.equal(payload.ok, true);
	assert.equal(payload.meta.repaired, true);
	assert.ok(payload.candidates.every((candidate) => candidate.warnings.length === 0));
});

test('a repair that does not fix the problem is shown with a warning', async () => {
	const handlers = createHandlers(makeCtx(makeLlm([TEMPLATED, TEMPLATED])), resolveConfig({}), new AbortController().signal);
	const payload = await handlers.enhance(post({ draft: '帮我把 report.md 转成 PDF' })).then((response) => response.json());
	assert.equal(payload.ok, true);
	assert.ok(payload.candidates.some((candidate) => candidate.warnings.includes('template')));
	assert.ok(payload.candidates.some((candidate) => candidate.warnings.includes('repaired')));
});

test('no model service is an actionable 503', async () => {
	const handlers = createHandlers(makeCtx(undefined), resolveConfig({}), new AbortController().signal);
	const response = await handlers.enhance(post({ draft: '整理一下' }));
	assert.equal(response.status, 503);
	const payload = await response.json();
	assert.equal(payload.ok, false);
	assert.match(payload.message, /模型服务/);
});

test('an empty draft is rejected before any model call', async () => {
	const handlers = createHandlers(makeCtx(makeLlm([CLEAN])), resolveConfig({}), new AbortController().signal);
	const response = await handlers.enhance(post({ draft: '   ' }));
	assert.equal(response.status, 400);
	assert.equal((await response.json()).code, 'EMPTY_DRAFT');
});

test('a draft over the configured limit is rejected', async () => {
	const handlers = createHandlers(makeCtx(makeLlm([CLEAN])), resolveConfig({ maxDraftChars: 10 }), new AbortController().signal);
	const response = await handlers.enhance(post({ draft: '这一句话明显超过十个字符了' }));
	assert.equal(response.status, 400);
	assert.equal((await response.json()).code, 'DRAFT_TOO_LONG');
});

test('a malformed body is rejected', async () => {
	const handlers = createHandlers(makeCtx(makeLlm([CLEAN])), resolveConfig({}), new AbortController().signal);
	const response = await handlers.enhance(
		new Request('http://127.0.0.1/api/prompt-craft/enhance', { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'not json' }),
	);
	assert.equal(response.status, 400);
	assert.equal((await response.json()).code, 'BAD_REQUEST');
});

test('revise mode returns the single repaired candidate', async () => {
	const single = JSON.stringify({ questions: [], candidates: [{ id: 'clear', text: '把 report.md 转成 PDF。' }] });
	const handlers = createHandlers(makeCtx(makeLlm([single])), resolveConfig({}), new AbortController().signal);
	const payload = await handlers.enhance(post({ draft: '帮我把 report.md 转成 PDF', revise: { id: 'clear', text: '把 report.md 转成 PDF，内容不变。', instruction: 'shorter' } })).then((response) => response.json());
	assert.equal(payload.ok, true);
	assert.equal(payload.candidates.length, 1);
	assert.equal(payload.candidates[0].id, 'clear');
});

test('settings round-trip through the route', async () => {
	const handlers = createHandlers(makeCtx(makeLlm([CLEAN])), resolveConfig({}), new AbortController().signal);
	const initial = await handlers.settings(new Request('http://127.0.0.1/api/prompt-craft/settings', { method: 'GET' })).then((response) => response.json());
	assert.equal(initial.ok, true);
	assert.equal(initial.values.context, true);
	assert.equal(initial.catalog.providers[0].models[0].id, 'deepseek-flash');

	const saved = await handlers
		.settings(
			new Request('http://127.0.0.1/api/prompt-craft/settings', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ preferences: '不要分节标题', context: false }),
			}),
		)
		.then((response) => response.json());
	assert.equal(saved.ok, true);
	assert.equal(saved.values.preferences, '不要分节标题');
	assert.equal(saved.values.context, false);

	const reread = await handlers.settings(new Request('http://127.0.0.1/api/prompt-craft/settings', { method: 'GET' })).then((response) => response.json());
	assert.equal(reread.values.preferences, '不要分节标题');
});
