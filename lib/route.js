/**
 * HTTP handlers for the prompt-craft Host half.
 *
 * The route is thin on purpose: validation, prompt assembly, the model call,
 * the gate, and the envelope response. Everything with a decision in it lives in
 * the modules this file imports, so the decisions are testable without a server.
 *
 * @module dsh-prompt-craft/lib/route
 */

import { CANDIDATE_IDS } from './prompt.js';
import { craft } from './engine.js';
import { collectHistory } from './history.js';
import { readPrefs, writePrefs } from './prefs.js';
import { abortable, CraftError, resolveRoute } from './model.js';
import { IMAGE_LIMITS, readImages, admitImages } from './images.js';

/** Instruction ids the panel may send with a revise request. */
const REVISE_INSTRUCTIONS = new Set(['shorter', 'specific']);

/** The model catalog is a settings-page nicety; it is cached rather than fetched per open. */
const CATALOG_TTL_MS = 5 * 60 * 1000;
const catalogCaches = new WeakMap();

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
async function readJson(request, allowImages = false) {
	const cap = allowImages ? IMAGE_LIMITS.maxBodyBytes : IMAGE_LIMITS.maxTextBytes;
	const declared = Number(request.headers.get('content-length') ?? 0);
	if (Number.isFinite(declared) && declared > cap) {
		throw new CraftError('BODY_TOO_LARGE', '请求太大了，草稿请控制在几千字以内。', 413);
	}
	try {
		const reader = request.body?.getReader();
		const chunks = [];
		let size = 0;
		if (reader) {
			try { while (true) {
				const {done, value} = await reader.read();
				if (done) break;
				size += value.byteLength;
				if (size > cap) { await reader.cancel(); throw new CraftError('BODY_TOO_LARGE', '请求超过大小上限。', 413); }
				chunks.push(value);
			} } finally { reader.releaseLock(); }
		}
		const text = Buffer.concat(chunks).toString('utf8');
		// Keep the legacy text-only failure even for oversized malformed JSON.
		if (size > IMAGE_LIMITS.maxTextBytes && !/"images"\s*:/.test(text)) throw new CraftError('BODY_TOO_LARGE', '请求超过大小上限。', 413);
		const value = JSON.parse(text);
		if (value === null || typeof value !== 'object' || Array.isArray(value)) {
			throw new CraftError('BAD_REQUEST', '请求格式不对。', 400);
		}
		const { images, ...textFields } = value;
		if (Buffer.byteLength(JSON.stringify(textFields)) > IMAGE_LIMITS.maxTextBytes) throw new CraftError('BODY_TOO_LARGE', '文字部分超过大小上限。', 413);
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
	if (draft.length === 0 && !body.images?.length) throw new CraftError('EMPTY_DRAFT', '输入框是空的，没有可打磨的草稿。', 400);
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
	if (body.answers.length > 64) throw new CraftError('ANSWERS_TOO_LARGE', '确认信息过多，请整理到草稿后重新打磨。', 400);
	return body.answers
		.filter((entry) => entry !== null && typeof entry === 'object' && typeof entry.a === 'string' && entry.a.trim().length > 0)
				.map((entry) => ({ q: String(entry.q ?? '').slice(0, 240), a: entry.a.trim().slice(0, 500) }));
}

/** Coerce a revise request, or return undefined for a full rewrite. */
function readRevise(body, config) {
	const value = body.revise;
	if (value === null || typeof value !== 'object') return undefined;
	if (!REVISE_INSTRUCTIONS.has(value.instruction)) throw new CraftError('BAD_REQUEST', '无法识别微调方向。', 400);
	const text = typeof value.text === 'string' ? value.text.trim() : '';
	if (text.length === 0 || text.length > config.maxOutputChars) throw new CraftError('BAD_REQUEST', '当前版本为空或超过输出长度上限。', 400);
	return {
		id: CANDIDATE_IDS.includes(value.id) ? value.id : 'clear',
		text,
		instruction: value.instruction,
	};
}

/** Combine the lifetime signal, the request signal and the timeout. */
function requestLifetime(request, lifetime, timeoutMs) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(new CraftError('TIMEOUT', '打磨超时了，草稿没有改动，可以重试。', 504)), timeoutMs);
	const removers = [];
	for (const signal of [request?.signal, lifetime]) {
		if (typeof signal?.addEventListener !== 'function') continue;
		const forward = () => controller.abort(signal.reason);
		if (signal.aborted) forward();
		else {
			signal.addEventListener('abort', forward, { once: true });
			removers.push(() => signal.removeEventListener('abort', forward));
		}
	}
	return { signal: controller.signal, dispose() { clearTimeout(timer); for (const remove of removers) remove(); } };
}

