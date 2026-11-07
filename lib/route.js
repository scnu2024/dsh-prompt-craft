/**
 * HTTP handlers for the prompt-craft Host half.
 *
 * The route is thin on purpose: validation, prompt assembly, the model call,
 * the gate, and the envelope response. Everything with a decision in it lives in
 * the modules this file imports, so the decisions are testable without a server.
 *
 * @module dsh-prompt-craft/lib/route
 */

import { buildRepairMessage, buildSystemPrompt, buildUserContent, CANDIDATE_IDS } from './prompt.js';
import { detectViolations, normalizeOutput, repairLines } from './gate.js';
import { parseEnvelope } from './protocol.js';
import { collectHistory } from './history.js';
import { readPrefs, writePrefs } from './prefs.js';
import { CraftError, DEFAULT_MAX_OUTPUT_TOKENS, resolveRoute, streamCompletion } from './model.js';

/** Instruction ids the panel may send with a revise request. */
const REVISE_INSTRUCTIONS = new Set(['shorter', 'specific']);

/** The model catalog is a settings-page nicety; it is cached rather than fetched per open. */
const CATALOG_TTL_MS = 5 * 60 * 1000;
let catalogCache = { at: 0, value: { providers: [] } };

/** Strip composer chip placeholders that should never reach the model as raw characters. */
const CHIP_PLACEHOLDER_RE = /[\uE100-\uE11D\uFFFC]/gu;

/** Answer one failure envelope. */
function fail(error) {
	if (error instanceof CraftError) {
		return Response.json({ ok: false, code: error.code, message: error.message }, { status: error.status ?? 502 });
	}
	// A bare DOMException from an aborted request must not read like a plugin bug.
	if (error?.name === 'AbortError') {
		return Response.json({ ok: false, code: 'ABORTED', message: '请求被中断（取消或超时），草稿没有改动。' }, { status: 499 });
	}
	return Response.json(
		{ ok: false, code: 'INTERNAL', message: `打磨失败：${error?.message ?? '未知错误'}。草稿没有改动。` },
		{ status: 500 },
	);
}

/** Read a JSON body, rejecting anything that is not an object. */
async function readJson(request) {
	const declared = Number(request.headers.get('content-length') ?? 0);
	if (Number.isFinite(declared) && declared > 256 * 1024) {
		throw new CraftError('BODY_TOO_LARGE', '请求太大了，草稿请控制在几千字以内。', 413);
	}
	try {
		const value = await request.json();
		if (value === null || typeof value !== 'object' || Array.isArray(value)) {
			throw new CraftError('BAD_REQUEST', '请求格式不对。', 400);
		}
		return value;
	} catch (error) {
		if (error instanceof CraftError) throw error;
		throw new CraftError('BAD_REQUEST', '请求不是有效的 JSON。', 400);
	}
}

/** Coerce the incoming draft, keeping the failure messages actionable. */
function readDraft(body, config) {
	const raw = typeof body.draft === 'string' ? body.draft : '';
	const draft = raw.replace(CHIP_PLACEHOLDER_RE, '').trim();
	if (draft.length === 0) throw new CraftError('EMPTY_DRAFT', '输入框是空的，没有可打磨的草稿。', 400);
	if (draft.length > config.maxDraftChars) {
		throw new CraftError('DRAFT_TOO_LONG', `草稿超过 ${config.maxDraftChars} 字，先缩短一点再打磨。`, 400);
	}
	return draft;
}

/** Coerce attachments; they only contribute names to the prompt. */
function readAttachments(body) {
	if (!Array.isArray(body.attachments)) return [];
	return body.attachments
		.filter((entry) => entry !== null && typeof entry === 'object' && typeof entry.name === 'string')
		.slice(0, 12)
		.map((entry, index) => ({
			index: Number.isFinite(Number(entry.index)) ? Number(entry.index) : index + 1,
			name: entry.name.slice(0, 200),
			kind: entry.kind === 'image' ? 'image' : 'file',
		}));
}

