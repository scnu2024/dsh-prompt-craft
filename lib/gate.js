/** Factual fidelity, explicit restrictions and bounded, non-repeating revisions. */
import { constraintViolations } from './constraints.js';

/** At most two leading filler lines and two trailing ones are stripped. */
const LEAD_INS = [
	/^(?:好的|好|当然|没问题)[，,。.！!\s]*$/u,
	/^(?:好的|好|当然|没问题)?[，,\s]*(?:以下是|下面是|这是|这是改写后的|改写如下|已按)[^\n]{0,60}[:：]?\s*$/u,
	/^(?:here(?:'s| is)|below is|sure|certainly|of course|i(?:'ve| have) rewritten)[^\n]{0,80}$/iu,
	/^[`"']{3,}\s*(?:json|text)?\s*$/iu,
];

const CLOSERS = [
	/^(?:希望(?:这|以上|这个|对你)|如需|如果需要|如果还想|有任何|欢迎(?:随时)?)[^\n]{0,100}$/u,
	/^(?:hope this|let me know|feel free|i hope)[^\n]{0,120}$/iu,
	/^[`"']{3,}\s*$/u,
];

const HEADING_RE = /^\s{0,3}#{1,6}\s+\S/u;
const LABEL_RE = /^\s{0,2}(?:\*\*)?(?:目标|背景|要求|约束|条件|输出格式|输出|注意事项|验收标准|任务|输入|参考资料|交付物)[^\n:：]{0,4}[:：]/iu;
const ENGLISH_LABEL_RE = /^\s{0,2}(?:\*\*)?(?:goal|context|requirements?|constraints?|output format|deliverables?|acceptance criteria|notes?|task|inputs?)\s*(?:\*\*)?\s*[:：]/iu;

const PLACEHOLDER_PATTERNS = [
	/<[^<>\n]{2,40}>/gu,
	/【[^】\n]{1,20}】/gu,
	/(?:待补充|待填写|待确认|请补充|请填写|TBD|TODO)/gu,
	/\bxxx+\b/giu,
];

/** A real HTML tag is not a placeholder. */
const HTML_TAG_RE = /^<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^<>]*)?\/?>$/u;