/** Revision history is bounded comparison data, never factual evidence. */
function readRevisionContext(body, config) {
  const context = body.revisionContext ?? {};
  const versions = (Array.isArray(context.versions) ? context.versions : []).slice(-3)
    .filter(v => v && typeof v.text === 'string' && ['enhance','specific','shorter'].includes(v.operation))
    .map(v => ({text:v.text.slice(0,config.maxOutputChars),operation:v.operation}));
  const improvements = (Array.isArray(context.improvements) ? context.improvements : []).slice(-24)
    .filter(v=>typeof v==='string').map(v=>v.slice(0,240));
  return {versions,improvements};
}

/** Build the settings-page model catalog, tolerating a missing or slow llm service. */
async function modelCatalog(ctx) {
	const now = Date.now();
	const cached = catalogCaches.get(ctx);
	if (cached && now - cached.at < CATALOG_TTL_MS) return cached.value;
	const llm = ctx.get('llm');
	const providers = [];
	if (llm !== undefined) {
		let listed = [];
		try {
			listed = llm.listProviders() ?? [];
		} catch {
			listed = [];
		}
		await Promise.all(listed.slice(0, 12).map(async (provider) => {
			let models = [];
			let timer;
			try {
				models = (await Promise.race([Promise.resolve(llm.listModels?.(provider.id)), new Promise((resolve) => { timer = setTimeout(() => resolve([]), 1500); })])) ?? [];
			} catch {
				models = [];
			} finally { clearTimeout(timer); }
			providers.push({
				id: provider.id,
				name: typeof provider.name === 'string' && provider.name.length > 0 ? provider.name : provider.id,
				models: models.slice(0, 40).map((model) => ({
					id: String(model.id),
					name: typeof model.name === 'string' && model.name.length > 0 ? model.name : String(model.id),
				})),
			});
		}));
	}
	const value = { providers };
	catalogCaches.set(ctx, { at: now, value });
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
export function createHandlers(ctx, config, lifetime, options = {}) {
	const generate = async (request, signal) => {
		const started = Date.now();
		try {
			const body = await readJson(request, true);
			const encodedImages = readImages(body.images);
			const draft = readDraft(body, config);
			if (body.protocolVersion !== 2) throw new CraftError('CLIENT_OUTDATED', '提示词打磨已升级，请刷新 Harness 页面后重试。草稿会保留。', 409);
			const attachments = readAttachments(body);
			const answers = readAnswers(body);
			const revise = readRevise(body, config);
			const sessionId = typeof body.sessionId === 'string' ? body.sessionId.slice(0,120) : undefined;
			const llm = ctx.get('llm');
			if (!llm) throw new CraftError('LLM_UNAVAILABLE', '当前运行的 Harness 没有模型服务，无法打磨提示词。', 503);
			const prefs = (options.readPrefs ?? readPrefs)();
			const history = prefs.context ? collectHistory(ctx, sessionId, {maxMessages:config.contextMessages,maxTotalChars:config.contextChars}) : {turns:[],truncated:false};
			const route = await abortable(resolveRoute(ctx, sessionId, prefs, { strict: encodedImages.length > 0 }),signal);
			const images = await admitImages(ctx, encodedImages, signal);
			return Response.json(await craft(llm, {draft, attachments, images, language: body.language === 'en' ? 'en' : 'zh', answers, revise, history:history.turns,
				contextTruncated:history.truncated, preferences:prefs.preferences,
				clarificationMode:body.clarificationMode==='proceed'?'proceed':'ask', revisionContext:readRevisionContext(body,config)},
				config,signal,route,images.length ? undefined : ()=>resolveRoute(ctx,sessionId,{provider:'',model:''})));

		} catch (error) {
			return fail(error);
		}
	};
	const enhance = async (request) => {
		const active = requestLifetime(request, lifetime, config.timeoutMs);
		try { return await abortable(generate(request, active.signal), active.signal); }
		catch (error) { return fail(error); }
		finally { active.dispose(); }
	};

	const settings = async (request) => {
		try {
			if (request.method === 'GET') {
				const limits = { timeoutMs: config.timeoutMs, maxDraftChars: config.maxDraftChars };
				const lightweight = new URL(request.url).searchParams.get('catalog') === '0';
				return Response.json({ ok: true, values: readPrefs(), limits, capabilities: { draftImages: true, imageLimits: IMAGE_LIMITS }, ...(lightweight ? {} : { catalog: await modelCatalog(ctx) }) });
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
