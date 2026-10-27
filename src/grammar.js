// A deliberately small, transparent grammar. It does not "understand"
// English; it knows enough to cut a message into phrases that can be moved
// without breaking the sentence, to find where the verb starts, and to fix
// subject–verb agreement when a subject is swapped.

// --- word classes ------------------------------------------------------------
const PREPOSITIONS = new Set([
  'in', 'on', 'at', 'over', 'under', 'through', 'into', 'onto', 'across', 'beside',
  'between', 'behind', 'beyond', 'by', 'with', 'without', 'near', 'from', 'toward',
  'towards', 'after', 'before', 'inside', 'outside', 'along', 'around', 'against',
  'past', 'beneath', 'below', 'above', 'among', 'within', 'during', 'like', 'upon', 'for'
]);
const CONJUNCTIONS = new Set([
  'and', 'but', 'or', 'while', 'when', 'where', 'because', 'as', 'until', 'so',
  'though', 'although', 'if', 'yet', 'since', 'unless', 'once'
]);
const DETERMINERS = new Set([
  'the', 'a', 'an', 'my', 'your', 'our', 'their', 'his', 'her', 'its', 'every',
  'this', 'that', 'these', 'those', 'some', 'no', 'each', 'all', 'any', 'one',
  'another', 'many', 'few', 'several', 'what', 'whose', 'which'
]);
const SUBJECT_PRONOUNS = {
  i: 'first', we: 'plural', you: 'plural', they: 'plural',
  he: 'single', she: 'single', it: 'single', nobody: 'single', everyone: 'single',
  someone: 'single', nothing: 'single', everything: 'single', something: 'single',
  everybody: 'single', somebody: 'single', anyone: 'single', this: 'single', that: 'single'
};
const IRREGULAR_PLURALS = new Set(['people', 'children', 'men', 'women', 'feet', 'teeth', 'mice', 'geese']);
const STOPWORDS = new Set([
  ...PREPOSITIONS, ...CONJUNCTIONS, ...DETERMINERS, ...Object.keys(SUBJECT_PRONOUNS),
  'is', 'are', 'am', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
  'do', 'does', 'did', 'not', 'to', 'of', 'me', 'us', 'them', 'him', 'here', 'there',
  'just', 'very', 'still', 'too', 'yet', 'then', 'now'
]);

const ADVERBS = new Set(['never', 'always', 'still', 'often', 'just', 'once', 'sometimes', 'also', 'rarely', 'barely', 'already', 'ever', 'only', 'even', 'really', 'finally', 'suddenly', 'quietly', 'slowly', 'softly', 'not']);

// --- verbs -------------------------------------------------------------------
const MODALS = new Set(['can', 'could', 'will', 'would', 'shall', 'should', 'may', 'might', 'must']);

// present tense pairs that change with the subject
const BE_PRESENT = { first: 'am', single: 'is', plural: 'are' };
const BE_PAST = { first: 'was', single: 'was', plural: 'were' };

const IRREGULAR = {
  // base: [past, past participle]
  be: ['was', 'been'], have: ['had', 'had'], do: ['did', 'done'], go: ['went', 'gone'],
  come: ['came', 'come'], become: ['became', 'become'], leave: ['left', 'left'],
  see: ['saw', 'seen'], find: ['found', 'found'], keep: ['kept', 'kept'], hold: ['held', 'held'],
  know: ['knew', 'known'], grow: ['grew', 'grown'], fall: ['fell', 'fallen'],
  forget: ['forgot', 'forgotten'], feel: ['felt', 'felt'], think: ['thought', 'thought'],
  bring: ['brought', 'brought'], sleep: ['slept', 'slept'], speak: ['spoke', 'spoken'],
  break: ['broke', 'broken'], take: ['took', 'taken'], give: ['gave', 'given'],
  make: ['made', 'made'], say: ['said', 'said'], tell: ['told', 'told'], sing: ['sang', 'sung'],
  swim: ['swam', 'swum'], run: ['ran', 'run'], sit: ['sat', 'sat'], stand: ['stood', 'stood'],
  lose: ['lost', 'lost'], meet: ['met', 'met'], write: ['wrote', 'written'], drive: ['drove', 'driven'],
  rise: ['rose', 'risen'], wake: ['woke', 'woken'], weep: ['wept', 'wept'], dream: ['dreamt', 'dreamt'],
  burn: ['burnt', 'burnt'], fly: ['flew', 'flown'], draw: ['drew', 'drawn'], throw: ['threw', 'thrown'],
  hear: ['heard', 'heard'], hide: ['hid', 'hidden'], begin: ['began', 'begun'], drink: ['drank', 'drunk'],
  sink: ['sank', 'sunk'], shine: ['shone', 'shone'], hang: ['hung', 'hung'], dig: ['dug', 'dug'],
  spin: ['spun', 'spun'], win: ['won', 'won'], sell: ['sold', 'sold'], build: ['built', 'built'],
  send: ['sent', 'sent'], spend: ['spent', 'spent'], bend: ['bent', 'bent'], get: ['got', 'gotten'],
  let: ['let', 'let'], put: ['put', 'put'], cut: ['cut', 'cut'], set: ['set', 'set'],
  shut: ['shut', 'shut'], hit: ['hit', 'hit'], read: ['read', 'read'], spread: ['spread', 'spread'],
  wear: ['wore', 'worn'], tear: ['tore', 'torn'], freeze: ['froze', 'frozen'], choose: ['chose', 'chosen'],
  blow: ['blew', 'blown'], shake: ['shook', 'shaken'], steal: ['stole', 'stolen'], lie: ['lay', 'lain'],
  lay: ['laid', 'laid'], pay: ['paid', 'paid'], catch: ['caught', 'caught'], teach: ['taught', 'taught'],
  seek: ['sought', 'sought'], buy: ['bought', 'bought'], fight: ['fought', 'fought'], mean: ['meant', 'meant'],
  eat: ['ate', 'eaten'], ring: ['rang', 'rung'], forgive: ['forgave', 'forgiven'], light: ['lit', 'lit'],
  sweep: ['swept', 'swept'], bleed: ['bled', 'bled'], feed: ['fed', 'fed'], lead: ['led', 'led'],
  slide: ['slid', 'slid'], strike: ['struck', 'struck'], swing: ['swung', 'swung'], wind: ['wound', 'wound'],
  bear: ['bore', 'borne']
};