/** Coerce already-given answers; each one is a fact the rewrite may use. */
function readAnswers(body) {
	if (!Array.isArray(body.answers)) return [];
	return body.answers
		.filter((entry) => entry !== null && typeof entry === 'object' && typeof entry.a === 'string' && entry.a.trim().length > 0)
		.slice(0, 6)
		.map((entry) => ({ q: String(entry.q ?? '').slice(0, 240), a: entry.a.trim().slice(0, 500) }));
}

/** Coerce a revise request, or return undefined for a full rewrite. */
function readRevise(body, config) {
	const value = body.revise;
	if (value === null || typeof value !== 'object') return undefined;
	if (!REVISE_INSTRUCTIONS.has(value.instruction)) return undefined;
	const text = typeof value.text === 'string' ? value.text.trim() : '';
	if (text.length === 0 || text.length > config.maxDraftChars * 2) return undefined;
	return {
		id: CANDIDATE_IDS.includes(value.id) ? value.id : 'clear',
		text,
		instruction: value.instruction,
	};
}

/** Combine the lifetime signal, the request signal and the timeout. */
function composeSignal(request, lifetime, timeoutMs) {
	const signals = [];
	if (lifetime !== undefined && typeof lifetime.addEventListener === 'function') signals.push(lifetime);
	if (request !== null && typeof request === 'object' && typeof request.signal?.addEventListener === 'function') signals.push(request.signal);
	if (typeof AbortSignal.timeout === 'function') signals.push(AbortSignal.timeout(timeoutMs));
	if (signals.length === 0) return new AbortController().signal;
	if (signals.length === 1) return signals[0];
	return AbortSignal.any(signals);
}

/** Normalize every candidate and run the gate over it. */
function evaluate(envelope, draft) {
	return envelope.candidates.map((candidate) => {
		const text = normalizeOutput(candidate.text);
		return { candidate: { ...candidate, text }, verdict: text.length > 0 ? detectViolations({ draft, text, id: candidate.id }) : { codes: [], invented: [], ratio: 1 } };
	});
}

/** Turn gate codes into the warnings a card shows. */
function warningsFor(verdict, repaired) {
	const warnings = [...verdict.codes];
	if (repaired && verdict.codes.length > 0) warnings.push('repaired');
	return warnings;
}

/** Build the settings-page model catalog, tolerating a missing or slow llm service. */
async function modelCatalog(ctx) {
	const now = Date.now();
	if (now - catalogCache.at < CATALOG_TTL_MS) return catalogCache.value;
	const llm = ctx.get('llm');
	const providers = [];
	if (llm !== undefined) {
		let listed = [];
		try {
			listed = llm.listProviders() ?? [];
		} catch {
			listed = [];
		}
		for (const provider of listed.slice(0, 12)) {
			let models = [];
			try {
				models = (await llm.listModels?.(provider.id)) ?? [];
			} catch {
				models = [];
			}
			providers.push({
				id: provider.id,
				name: typeof provider.name === 'string' && provider.name.length > 0 ? provider.name : provider.id,
				models: models.slice(0, 40).map((model) => ({
					id: String(model.id),
					name: typeof model.name === 'string' && model.name.length > 0 ? model.name : String(model.id),
				})),
			});
		}
	}
	const value = { providers };
	catalogCache = { at: now, value };
	return value;
}

/**
 * Create the two route handlers.
 *
 * @param {object} ctx - plugin context.
 * @param {object} config - resolved limits.
 * @param {AbortSignal} lifetime - aborted when the plugin unloads.
 * @returns {{enhance: Function, settings: Function}} the handlers.
 */
