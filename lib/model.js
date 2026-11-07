/**
 * One model call, with the two failure modes this feature actually hits:
 * a pinned model that is no longer mounted, and a reasoning model that spends
 * the whole output budget thinking before writing a single token.
 *
 * @module dsh-prompt-craft/lib/model
 */

/** Default answer budget for one JSON envelope with two candidates. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 3000;

/** Headroom on top of the answer budget, for a reasoning model's thinking. */
const REASONING_HEADROOM_TOKENS = 1200;

/** Hard ceiling for the adaptive retry, regardless of what a model claims. */
const MAX_CEILING_TOKENS = 8000;

/** How many times the budget may be doubled. */
const MAX_BUDGET_ATTEMPTS = 3;

/** The message one interrupted request reports; the same path covers cancel and timeout. */
const ABORT_MESSAGE = '请求被中断（取消或超时），草稿没有改动。';

/**
 * Throw a CraftError when the request was cancelled.
 * @param {AbortSignal} signal - the composed signal.
 * @returns {void}
 */
function throwIfAborted(signal) {
	if (signal.aborted) throw new CraftError('ABORTED', ABORT_MESSAGE, 499);
}

/** Machine-readable failure carrying a user-facing message. */
export class CraftError extends Error {
	/**
	 * @param {string} code - stable public code.
	 * @param {string} message - message the panel prints verbatim.
	 * @param {number} [status] - HTTP status.
	 */
	constructor(code, message, status = 502) {
		super(message);
		this.name = 'CraftError';
		this.code = code;
		this.status = status;
	}
}

/**
 * Map a provider failure onto an actionable Chinese message.
 * @param {string} code - provider failure code.
 * @param {string} fallback - message to use when the code is unknown.
 * @returns {string} the user-facing message.
 */
export function describeFailure(code, fallback) {
	switch (code) {
		case 'AUTH':
		case 'UNAUTHORIZED':
		case 'MISSING_CREDENTIAL':
			return '当前模型没有配置可用的凭据，请到「设置 → 模型」补齐后重试。';
		case 'RATE_LIMIT':
		case 'RATE_LIMITED':
			return '模型接口限流了，等一会儿再试。';
		case 'CONTEXT_WINDOW_EXCEEDED':
			return '草稿加前文超出了当前模型的上下文窗口，缩短草稿或关掉「参考前面的对话」再试。';
		case 'NO_ADAPTER':
		case 'MODEL_NOT_FOUND':
			return '当前会话选的模型不可用了，重新选一个模型再试。';
		case 'QUOTA':
		case 'INSUFFICIENT_QUOTA':
			return '账户额度不足，检查用量后再试。';
		case 'NETWORK':
		case 'TIMEOUT':
			return '模型请求超时或网络中断，草稿没有改动，可以重试。';
		default:
			return fallback;
	}
}

/**
 * Resolve which provider/model a rewrite should use.
 *
 * A pinned pair wins when it is actually mounted; a stale pin falls back to the
 * session model instead of failing the button.
 *
 * @param {object} scope - plugin context.
 * @param {string | undefined} sessionId - browser-reported session id.
 * @param {{provider: string, model: string}} prefs - stored preferences.
 * @returns {{provider: string, model: string, reasoningEffort?: string}} the route.
 */
export function resolveRoute(scope, sessionId, prefs) {
	const llm = scope.get('llm');
	if (llm === undefined) {
		throw new CraftError('LLM_UNAVAILABLE', '当前运行的 Harness 没有模型服务，无法打磨提示词。', 503);
	}
	let providers = [];
	try {
		providers = llm.listProviders() ?? [];
	} catch {
		providers = [];
	}
	const mounted = new Set(providers.map((entry) => entry.id));
	if (prefs.provider.length > 0 && prefs.model.length > 0 && mounted.has(prefs.provider)) {
		return { provider: prefs.provider, model: prefs.model };
	}
	if (typeof sessionId === 'string' && sessionId.length > 0) {
		try {
			const session = scope.get('sessions')?.get(sessionId);
			const projections = scope.get('sessionProjections');
			if (session !== undefined && projections !== undefined) {
				const selection = projections.snapshot(session, ['modelSelection']).values.modelSelection;
				const picked = selection?.next ?? selection?.lastUsed;
				if (picked !== null && picked !== undefined && typeof picked.provider === 'string' && mounted.has(picked.provider)) {
					const route = { provider: picked.provider, model: picked.model };
					if (typeof picked.reasoningEffort === 'string') route.reasoningEffort = picked.reasoningEffort;
					return route;
				}
			}
		} catch {
			// A projection read must never block the rewrite.
		}
	}
	const fallback = scope.get('agentDefaultModel')?.currentSelection();
	if (fallback !== null && fallback !== undefined && typeof fallback.provider === 'string' && mounted.has(fallback.provider)) {
		const route = { provider: fallback.provider, model: fallback.model };
		if (typeof fallback.reasoningEffort === 'string') route.reasoningEffort = fallback.reasoningEffort;
		return route;
	}
	if (mounted.size > 0) {
		const first = providers[0];
		let models = [];
		try {
			models = llm.listModels?.(first.id) ?? [];
		} catch {
			models = [];
		}
		const model = models[0]?.id;
		if (typeof model === 'string' && model.length > 0) return { provider: first.id, model };
	}
	throw new CraftError('NO_MODEL', '没有找到可用的模型，草稿没有改动。', 503);
}

