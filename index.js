/**
 * Host half of prompt-craft.
 *
 * Registers one authenticated enhancement route and one settings route on the
 * shared browser channel. No work happens at activation: the model call, the
 * history read and the gate all run per request, so an unused button costs
 * nothing.
 *
 * @module dsh-prompt-craft
 */

import { createHandlers } from './lib/route.js';

/** Cordis function-plugin name. */
export const name = 'prompt-craft';

/**
 * `connection` is required: the routes are registered on the shared fetch
 * handler that already carries the Harness session and origin checks.
 * Everything else (`llm`, `sessions`, `sessionProjections`) is resolved through
 * `ctx.get` at call time so the plugin stays active in profiles without them.
 */
export const inject = ['connection'];

/** Route paths the browser half calls. */
export const ENHANCE_PATH = '/api/prompt-craft/enhance';
export const SETTINGS_PATH = '/api/prompt-craft/settings';

/** Operator limits; the settings page owns user preferences, not these. */
const DEFAULTS = Object.freeze({
	maxDraftChars: 6000,
	maxOutputTokens: 3000,
	timeoutMs: 60_000,
	contextMessages: 8,
	contextChars: 6000,
});

/** Clamp one positive integer option against its default and a hard cap. */
function positiveInteger(value, fallback, cap) {
	const number = Number(value);
	if (!Number.isFinite(number) || number < 1) return fallback;
	return Math.min(Math.floor(number), cap);
}

/**
 * Normalize the row's `config` without a schema: an unknown or malformed field
 * falls back to its default instead of disabling the plugin.
 *
 * @param {unknown} raw - the Loader row's config.
 * @returns {typeof DEFAULTS} the resolved limits.
 */
export function resolveConfig(raw) {
	const config = raw !== null && typeof raw === 'object' ? raw : {};
	return {
		maxDraftChars: positiveInteger(config.maxDraftChars, DEFAULTS.maxDraftChars, 100_000),
		maxOutputTokens: positiveInteger(config.maxOutputTokens, DEFAULTS.maxOutputTokens, 64_000),
		timeoutMs: positiveInteger(config.timeoutMs, DEFAULTS.timeoutMs, 600_000),
		contextMessages: positiveInteger(config.contextMessages, DEFAULTS.contextMessages, 40),
		contextChars: positiveInteger(config.contextChars, DEFAULTS.contextChars, 100_000),
	};
}

/**
 * Register both routes.
 *
 * @param {object} ctx - Host context carrying `connection`.
 * @param {unknown} rawConfig - the Loader row's config.
 * @returns {void}
 */
export function apply(ctx, rawConfig) {
	const config = resolveConfig(rawConfig);
	const lifetime = new AbortController();
	ctx.effect(() => () => lifetime.abort(), 'prompt-craft: cancel in-flight requests on unload');

	const handlers = createHandlers(ctx, config, lifetime.signal);
	ctx.effect(
		() =>
			ctx.connection.fetch.register({
				path: ENHANCE_PATH,
				methods: ['POST'],
				requestBody: 'buffered',
				fetch: handlers.enhance,
			}),
		'prompt-craft: enhance route',
	);
	ctx.effect(
		() =>
			ctx.connection.fetch.register({
				path: SETTINGS_PATH,
				methods: ['GET', 'POST'],
				requestBody: 'buffered',
				fetch: handlers.settings,
			}),
		'prompt-craft: settings route',
	);
}
