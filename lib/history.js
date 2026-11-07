/**
 * Conversation context for one rewrite.
 *
 * The draft is written before it is sent, so it is not in the session log. What
 * the log holds is everything the user already settled — which is exactly what
 * the rewrite must not contradict, and exactly what it must not ask again.
 *
 * @module dsh-prompt-craft/lib/history
 */

/** Defaults for one collection pass. */
export const HISTORY_LIMITS = Object.freeze({
	maxMessages: 8,
	maxCharsPerMessage: 1500,
	maxTotalChars: 6000,
});

/**
 * Join the plain-text blocks of one message.
 * @param {unknown} message - one derived Session message.
 * @returns {string} its text, or an empty string.
 */
export function messageText(message) {
	const content = message?.content;
	if (!Array.isArray(content)) return '';
	const parts = [];
	for (const block of content) {
		if (block?.type === 'text' && typeof block.text === 'string' && block.text.length > 0) parts.push(block.text);
	}
	return parts.join('\n').trim();
}

/**
 * Rough token estimate: CJK characters cost about one token each, Latin text
 * about a quarter token per character. Precision is not the point; the order of
 * magnitude is.
 * @param {string} text - any text.
 * @returns {number} estimated tokens.
 */
export function estimateTokens(text) {
	if (typeof text !== 'string' || text.length === 0) return 0;
	let tokens = 0;
	for (const character of text) {
		tokens += character.codePointAt(0) > 0x2e7f ? 1 : 0.25;
	}
	return Math.ceil(tokens);
}

/**
 * Collect the newest turns that fit the budget.
 *
 * @param {object} scope - plugin context with optional Session services.
 * @param {string | undefined} sessionId - the browser-reported Session id.
 * @param {Partial<typeof HISTORY_LIMITS>} [limits] - overrides.
 * @returns {{turns: Array<{role: string, text: string}>, hasContext: boolean, truncated: boolean}} the context.
 */
export function collectHistory(scope, sessionId, limits = {}) {
	const config = { ...HISTORY_LIMITS, ...limits };
	if (typeof sessionId !== 'string' || sessionId.length === 0) return { turns: [], hasContext: false, truncated: false };
	let derived = [];
	try {
		const session = scope.get('sessions')?.get(sessionId);
		const messages = session?.deriveMessages?.();
		if (Array.isArray(messages)) derived = messages;
	} catch {
		return { turns: [], hasContext: false, truncated: false };
	}
	if (derived.length === 0) return { turns: [], hasContext: false, truncated: false };

	const picked = [];
	let used = 0;
	let truncated = false;
	for (let index = derived.length - 1; index >= 0 && picked.length < config.maxMessages; index -= 1) {
		const message = derived[index];
		const role = message?.role;
		if (role !== 'user' && role !== 'assistant') continue;
		const text = messageText(message);
		if (text.length === 0) continue;
		const clipped = text.length > config.maxCharsPerMessage ? text.slice(0, config.maxCharsPerMessage) : text;
		const cost = estimateTokens(clipped);
		if (used + cost > config.maxTotalChars) {
			truncated = true;
			break;
		}
		used += cost;
		picked.push({ role, text: clipped });
		if (text.length > clipped.length) truncated = true;
	}
	picked.reverse();
	return { turns: picked, hasContext: picked.some((turn) => turn.role === 'user'), truncated };
}