const REGULAR = `remember fold wait walk call open close listen look stay return change move turn
carry play love miss want need hope wish learn live die cry laugh smile dance rain snow drift float
flow glow shimmer echo fade vanish appear belong linger breathe touch follow wander rest start end
stop try ask answer notice watch reach pull push hum whisper shout climb cross pass fill empty pour
melt soften harden bloom wilt shatter crumble scatter gather rebuild repeat replace erase save share
paint kiss hug pray promise remain arrive travel settle shift trace tremble shiver wave rush slip
drop count collect hurt heal mend miss knock rattle crack ache yearn long return circle whirl twist
bury carve stitch weave borrow lend owe believe imagine recall recognise recognize pretend dare care
fear worry wonder hurry visit welcome plant water warm cool fill pass mark mirror wash dry soak sail
row bounce roll use plant settle taste jump kick hunt hate like enjoy last seem happen exist matter belong live`;

const LEX = new Map(); // form -> { base, form: 'base'|'3sg'|'past'|'pp'|'ing'|'modal' }

function third(base) {
  if (/(s|sh|ch|x|z|o)$/.test(base)) return base + 'es';
  if (/[^aeiou]y$/.test(base)) return base.slice(0, -1) + 'ies';
  return base + 's';
}
function past(base) {
  if (base.endsWith('e')) return base + 'd';
  if (/[^aeiou]y$/.test(base)) return base.slice(0, -1) + 'ied';
  return base + 'ed';
}
function ing(base) {
  if (base.endsWith('ie')) return base.slice(0, -2) + 'ying';
  if (base.endsWith('e') && !base.endsWith('ee')) return base.slice(0, -1) + 'ing';
  return base + 'ing';
}
function add(form, entry) { if (!LEX.has(form)) LEX.set(form, entry); }

for (const base of REGULAR.split(/\s+/).filter(Boolean)) {
  add(base, { base, form: 'base' });
  add(third(base), { base, form: '3sg' });
  add(past(base), { base, form: 'past' });
  add(ing(base), { base, form: 'ing' });
}
for (const [base, [p, pp]] of Object.entries(IRREGULAR)) {
  add(base, { base, form: 'base' });
  add(third(base), { base, form: '3sg' });
  add(p, { base, form: 'past' });
  add(pp, { base, form: 'pp' });
  add(ing(base), { base, form: 'ing' });
}
// "have" and "do" are irregular in the present too
LEX.set('has', { base: 'have', form: '3sg' });
LEX.set('does', { base: 'do', form: '3sg' });
LEX.set('goes', { base: 'go', form: '3sg' });
add('have', { base: 'have', form: 'base' });
for (const b of ['am', 'is', 'are']) LEX.set(b, { base: 'be', form: 'be-present' });
for (const b of ['was', 'were']) LEX.set(b, { base: 'be', form: 'be-past' });
for (const m of MODALS) LEX.set(m, { base: m, form: 'modal' });

