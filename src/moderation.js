// Moderation for inputs (what visitors submit) and outputs (what the
// transformation produces). Deliberately rule-based and transparent:
// every rejection reason is something we can show the visitor.

const MAX_CHARS = 140;
const MIN_CHARS = 3;
const MAX_WORDS = 20;

// A small starter blocklist. Extend it for your context (and languages).
// Entries are matched against normalized words, so leetspeak like
// "sh1t" is caught by the normalizer below.
const BLOCKED_WORDS = [
  'fuck', 'fucking', 'fucker', 'shit', 'cunt', 'bitch', 'whore', 'slut',
  'nigger', 'nigga', 'faggot', 'fag', 'retard', 'retarded', 'tranny',
  'kike', 'spic', 'chink', 'paki', 'raghead', 'wetback', 'dyke',
  'rape', 'rapist', 'nazi', 'kys', 'killyourself', 'porn', 'cock', 'dick',
  'pussy', 'penis', 'vagina', 'cum', 'nude', 'nudes'
];
const BLOCKED = new Set(BLOCKED_WORDS);

// Stems that are offensive wherever they appear inside a word. Kept short
// and specific so innocent words ("therapist", "grape", "peacock") pass.
const BLOCKED_STEMS = ['fuck', 'shit', 'cunt', 'nigg', 'fagg', 'whore', 'bitch'];

// Phrases that signal threats or self-harm encouragement.
const BLOCKED_PHRASES = [
  /\bkill (yo)?u?r?self\b/i,
  /\bi will (kill|hurt|find)\b/i,
  /\bgo die\b/i,
  /\bbomb\b/i,
  /\bshoot (up|you|them)\b/i
];

// Patterns that look like identifying information.
const PII_PATTERNS = [
  { re: /[\w.+-]+@[\w-]+\.[\w.-]+/, why: 'an email address' },
  { re: /(https?:\/\/|www\.)\S+/i, why: 'a link' },
  { re: /\b[\w-]+\.(com|net|org|io|ae|co|me|app|dev|edu|gov)\b/i, why: 'a web address' },
  { re: /(\+?\d[\d\s().-]{6,}\d)/, why: 'a phone or ID number' },
  { re: /\d{5,}/, why: 'a long number' },
  { re: /(^|\s)@\w{2,}/, why: 'a social media handle' },
  { re: /\b(my name is|i am called|i'm called|call me)\b/i, why: 'a name introduction' },
  { re: /\b(i live (at|on)|my address|street|apartment|apt\.?|room \d)\b/i, why: 'a location or address' },
  { re: /\b(passport|social security|ssn|emirates id|password|pin code)\b/i, why: 'an ID or credential' }
];

const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i' };

function normalizeWord(w) {
  return w
    .toLowerCase()
    .replace(/[013457@$!]/g, (c) => LEET[c] || c)
    .replace(/[^a-z]/g, '')
    .replace(/(.)\1{2,}/g, '$1$1'); // "shiiiit" -> "shiit"
}

function containsBlockedWord(text) {
  const words = text.split(/\s+/).map(normalizeWord).filter(Boolean);
  for (const w of words) {
    if (BLOCKED.has(w)) return true;
    // collapse doubled letters too: "shiit" -> "shit"
    if (BLOCKED.has(w.replace(/(.)\1+/g, '$1'))) return true;
  }
  // Catch words spelled out with spaces ("f u c k"): squash runs of
  // single-letter words only, so "wash it" never becomes "washit".
  const runs = text.toLowerCase().match(/(?:\b\w\b[\s.\-_*]*){3,}/g) || [];
  for (const run of runs) {
    const sq = normalizeWord(run);
    if (BLOCKED.has(sq) || BLOCKED_STEMS.some((b) => sq.includes(b))) return true;
  }
  for (const w of words) {
    if (BLOCKED_STEMS.some((b) => w.includes(b))) return true;
  }
  return false;
}

// Returns { ok: true, text } or { ok: false, reason }.
function moderateInput(raw) {
  if (typeof raw !== 'string') return { ok: false, reason: 'Message must be text.' };
  // Strip control chars and zero-width chars, collapse whitespace.
  const text = raw
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202f\u2060\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length < MIN_CHARS) return { ok: false, reason: 'Message is too short.' };
  if (text.length > MAX_CHARS) return { ok: false, reason: `Keep it under ${MAX_CHARS} characters.` };
  if (text.split(' ').length > MAX_WORDS) return { ok: false, reason: `Keep it under ${MAX_WORDS} words.` };
  if (!/[a-zA-ZÀ-ɏ]{2,}/.test(text)) return { ok: false, reason: 'Message needs some words.' };
  if (/(.)\1{5,}/.test(text)) return { ok: false, reason: 'Too many repeated characters.' };
  const letters = text.replace(/[^a-zA-Z]/g, '');
  if (letters.length > 12 && letters === letters.toUpperCase()) {
    return { ok: false, reason: 'Please do not write in all caps.' };
  }

  for (const p of PII_PATTERNS) {
    if (p.re.test(text)) {
      return { ok: false, reason: `This looks like it contains ${p.why}. Please leave out anything that could identify you or someone else.` };
    }
  }
  if (containsBlockedWord(text)) return { ok: false, reason: 'This message contains language the memory will not keep.' };
  for (const re of BLOCKED_PHRASES) {
    if (re.test(text)) return { ok: false, reason: 'This message contains language the memory will not keep.' };
  }
  return { ok: true, text };
}

// Output moderation: the transformation can splice words together, so
// new offensive strings can appear that were never submitted. Mask any
// token (or adjacent pair glued together) that trips the blocklist.
const MASK = '\u2591\u2591\u2591'; // shown in place of masked words

function isBadToken(w) {
  if (!w) return false;
  const n = normalizeWord(w);
  if (BLOCKED.has(n) || BLOCKED.has(n.replace(/(.)\1+/g, '$1'))) return true;
  for (const b of BLOCKED_STEMS) if (n.includes(b)) return true;
  return false;
}

function moderateOutput(tokens) {
  let masked = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (isBadToken(t.w)) { t.w = MASK; masked++; }
    if (t.ghost && isBadToken(t.ghost)) { t.ghost = null; masked++; }
    const next = tokens[i + 1];
    if (next && isBadToken(t.w + next.w)) { next.w = MASK; masked++; }
  }
  return masked;
}

module.exports = { moderateInput, moderateOutput, normalizeWord, MAX_CHARS, MASK };
