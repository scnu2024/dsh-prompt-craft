import assert from 'node:assert/strict';
import test from 'node:test';

import { collectHistory, estimateTokens, messageText } from '../lib/history.js';

function textMessage(role, text) {
	return { role, content: [{ type: 'text', text }] };
}

function scopeWith(messages) {
	return {
		get(name) {
			if (name !== 'sessions') return undefined;
			return { get: () => ({ deriveMessages: () => messages }) };
		},
	};
}

test('messageText joins text blocks and skips everything else', () => {
	const message = {
		role: 'assistant',
		content: [
			{ type: 'reasoning', text: '思考' },
			{ type: 'text', text: '第一句' },
			{ type: 'tool-call', name: 'bash' },
			{ type: 'text', text: '第二句' },
		],
	};
	assert.equal(messageText(message), '第一句\n第二句');
	assert.equal(messageText({ role: 'user' }), '');
});

test('estimateTokens counts CJK near one token and latin near a quarter', () => {
	assert.equal(estimateTokens('中文'), 2);
	assert.equal(estimateTokens('abcd'), 1);
	assert.equal(estimateTokens(''), 0);
});

test('no session means no context', () => {
	assert.deepEqual(collectHistory({ get: () => undefined }, undefined), { turns: [], hasContext: false, truncated: false });
	assert.deepEqual(collectHistory({ get: () => undefined }, 'session-x'), { turns: [], hasContext: false, truncated: false });
});

test('turns keep their roles and order', () => {
	const scope = scopeWith([textMessage('user', '先做 A'), textMessage('assistant', '好'), textMessage('user', '再做 B')]);
	const context = collectHistory(scope, 's1');
	assert.deepEqual(context.turns.map((turn) => turn.role), ['user', 'assistant', 'user']);
	assert.equal(context.hasContext, true);
});

test('only the newest messages that fit the budget survive', () => {
	const scope = scopeWith([textMessage('user', '一'.repeat(40)), textMessage('user', '二'.repeat(40)), textMessage('user', '三'.repeat(40))]);
	const context = collectHistory(scope, 's1', { maxMessages: 10, maxCharsPerMessage: 100, maxTotalChars: 50 });
	assert.equal(context.turns.length, 1);
	assert.match(context.turns[0].text, /^三/);
	assert.equal(context.truncated, true);
});

test('a single over-long message is clipped, not dropped', () => {
	const scope = scopeWith([textMessage('user', '长'.repeat(300))]);
	const context = collectHistory(scope, 's1', { maxCharsPerMessage: 20, maxTotalChars: 100 });
	assert.equal(context.turns.length, 1);
	assert.equal(context.turns[0].text.length, 20);
	assert.equal(context.truncated, true);
});

test('a session with only tool rows has no context', () => {
	const scope = scopeWith([{ role: 'tool', content: [{ type: 'text', text: '结果' }] }]);
	assert.equal(collectHistory(scope, 's1').hasContext, false);
});

test('a throwing session read degrades to no context', () => {
	const scope = {
		get: () => ({
			get: () => ({
				deriveMessages() {
					throw new Error('boom');
				},
			}),
		}),
	};
	assert.deepEqual(collectHistory(scope, 's1'), { turns: [], hasContext: false, truncated: false });
});
