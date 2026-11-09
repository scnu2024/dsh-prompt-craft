/**
 * Parsing of the model's JSON envelope.
 *
 * A model asked for one JSON object will sometimes answer inside a fence, with
 * a sentence before it, or with a truncated tail. The parser is deliberately
 * forgiving: a half-usable candidate is better than an empty panel, and the
 * deterministic gate downstream still rejects anything that violates the rules.
 *
 * @module dsh-prompt-craft/lib/protocol
 */

import { CANDIDATE_IDS, MAX_QUESTIONS } from './prompt.js';

/** Labels shown on the candidate card; localized here because the host emits them. */
export const CANDIDATE_LABELS = Object.freeze({ clear: '标准' });

/** One text field of a question/option may not exceed this many characters. */
const MAX_QUESTION_CHARS = 240;
const MAX_OPTION_CHARS = 60;

/**
 * Strip one outer code fence, if present.
 * @param {string} text - raw model output.
 * @returns {string} text without the fence.
 */
export function stripFence(text) {
	const match = /^\s*```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n?\s*```\s*$/u.exec(text);
	return match === null ? text : match[1];
}

/**
 * Take the widest brace-balanced object out of a text.
 * @param {string} text - raw model output.
 * @returns {string | undefined} the candidate JSON substring.
 */
function widestObject(text) {
	let start = -1;
	let depth = 0;
	let quoted = false;
	let escaped = false;
	for (let index = 0; index < text.length; index += 1) {
		const char = text[index];
		if (quoted) {
			if (escaped) escaped = false;
			else if (char === '\\') escaped = true;
			else if (char === '"') quoted = false;
			continue;
		}
		if (depth > 0 && char === '"') quoted = true;
		else if (char === '{') { if (depth++ === 0) start = index; }
		else if (char === '}' && depth > 0 && --depth === 0) {
			const candidate = text.slice(start, index + 1);
			try {
				const value = JSON.parse(candidate);
				if (Array.isArray(value?.candidates) || typeof value?.decision === 'string' || value?.status === 'needs_input') return candidate;
			} catch { /* Continue to the next balanced object. */ }
		}
	}
	return undefined;
}

/** Normalize one question entry, or drop it. */
function normalizeQuestion(entry) {
	if (entry === null || typeof entry !== 'object') return undefined;
	const q = typeof entry.q === 'string' ? entry.q.trim().slice(0, MAX_QUESTION_CHARS) : '';
	if (q.length === 0) return undefined;
	const question = { q };
	if (typeof entry.why === 'string' && entry.why.trim().length > 0) {
		question.why = entry.why.trim().slice(0, MAX_QUESTION_CHARS);
	}
	if (Array.isArray(entry.options)) {
		const options = entry.options
			.filter((option) => typeof option === 'string' && option.trim().length > 0)
			.map((option) => option.trim().slice(0, MAX_OPTION_CHARS))
			.slice(0, 4);
		if (options.length > 0) question.options = options;
	}
	return question;
}

/** Normalize one candidate entry, or drop it. */
function normalizeCandidate(entry, index) {
	if (entry === null || typeof entry !== 'object') return undefined;
	const raw = typeof entry.text === 'string' ? entry.text : typeof entry.prompt === 'string' ? entry.prompt : '';
	const text = raw.trim();
	if (text.length === 0) return undefined;
	const id = CANDIDATE_IDS.includes(entry.id) ? entry.id : CANDIDATE_IDS[index] ?? 'clear';
	return { id, label: CANDIDATE_LABELS[id] ?? CANDIDATE_LABELS.clear, text };
}

/**
 * Parse one model answer into questions and candidates.
 *
 * @param {string} raw - the model's text output.
 * @returns {{questions: Array<object>, candidates: Array<object>, parsed: boolean}} the envelope.
 */