/**
 * Stream one completion and return the concatenated text.
 *
 * The output budget grows when the adapter reports `max-tokens`: a reasoning
 * model's thinking is counted against the same budget, so the first guess can be
 * too small even when the answer itself would have been short.
 *
 * @param {object} llm - the `llm` service.
 * @param {object} request - request description.
 * @param {{provider: string, model: string, reasoningEffort?: string}} request.route - target model.
 * @param {string} request.system - system prompt.
 * @param {Array<object>} request.messages - request messages.
 * @param {number} request.maxTokens - answer budget.
 * @param {AbortSignal} request.signal - cancellation.
 * @returns {Promise<string>} the concatenated text.
 */
export async function streamCompletion(llm, request) {
	let budget = request.maxTokens + REASONING_HEADROOM_TOKENS;
	const ceiling = Math.max(MAX_CEILING_TOKENS, request.maxTokens);
	let lastFinish;
	for (let attempt = 0; attempt < MAX_BUDGET_ATTEMPTS; attempt += 1) {
		let call;
		try {
			call = await llm.prepareCall(
				{
					provider: request.route.provider,
					model: request.route.model,
					maxTokens: Math.min(budget, ceiling),
					...(request.route.reasoningEffort === undefined ? {} : { reasoningEffort: request.route.reasoningEffort }),
				},
				request.signal,
			);
		} catch (error) {
			if (request.signal.aborted) throw new CraftError('ABORTED', ABORT_MESSAGE, 499);
			const code = typeof error?.code === 'string' ? error.code : 'UNKNOWN';
			throw new CraftError(code, describeFailure(code, `模型准备失败：${error?.message ?? '未知错误'}`));
		}

		let text = '';
		let reasoningChars = 0;
		for await (const chunk of call.stream({ ...call.config, system: request.system, messages: request.messages, signal: request.signal })) {
			throwIfAborted(request.signal);
			if (chunk?.type === 'text-delta') text += chunk.text;
			else if (chunk?.type === 'reasoning-delta') reasoningChars += typeof chunk.text === 'string' ? chunk.text.length : 0;
			else if (chunk?.type === 'finish') lastFinish = chunk.reason;
		}
		throwIfAborted(request.signal);

		if (lastFinish !== undefined && (lastFinish.kind === 'error' || lastFinish.kind === 'aborted')) {
			if (lastFinish.kind === 'aborted') throw new CraftError('ABORTED', ABORT_MESSAGE, 499);
			const failure = lastFinish.failure;
			const code = typeof failure?.code === 'string' ? failure.code : 'UNKNOWN';
			throw new CraftError(code, describeFailure(code, `模型请求失败${failure?.message === undefined ? '' : `：${failure.message}`}`));
		}

		const usable = text.trim().length > 0;
		if (usable && (lastFinish === undefined || lastFinish.kind !== 'max-tokens')) return text;

		// Ran out of budget (or produced nothing). A larger retry can still rescue it.
		if (budget >= ceiling) break;
		budget = Math.min(budget * 2, ceiling);
		if (reasoningChars === 0 && !usable && attempt === 0) continue;
	}
	if (lastFinish !== undefined && lastFinish.kind === 'max-tokens') {
		throw new CraftError('OUTPUT_TRUNCATED', '模型输出被长度限制截断了，草稿没有改动。可以缩短草稿再试。');
	}
	throw new CraftError('EMPTY', '模型没有返回可用的内容，草稿没有改动。可以重试。');
}
