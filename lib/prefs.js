/**
 * User preferences that survive restart, kept in one small JSON file.
 *
 * These are not operator limits: they are the switches the settings page owns.
 * Keeping them out of the profile patch means saving a preference never edits a
 * file the user also edits by hand, and never restarts the plugin.
 *
 * @module dsh-prompt-craft/lib/prefs
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Longest preference note the prompt accepts. */
export const MAX_PREFERENCES_CHARS = 2000;

/** @type {{version: number, preferences: string, context: boolean, showDiff: boolean, provider: string, model: string}} */
export const DEFAULT_PREFS = Object.freeze({
	version: 1,
	preferences: '',
	context: true,
	showDiff: true,
	provider: '',
	model: '',
});

/**
 * Where the preference file lives.
 *
 * `DSH_PROMPT_CRAFT_SETTINGS` exists so tests never touch the real file.
 *
 * @param {NodeJS.ProcessEnv} [env] - environment to read.
 * @returns {string} absolute file path.
 */
export function settingsPath(env = process.env) {
	const override = env?.DSH_PROMPT_CRAFT_SETTINGS;
	if (typeof override === 'string' && override.trim().length > 0) return path.resolve(override.trim());
	const home = typeof env?.DSH_HOME === 'string' && env.DSH_HOME.trim().length > 0 ? env.DSH_HOME.trim() : path.join(os.homedir(), '.dsh');
	return path.join(home, 'prompt-craft', 'settings.json');
}

/**
 * Coerce whatever was on disk (or in a request) into the exact shape.
 * @param {unknown} raw - arbitrary value.
 * @returns {typeof DEFAULT_PREFS} the sanitized preferences.
 */
export function sanitizePrefs(raw) {
	const source = raw !== null && typeof raw === 'object' ? raw : {};
	const preferences = typeof source.preferences === 'string' ? source.preferences.slice(0, MAX_PREFERENCES_CHARS) : '';
	const provider = typeof source.provider === 'string' ? source.provider.trim().slice(0, 120) : '';
	const model = typeof source.model === 'string' ? source.model.trim().slice(0, 160) : '';
	// A pin is only usable as a pair; half a pin would silently fall back.
	const pinned = provider.length > 0 && model.length > 0;
	return {
		version: 1,
		preferences,
		context: typeof source.context === 'boolean' ? source.context : DEFAULT_PREFS.context,
		showDiff: typeof source.showDiff === 'boolean' ? source.showDiff : DEFAULT_PREFS.showDiff,
		provider: pinned ? provider : '',
		model: pinned ? model : '',
	};
}

/**
 * Read the preferences; never throws.
 * @param {string} [filePath] - override for tests.
 * @returns {typeof DEFAULT_PREFS} the stored preferences, or the defaults.
 */
export function readPrefs(filePath = settingsPath()) {
	let text;
	try {
		text = fs.readFileSync(filePath, 'utf8');
	} catch {
		return { ...DEFAULT_PREFS };
	}
	try {
		return sanitizePrefs(JSON.parse(text));
	} catch {
		// A corrupt file must not disable the feature; park it for inspection.
		try {
			fs.renameSync(filePath, `${filePath}.corrupt`);
		} catch {
			// Losing the copy is acceptable; the defaults are already correct.
		}
		return { ...DEFAULT_PREFS };
	}
}

/**
 * Merge a patch into the stored preferences and write atomically.
 *
 * @param {object} patch - fields to change.
 * @param {string} [filePath] - override for tests.
 * @returns {{ok: true, prefs: object} | {ok: false, error: string}} the outcome.
 */
export function writePrefs(patch, filePath = settingsPath()) {
	const merged = sanitizePrefs({ ...readPrefs(filePath), ...(patch !== null && typeof patch === 'object' ? patch : {}) });
	try {
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		const temporary = `${filePath}.${process.pid}.tmp`;
		fs.writeFileSync(temporary, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
		fs.renameSync(temporary, filePath);
		return { ok: true, prefs: merged };
	} catch (error) {
		return { ok: false, error: error?.message ?? '未知错误' };
	}
}