const FACT_PATTERNS = [
	/https?:\/\/[^\s"'<>，。；）)]+/gu,
	/(?:^|[\s("'`])((?:~?\/|\.{1,2}\/)[\w.\-@/]{2,})/gu,
	/\b[A-Za-z]:\\[^\s"'<>]+/gu,
	/\bv?\d+\.\d+(?:\.\d+)?\b/gu,
	/\b[\w\-]+\.(?:md|txt|pdf|docx?|xlsx?|csv|json|ya?ml|tsx?|jsx?|py|sh|png|jpe?g|svg|zip|html?|css|toml)\b/giu,
	/`[^`\n]{1,60}`/gu,
	/@[\w\-./]+/gu,
	/\b\d+\b/gu,
	/\b\d{1,2}月\d{1,2}[日号]/gu,
	/\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/gu,
	/\b\d+\s*[-–~至]\s*\d+\b/gu,
];

/**
 * Remove presentation noise around a rewritten prompt.
 *
 * @param {unknown} raw - model output.
 * @returns {string} the cleaned text, or an empty string.
 */
export function normalizeOutput(raw) {
	if (typeof raw !== 'string') return '';
	let text = raw.replace(/\r\n?/gu, '\n').trim();
	if (text.length === 0) return '';

	// A fence around the WHOLE answer is presentation, not content.
	const fenced = /^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n?```$/u.exec(text);
	if (fenced !== null) text = fenced[1].trim();

	// Quotes around the whole answer, when the answer is not itself dialogue.
	const quoted = /^(["“「『])([\s\S]*)(["”」』])$/u.exec(text);
	if (quoted !== null && quoted[1] !== undefined && text.length > 4) {
		const pairs = { '"': '"', '“': '”', '「': '」', '『': '』' };
		if (pairs[quoted[1]] === quoted[3]) text = quoted[2].trim();
	}

	const lines = text.split('\n');
	let head = 0;
	let tail = lines.length;
	while (head < Math.min(2, tail) && LEAD_INS.some((re) => re.test(lines[head].trim()))) head += 1;
	while (tail - 1 > head && CLOSERS.some((re) => re.test(lines[tail - 1].trim()))) tail -= 1;
	text = lines.slice(head, tail).join('\n');

	return text
		.split('\n')
		.map((line) => line.replace(/\s+$/u, ''))
		.join('\n')
		.replace(/\n{3,}/gu, '\n\n')
		.trim();
}

/**
 * Count heading lines and template label lines.
 *
 * @param {string} text - candidate text.
 * @returns {number} how many template markers it carries.
 */
export function countTemplateMarkers(text) {
	let count = 0;
	for (const line of text.split('\n')) {
		if (HEADING_RE.test(line) || LABEL_RE.test(line) || ENGLISH_LABEL_RE.test(line)) count += 1;
	}
	return count;
}

/**
 * Extract the concrete facts a prompt states: URLs, paths, file names,
 * versions, identifiers, numbers, dates and ranges.
 *
 * @param {string} text - any prompt text.
 * @returns {Set<string>} normalized facts.
 */
export function extractFacts(text) {
	const facts = new Set();
	if (typeof text !== 'string' || text.length === 0) return facts;
	const listNumbers = new Set([...text.matchAll(/^\s*(\d+)[.)、]\s+/gmu)].map(match => match[1]));
	const body = text.replace(/第\s*(\d+)\s*(?:部分|项|步|条|节)|\b(?:step|section|item|point)\s+(\d+)\b/giu, (whole, cn, en) => listNumbers.has(cn ?? en) ? '' : whole)
		.replace(/^\s*(?:[-*•]|\d+[.)、])\s+/gmu, '');
	for (const pattern of FACT_PATTERNS) {
		pattern.lastIndex = 0;
		for (const match of body.matchAll(pattern)) {
			const value = Array.isArray(match) ? match[1] ?? match[0] : match[0];
			const normalized = String(value ?? '').trim().replace(/[.,;:]+$/u, '');
			if (normalized.length > 0) facts.add(normalized);
		}
	}
	return facts;
}

/**
 * Find invented placeholders in a candidate.
 *
 * @param {string} text - candidate text.
 * @returns {string[]} the placeholder tokens found.
 */
export function findPlaceholders(text) {
	const found = new Set();
	for (const pattern of PLACEHOLDER_PATTERNS) {
		pattern.lastIndex = 0;
		for (const match of text.matchAll(pattern)) {
			const token = String(match[0]);
			if (token.startsWith('<') && HTML_TAG_RE.test(token)) continue;
			found.add(token);
		}
	}
	return [...found];
}

/**
 * Run every check against one candidate.
 *
 * @param {object} input - check inputs.
 * @param {string} input.draft - the original draft.
 * @param {string} input.text - the candidate.
 * @param {string} input.id - candidate id.
 * @returns {{codes: string[], invented: string[], ratio: number}} the verdict.
 */
export function detectViolations(input) {
	const draft = typeof input.draft === 'string' ? input.draft : '';
	const text = typeof input.text === 'string' ? input.text : '';
	const codes = [];


	const sources = [draft, ...(Array.isArray(input.sources) ? input.sources.filter((value) => typeof value === 'string') : [])].join('\n');
	const draftFacts = extractFacts(sources);
	const invented = [...extractFacts(text)].filter((fact) => !draftFacts.has(fact) && (/^\d+$/u.test(fact) || !sources.includes(fact)));
	if (invented.length > 0) codes.push(`invented:${invented.length}`);
	const candidateFacts = extractFacts(text);
	if ((input.requiredFacts ?? []).some(fact => !candidateFacts.has(fact) && !text.includes(fact))) codes.push('confirmed-fact-missing');

	if (findPlaceholders(text).some((token) => !sources.includes(token))) codes.push('placeholder');

	const ratio = draft.length > 0 ? text.length / draft.length : 1;
	if (text.length > (input.maxOutputChars ?? 12000)) codes.push('output-too-long');
	if (findRepetition(text, sources).length) codes.push('repetition');
	const current = input.current ?? draft;
	if (input.operation === 'shorter' && normalizedText(text) !== normalizedText(current) && text.length >= current.length) codes.push('not-shorter');
	if ((input.versions ?? []).some(v => v.operation === input.operation && normalizedText(v.text) === normalizedText(text) && normalizedText(text) !== normalizedText(current))) codes.push('revision-cycle');
	const constraints=constraintViolations(input.constraintDraft ?? draft,text);
	if(constraints.missing.length)codes.push('constraint-missing');
	if(constraints.conflicts.length)codes.push('constraint-conflict');
	return { codes, invented, constraints, ratio: Math.round(ratio * 100) / 100 };
}

/**
 * Turn violations into the lines of a repair message.
 *
 * @param {object} verdict - output of {@link detectViolations}.
 * @returns {string[]} human-readable violation lines.
 */
export function repairLines(verdict) {
	const lines = [];
	for(const clause of verdict.constraints?.missing??[])lines.push('Restore this explicit restriction verbatim: '+clause);
	for(const conflict of verdict.constraints?.conflicts??[])lines.push('Remove conflicting requirement: '+conflict);
	if (verdict.invented.length > 0) {
		lines.push(`invented facts that are not in the draft: ${verdict.invented.slice(0, 8).join(', ')}`);
	}
	if (verdict.codes.includes('placeholder')) {
		lines.push('used a placeholder instead of asking a question');
	}
	for (const code of ['repetition', 'revision-cycle', 'not-shorter', 'output-too-long', 'unverified-changes', 'confirmed-fact-missing']) {
		if (verdict.codes.includes(code)) lines.push('Fix violation: ' + code);
	}
	return lines;
}

/** Used for progress/cycle comparison; punctuation-only edits earn no progress. */
export function normalizedText(text) {
  return String(text ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

function proseUnits(text) {
  return String(text ?? '').replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/gu, '')
    .replace(/^\s*>.*$/gmu, '').replace(/`[^`\n]*`|“[^”]*”|「[^」]*」|"[^"\n]*"/gu, '')
    .split(/[。！？!?;；\n]|\.(?=\s|$)/u)
    .map(x => normalizedText(x.replace(/^\s*(?:[-*•]|\d+[.)、])\s*/u, ''))).filter(x => x.length >= 8);
}
function similar(a, b) {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 12 || Math.min(a.length, b.length) / Math.max(a.length, b.length) < 0.85) return false;
  const grams = s => new Set(Array.from({length:s.length-1}, (_,i) => s.slice(i,i+2)));
  const left=grams(a), right=grams(b);
  const overlap=[...left].filter(x=>right.has(x)).length;
  return overlap / (left.size + right.size - overlap) >= 0.88;
}
/** Existing repetition in source material is retained, code and quotations are exempt. */
export function findRepetition(text, source = '') {
  if (/保留.{0,8}重复|重复.{0,12}[次遍]|repeat.{0,15}\btimes\b|verbatim/iu.test(source)) return [];
  const units=proseUnits(text), original=proseUnits(source), found=[];
  const originalNormalized=normalizedText(source);
  for (const unit of units) for (const match of unit.matchAll(/([\p{L}\p{N}]{8,160}?)\1+/gu)) {
    if (!originalNormalized.includes(match[0])) found.push(match[1]);
  }
  for(let i=0;i<units.length;i++) {
    const unit=units[i];
    const count=units.slice(0,i+1).filter(x=>similar(x,unit)).length;
    const allowed=Math.max(1,original.filter(x=>similar(x,unit)).length);
    if(count>allowed) found.push(unit);
  }
  return [...new Set(found)];
}
