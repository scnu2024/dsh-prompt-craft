import assert from 'node:assert/strict';
import test from 'node:test';

import { CraftError, describeFailure, resolveRoute, streamCompletion } from '../lib/model.js';

/** A fake llm whose every call replays the next scripted finish. */
function makeLlm(scripts) {
	const calls = [];
	let index = 0;
	return {
		calls,
		listProviders: () => [{ id: 'p', name: 'P' }, { id: 'q', name: 'Q' }],
		listModels: async () => [{ id: 'm', name: 'M' }],
		prepareCall: async (config) => {
			calls.push(config);
			const script = scripts[Math.min(index, scripts.length - 1)];
			index += 1;
			return {
				config,
				stream: async function* stream() {
					for (const chunk of script) yield chunk;
				},
			};
		},
	};
}

const stop = { type: 'finish', reason: { kind: 'stop' } };
const truncated = { type: 'finish', reason: { kind: 'max-tokens' } };

function scopeWith({ llm, selection, pinned, providers } = {}) {
	return {
		get(name) {
			if (name === 'llm') return llm;
			if (name === 'agentDefaultModel') return { currentSelection: () => selection };
			if (name === 'sessionProjections') {
				return { snapshot: () => ({ values: { modelSelection: pinned } }) };
			}
			if (name === 'sessions') return { get: () => ({ id: 's' }) };
			if (name === 'providers') return providers;
			return undefined;
		},
	};
}

test('a clean first answer is returned as-is', async () => {
	const llm = makeLlm([[{ type: 'text-delta', text: '你好' }, stop]]);
	const text = await streamCompletion(llm, {
		route: { provider: 'p', model: 'm' },
		system: 's',
		messages: [],
		maxTokens: 1000,
		signal: new AbortController().signal,
	});
	assert.equal(text, '你好');
});

test('a max-tokens finish retries with a larger budget', async () => {
	const llm = makeLlm([
		[truncated],
		[{ type: 'text-delta', text: '完整结果' }, stop],
	]);
	const text = await streamCompletion(llm, {
		route: { provider: 'p', model: 'm' },
		system: 's',
		messages: [],
		maxTokens: 1000,
		signal: new AbortController().signal,
	});
	assert.equal(text, '完整结果');
	assert.equal(llm.calls.length, 2);
	assert.ok(llm.calls[1].maxTokens > llm.calls[0].maxTokens);
});

test('every attempt truncating is reported as truncation, not emptiness', async () => {
	const llm = makeLlm([[truncated]]);
	await assert.rejects(
		() => streamCompletion(llm, { route: { provider: 'p', model: 'm' }, system: 's', messages: [], maxTokens: 1000, signal: new AbortController().signal }),
		(error) => error instanceof CraftError && error.code === 'OUTPUT_TRUNCATED',
	);
});

test('an empty answer is reported as EMPTY', async () => {
	const llm = makeLlm([[stop]]);
	await assert.rejects(
		() => streamCompletion(llm, { route: { provider: 'p', model: 'm' }, system: 's', messages: [], maxTokens: 1000, signal: new AbortController().signal }),
		(error) => error instanceof CraftError && error.code === 'EMPTY',
	);
});

test('a provider failure becomes an actionable message', async () => {
	const llm = makeLlm([[{ type: 'finish', reason: { kind: 'error', failure: { code: 'RATE_LIMIT', message: 'slow down' } } }]]);
	await assert.rejects(
		() => streamCompletion(llm, { route: { provider: 'p', model: 'm' }, system: 's', messages: [], maxTokens: 1000, signal: new AbortController().signal }),
		(error) => error instanceof CraftError && error.code === 'RATE_LIMIT' && /限流/.test(error.message),
	);
});

test('an aborted signal surfaces as ABORTED', async () => {
	const controller = new AbortController();
	controller.abort();
	const llm = makeLlm([[{ type: 'text-delta', text: 'x' }, stop]]);
	await assert.rejects(
		() => streamCompletion(llm, { route: { provider: 'p', model: 'm' }, system: 's', messages: [], maxTokens: 1000, signal: controller.signal }),
		(error) => error instanceof CraftError && error.code === 'ABORTED',
	);
});

test('the pinned pair wins when it is mounted', () => {
	const scope = scopeWith({ llm: makeLlm([[stop]]), selection: { provider: 'p', model: 'm' } });
	const route = resolveRoute(scope, 's1', { provider: 'q', model: 'n' });
	assert.deepEqual(route, { provider: 'q', model: 'n' });
});

test('a stale pin falls back to the session model', () => {
	const scope = scopeWith({ llm: makeLlm([[stop]]), selection: { provider: 'p', model: 'm' }, pinned: { lastUsed: { provider: 'p', model: 'm', reasoningEffort: 'max' } } });
	const route = resolveRoute(scope, 's1', { provider: 'gone', model: 'nope' });
	assert.equal(route.provider, 'p');
	assert.equal(route.model, 'm');
	assert.equal(route.reasoningEffort, 'max');
});

test('no model service is a 503 CraftError', () => {
	assert.throws(
		() => resolveRoute(scopeWith({ llm: undefined }), 's1', { provider: '', model: '' }),
		(error) => error instanceof CraftError && error.status === 503,
	);
});

test('describeFailure keeps an unknown code actionable', () => {
	assert.match(describeFailure('SOMETHING_NEW', '回退说明'), /回退说明/);
});