function verbInfo(word) {
  const NEG = { "can't": 'can', "won't": 'will', "shan't": 'shall' };
  const w = NEG[word] || word.replace(/n't$/, '');
  if (LEX.has(w)) return LEX.get(w);
  // doubled-consonant forms: stopped, humming
  const m = w.match(/^(.*?)([b-df-hj-np-tv-z])\2(ed|ing)$/);
  if (m && LEX.has(m[1] + m[2])) return { base: m[1] + m[2], form: m[3] === 'ed' ? 'past' : 'ing' };
  // unknown words that look like simple past tense ("whistled")
  if (w.length >= 5 && w.endsWith('ed')) return { base: null, form: 'past' };
  return null;
}

// --- subjects ----------------------------------------------------------------
function subjectPerson(words) {
  if (!words.length) return 'single';
  if (words.length === 1 && SUBJECT_PRONOUNS[words[0]]) return SUBJECT_PRONOUNS[words[0]];
  if (SUBJECT_PRONOUNS[words[0]] && !DETERMINERS.has(words[0])) return SUBJECT_PRONOUNS[words[0]];
  if (words.includes('and')) return 'plural';
  const last = words[words.length - 1];
  if (IRREGULAR_PLURALS.has(last)) return 'plural';
  if (last.length > 3 && last.endsWith('s') && !/(ss|us|is)$/.test(last)) return 'plural';
  return 'single';
}

// Find where the predicate starts in a head phrase, or -1 for a fragment.
function findVerb(words) {
  let baseCandidate = -1;
  for (let i = 1; i < words.length; i++) {
    if (DETERMINERS.has(words[i - 1]) && !SUBJECT_PRONOUNS[words[i - 1]]) continue;
    const info = verbInfo(words[i]);
    if (!info) continue;
    if (info.form === 'ing') continue; // "the falling rain" is not a verb here
    if (info.form !== 'base') return i;
    // a bare base form only counts after a plural or first-person subject
    if (baseCandidate < 0 && subjectPerson(words.slice(0, i)) !== 'single') baseCandidate = i;
  }
  return baseCandidate;
}

// Make the first word of a predicate agree with a subject.
function agree(subject, predicate) {
  if (!predicate.length) return predicate;
  const person = subjectPerson(subject);
  const [first, ...rest] = predicate;
  const neg = first.endsWith("n't") ? "n't" : '';
  const info = verbInfo(first);
  if (!info) return predicate;
  let next = first;
  if (info.form === 'be-present') next = BE_PRESENT[person];
  else if (info.form === 'be-past') next = BE_PAST[person];
  else if (info.form === '3sg' && person !== 'single') next = info.base;
  else if (info.form === 'base' && person === 'single' && info.base) {
    next = info.base === 'have' ? 'has' : info.base === 'do' ? 'does' : info.base === 'go' ? 'goes' : third(info.base);
  }
  if (neg && !next.endsWith("n't")) {
    // isn't / aren't / doesn't / don't; "amn't" is not English
    next = next === 'am' ? 'am not' : next + "n't";
    if (next === "willn't") next = "won't";
  }
  return [next, ...rest];
}

// --- phrases -----------------------------------------------------------------
// Cut a message into phrases: a head (everything before the first
// preposition or conjunction) and tails. A tail starting with a
// preposition ("over the old harbour") can move to any sentence. A tail
// starting with a conjunction ("and remember loudly") depends on its own
// subject, so it is "bound" and never moves away from it.
function phrases(words) {
  const out = [];
  let cur = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const boundary = (PREPOSITIONS.has(w) || CONJUNCTIONS.has(w)) && cur.length >= 1 && i < words.length - 1;
    if (boundary) { out.push(cur); cur = []; }
    cur.push(w);
  }
  if (cur.length) out.push(cur);
  return out;
}

function contentWords(words) {
  return words.filter((w) => !STOPWORDS.has(w) && w.length > 2);
}

function stem(w) {
  return w.replace(/(ies|es|s|ed|ing)$/, '');
}

// Build a form of any verb base (multi-word bases inflect their first word:
// "long for" -> "longed for").
function inflect(base, form) {
  const [head, ...rest] = base.split(' ');
  let w = head;
  const irr = IRREGULAR[head];
  if (form === '3sg') w = head === 'have' ? 'has' : head === 'do' ? 'does' : head === 'go' ? 'goes' : third(head);
  else if (form === 'past') w = irr ? irr[0] : past(head);
  else if (form === 'pp') w = irr ? irr[1] : past(head);
  else if (form === 'ing') w = ing(head);
  return [w, ...rest].join(' ');
}

module.exports = {
  PREPOSITIONS, CONJUNCTIONS, DETERMINERS, MODALS, findVerb, agree, phrases, contentWords, stem,
  subjectPerson, verbInfo, inflect, ADVERBS
};