export function parseEnvelope(raw) {
	const fallback = (text) => {
		const cleaned = typeof text === 'string' ? text.trim() : '';
		const invalid = /^[\[{]/u.test(cleaned) || /"(?:questions|candidates)"\s*:/u.test(cleaned);
		const candidates = cleaned.length === 0 || invalid ? [] : [{ id: 'clear', label: CANDIDATE_LABELS.clear, text: cleaned }];
		return { questions: [], candidates, parsed: false, invalid };
	};
	if (typeof raw !== 'string' || raw.trim().length === 0) return fallback('');

	const attempts = [raw.trim()];
	const unfenced = stripFence(raw.trim());
	if (unfenced !== attempts[0]) attempts.push(unfenced);
	const object = widestObject(unfenced);
	if (object !== undefined && object !== unfenced) attempts.push(object);

	for (const attempt of attempts) {
		let value;
		try {
			value = JSON.parse(attempt);
		} catch {
			continue;
		}
		// A bare array of candidates is a reasonable near miss.
		if (Array.isArray(value)) {
			const candidates = value.map((entry, index) => normalizeCandidate(entry, index)).filter(Boolean).slice(0, CANDIDATE_IDS.length);
			if (candidates.length > 0) return { questions: [], candidates, parsed: true };
			continue;
		}
		if (value === null || typeof value !== 'object') continue;
		const questions = (Array.isArray(value.questions) ? value.questions : [])
			.map(normalizeQuestion)
			.filter(Boolean)
			.slice(0, MAX_QUESTIONS);
		const candidates = (Array.isArray(value.candidates) ? value.candidates : [])
			.map((entry, index) => normalizeCandidate(entry, index))
			.filter(Boolean)
			.slice(0, CANDIDATE_IDS.length);
		// The same text twice is one candidate, not two.
		const seen = new Set();
		const unique = candidates.filter((candidate) => {
			if (seen.has(candidate.text)) return false;
			seen.add(candidate.text);
			return true;
		});
		if (unique.length > 0 || (value.status === 'needs_input' && questions.length > 0)) return { questions, candidates: unique, changes: normalizeChanges(value.changes), parsed: true };
	}
	return fallback(unfenced);
}

/** Only declared, bounded change records cross the model boundary. */
export function normalizeChanges(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(x => x && typeof x.id === 'string' && typeof x.summary === 'string' && x.summary.trim())
    .slice(0, 8).map(x => ({ id: x.id.slice(0, 40), summary: x.summary.trim().slice(0, 240) }));
}

export function parseAnalysis(raw, imageIndexes = []) {
  if (typeof raw !== 'string') return undefined;
  const text = stripFence(raw.trim());
  let value;
  try { value = JSON.parse(widestObject(text) ?? text); } catch { return undefined; }
  if (!value || !['ask', 'rewrite', 'unchanged'].includes(value.decision)) return undefined;
  const explicitReason = typeof value.reason === 'string' ? value.reason.trim() : '';
  const questions = (Array.isArray(value.questions) ? value.questions : []).map(normalizeQuestion).filter(Boolean).slice(0, MAX_QUESTIONS);
  const improvements = (Array.isArray(value.improvements) ? value.improvements : [])
    .filter(x => x && typeof x.id === 'string' && x.id.trim() && typeof x.action === 'string' && x.action.trim() && typeof x.gap === 'string' && x.gap.trim())
    .slice(0, 8).map(x => ({ id: x.id.trim().slice(0, 40), gap: x.gap.trim().slice(0, 400), action: x.action.trim().slice(0, 400) }));
  if (value.decision === 'ask' && !questions.length) return undefined;
  if (value.decision === 'rewrite' && (!improvements.length || new Set(improvements.map(x => x.id)).size !== improvements.length)) return undefined;
  const reason = explicitReason || (value.decision === 'ask' ? questions[0]?.why : value.decision === 'rewrite' ? improvements[0]?.gap : '');
  if (!reason) return undefined;
  const strings = v => (Array.isArray(v) ? v : []).filter(x => typeof x === 'string').slice(0, 32).map(x => x.slice(0, 500));
  const observations = value.imageObservations ?? [];
  if (!Array.isArray(observations) || observations.length > 8 || observations.some(x => !x || !imageIndexes.includes(x.index) || !Array.isArray(x.facts) || x.facts.length > 16 || x.facts.some(f => typeof f !== 'string' || !f.trim() || f.length > 300))) return undefined;
  return { decision: value.decision, category: String(value.category ?? 'everyday').slice(0, 40), goal: String(value.goal ?? '').slice(0, 500),
    confirmedFacts: strings(value.confirmedFacts), restrictions: strings(value.restrictions), questions,
    ...(observations.length ? { imageObservations: observations.map(x => ({ index: x.index, facts: x.facts.map(f => f.trim()) })) } : {}),
    improvements, reason: reason.slice(0, 500) };
}
