import assert from 'node:assert/strict';
import test from 'node:test';

import { CraftError, describeFailure, fastControls, resolveRoute, streamCompletion } from '../lib/model.js';

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

test('the pinned pair wins when it is mounted', async () => {
	const scope = scopeWith({ llm: makeLlm([[stop]]), selection: { provider: 'p', model: 'm' } });
	const route = await resolveRoute(scope, 's1', { provider: 'q', model: 'n' });
	assert.deepEqual(route, { provider: 'q', model: 'n' });
});

test('a stale pin falls back to the session model', async () => {
	const scope = scopeWith({ llm: makeLlm([[stop]]), selection: { provider: 'p', model: 'm' }, pinned: { lastUsed: { provider: 'p', model: 'm', reasoningEffort: 'max' } } });
	const route = await resolveRoute(scope, 's1', { provider: 'gone', model: 'nope' });
	assert.equal(route.provider, 'p');
	assert.equal(route.model, 'm');
	assert.equal(route.reasoningEffort, 'max');
});

test('no model service is a 503 CraftError', async () => {
	await assert.rejects(
		() => resolveRoute(scopeWith({ llm: undefined }), 's1', { provider: '', model: '' }),
		(error) => error instanceof CraftError && error.status === 503,
	);
});

test('describeFailure keeps an unknown code actionable', () => {
	assert.match(describeFailure('SOMETHING_NEW', '回退说明'), /回退说明/);
});

test('fast controls respect model capabilities and prefer off, then low', () => {
	const controls = { maxTokens: 3000, reasoningEffort: 'max' };
	assert.deepEqual(fastControls(controls, {}), { maxTokens: 3000 });
	assert.equal(fastControls(controls, { reasoning: { efforts: [{ id: 'high' }, { id: 'low' }] } }).reasoningEffort, 'low');
	assert.equal(fastControls(controls, { reasoning: { efforts: [{ id: 'low' }, { id: 'off' }] } }).reasoningEffort, 'off');
	assert.deepEqual(fastControls(controls, { reasoning: { efforts: [{ id: 'high' }] } }), { maxTokens: 3000 });
});

test('route fallback awaits catalogs and skips empty providers', async () => {
	const llm = makeLlm([[stop]]);
	llm.listModels = async (provider) => provider === 'p' ? [] : [{ id: 'fallback' }];
	assert.deepEqual(await resolveRoute(scopeWith({ llm }), undefined, { provider: '', model: '' }), { provider: 'q', model: 'fallback' });
});

test('finish status resets on retry and the shared allowance never permits a third call', async () => {
	const llm = makeLlm([[truncated], [{ type: 'text-delta', text: 'complete' }]]);
	const budget = { remaining: 2, attempts: 0 };
	const request = { route: { provider: 'p', model: 'm' }, system: 's', messages: [], maxTokens: 1000, signal: new AbortController().signal, budget };
	assert.equal(await streamCompletion(llm, request), 'complete');
	await assert.rejects(() => streamCompletion(llm, request), (error) => error.code === 'EMPTY');
	assert.equal(llm.calls.length, 2);
});

test('a missing pinned model falls back before dispatch, without hiding auth errors', async () => {
	let dispatched = 0;
	const llm = makeLlm([[{ type: 'text-delta', text: 'done' }, stop]]);
	const prepare = llm.prepareCall;
	llm.prepareCall = async (config, signal, configure) => {
		if (config.model === 'gone') throw Object.assign(new Error('missing'), { code: 'MODEL_NOT_FOUND' });
		const call = await prepare(config);
		call.config = configure(config, { reasoning: { efforts: [{ id: 'off' }] } });
		dispatched += 1;
		return call;
	};
	const budget = { remaining: 2, attempts: 0 };
	const request = { route: { provider: 'p', model: 'gone' }, system: 's', messages: [], maxTokens: 1000, signal: new AbortController().signal, budget, fallbackRoute: async () => ({ provider: 'p', model: 'm' }) };
	assert.equal(await streamCompletion(llm, request), 'done');
	assert.equal(dispatched, 1);
	assert.equal(budget.reasoningEffort, 'off');
	llm.prepareCall = async () => { throw Object.assign(new Error('auth'), { code: 'AUTH' }); };
	await assert.rejects(() => streamCompletion(llm, { ...request, budget: { remaining: 2, attempts: 0 } }), (error) => error.code === 'AUTH');
});