export function createHandlers(ctx, config, lifetime) {
	const enhance = async (request) => {
		const started = Date.now();
		try {
			const body = await readJson(request);
			const draft = readDraft(body, config);
			const attachments = readAttachments(body);
			const answers = readAnswers(body);
			const revise = readRevise(body, config);
			const sessionId = typeof body.sessionId === 'string' ? body.sessionId.slice(0, 120) : undefined;
			const llm = ctx.get('llm');
			if (llm === undefined) throw new CraftError('LLM_UNAVAILABLE', '当前运行的 Harness 没有模型服务，无法打磨提示词。', 503);

			const prefs = readPrefs();
			const signal = composeSignal(request, lifetime, config.timeoutMs);
			const history = revise === undefined && prefs.context ? collectHistory(ctx, sessionId, { maxMessages: config.contextMessages, maxTotalChars: config.contextChars }) : { turns: [], hasContext: false, truncated: false };
			const system = buildSystemPrompt({
				preferences: prefs.preferences,
				hasContext: history.hasContext,
				...(revise === undefined ? {} : { revise: revise.instruction, candidateId: revise.id }),
			});
			const user = buildUserContent({
				draft,
				attachments,
				answers,
				history: history.turns,
				...(revise === undefined ? {} : { revise: { id: revise.id, text: revise.text } }),
			});
			const route = resolveRoute(ctx, sessionId, prefs);
			const messages = [{ role: 'user', content: [{ type: 'text', text: user }] }];
			const raw = await streamCompletion(llm, { route, system, messages, maxTokens: config.maxOutputTokens, signal });

			let envelope = parseEnvelope(raw);
			let repaired = false;
			if (revise === undefined) {
				const flagged = evaluate(envelope, draft).filter((entry) => entry.verdict.codes.length > 0);
				if (flagged.length > 0) {
					repaired = true;
					const lines = [...new Set(flagged.flatMap((entry) => repairLines(entry.verdict)))];
					const repairUser = [
						user,
						'Your previous answer was:',
						raw,
						buildRepairMessage(lines.length > 0 ? lines : ['the rewrite added content the draft does not contain']),
					].join('\n\n');
					try {
						const rawRetry = await streamCompletion(llm, {
							route,
							system,
							messages: [{ role: 'user', content: [{ type: 'text', text: repairUser }] }],
							maxTokens: config.maxOutputTokens,
							signal,
						});
						const retry = parseEnvelope(rawRetry);
						if (retry.candidates.length > 0) envelope = retry;
					} catch {
						// A failed repair must not lose the first answer: show it flagged.
					}
				}
			}

			const evaluated = evaluate(envelope, draft).filter((entry) => entry.candidate.text.length > 0);
			if (evaluated.length === 0) {
				throw new CraftError('EMPTY', '模型没有返回可用的提示词，草稿没有改动。可以重试。');
			}
			const candidates = evaluated.map((entry) => ({
				id: entry.candidate.id,
				label: entry.candidate.label,
				text: entry.candidate.text,
				warnings: warningsFor(entry.verdict, repaired),
			}));
			return Response.json({
				ok: true,
				questions: envelope.questions,
				candidates,
				meta: {
					provider: route.provider,
					model: route.model,
					elapsedMs: Date.now() - started,
					context: history.hasContext,
					repaired,
					answersUsed: answers.length,
				},
			});
		} catch (error) {
			return fail(error);
		}
	};

	const settings = async (request) => {
		try {
			if (request.method === 'GET') {
				return Response.json({ ok: true, values: readPrefs(), catalog: await modelCatalog(ctx) });
			}
			const body = await readJson(request);
			const patch = {};
			for (const key of ['preferences', 'context', 'showDiff', 'provider', 'model']) {
				if (body[key] !== undefined) patch[key] = body[key];
			}
			if (typeof patch.preferences === 'string' && patch.preferences.length > 2000) {
				throw new CraftError('BAD_REQUEST', '偏好说明最多 2000 字。', 400);
			}
			const written = writePrefs(patch);
			if (!written.ok) throw new CraftError('SETTINGS_WRITE_FAILED', `保存偏好失败：${written.error}`, 500);
			return Response.json({ ok: true, values: written.prefs });
		} catch (error) {
			return fail(error);
		}
	};

	return { enhance, settings };
}
