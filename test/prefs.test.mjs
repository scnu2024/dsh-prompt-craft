import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { DEFAULT_PREFS, readPrefs, sanitizePrefs, settingsPath, writePrefs, MAX_PREFERENCES_CHARS } from '../lib/prefs.js';

function tempFile() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-craft-'));
	return path.join(dir, 'nested', 'settings.json');
}

test('settingsPath honours the override and otherwise lives under DSH_HOME', () => {
	assert.equal(settingsPath({ DSH_PROMPT_CRAFT_SETTINGS: '/tmp/x/settings.json' }), '/tmp/x/settings.json');
	assert.equal(settingsPath({ DSH_HOME: '/tmp/home' }), path.join('/tmp/home', 'prompt-craft', 'settings.json'));
});

test('a missing file reads as the defaults', () => {
	assert.deepEqual(readPrefs(tempFile()), { ...DEFAULT_PREFS });
});

test('preferences round-trip through an atomic write', () => {
	const file = tempFile();
	const written = writePrefs({ preferences: '不要分节标题', context: false, showDiff: false }, file);
	assert.equal(written.ok, true);
	const read = readPrefs(file);
	assert.equal(read.preferences, '不要分节标题');
	assert.equal(read.context, false);
	assert.equal(read.showDiff, false);
	assert.equal(read.provider, '');
});

test('a write merges with what is already stored', () => {
	const file = tempFile();
	writePrefs({ preferences: '结论先行' }, file);
	writePrefs({ context: false }, file);
	const read = readPrefs(file);
	assert.equal(read.preferences, '结论先行');
	assert.equal(read.context, false);
});

test('half a model pin is discarded, a full one is kept', () => {
	assert.deepEqual(sanitizePrefs({ provider: 'p', model: '' }), { ...DEFAULT_PREFS });
	const pinned = sanitizePrefs({ provider: 'deepseek-account', model: 'deepseek-flash' });
	assert.equal(pinned.provider, 'deepseek-account');
	assert.equal(pinned.model, 'deepseek-flash');
});

test('a very long preference note is truncated, not rejected', () => {
	const long = 'x'.repeat(MAX_PREFERENCES_CHARS + 500);
	assert.equal(sanitizePrefs({ preferences: long }).preferences.length, MAX_PREFERENCES_CHARS);
});

test('unknown fields and wrong types fall back to defaults', () => {
	const value = sanitizePrefs({ context: 'nope', showDiff: 1, preferences: 42, extra: true });
	assert.equal(value.context, true);
	assert.equal(value.showDiff, true);
	assert.equal(value.preferences, '');
	assert.equal(Object.hasOwn(value, 'extra'), false);
});

test('a corrupt file falls back to defaults and is parked', () => {
	const file = tempFile();
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, '{not json', 'utf8');
	assert.deepEqual(readPrefs(file), { ...DEFAULT_PREFS });
	assert.equal(fs.existsSync(`${file}.corrupt`), true);
});

test('an unwritable path reports failure instead of throwing', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-craft-'));
	const blocker = path.join(dir, 'blocker');
	fs.writeFileSync(blocker, 'x', 'utf8');
	const result = writePrefs({ preferences: 'x' }, path.join(blocker, 'settings.json'));
	assert.equal(result.ok, false);
	assert.equal(typeof result.error, 'string');
});
