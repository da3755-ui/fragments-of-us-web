// Retelling: the last step before anything is shown or stored as output.
//
// The rules in transform.js decide what the memory holds. This step decides
// how it is *told*, so that nobody can read a contributor's original
// message back out of it while every sentence stays understandable:
//
//   1. re-pair   every subject is told with another sentence's verb, and
//                place phrases rotate to other sentences
//   2. person    I / we / you / my / your ... become someone / they / their
//   3. tense     everything is retold in the past ("remembers" -> "remembered")
//   4. wording   common words are replaced with near-synonyms
//   5. guarantee no run of four words from any original message survives;
//                if one does, a quiet modifier is woven into it
//
// The internal state is never changed, only a copy of it, so the rules keep
// working on what people actually wrote.

const G = require('./grammar');

// --- vocabulary --------------------------------------------------------------
const NOUNS = parse(`
sea: tide ocean | ocean: sea tide | water: current tide | rain: drizzle downpour | storm: squall tempest
wind: breeze gust | sky: heavens | sun: daylight | moon: crescent | star: spark | light: glow brightness
night: dusk | morning: dawn daybreak | day: daylight | evening: dusk twilight | shadow: shade
city: town | street: lane road | road: path lane | house: dwelling | room: chamber
kitchen: hearth | door: doorway threshold | window: pane | wall: brickwork | floor: ground | bed: pillow
table: counter | drawer: cupboard box | box: case | letter: note | book: volume | page: leaf
photo: picture | picture: image | song: tune melody | music: melody | voice: whisper | word: phrase
name: label | face: gaze | eye: gaze | hand: palm | heart: pulse | footstep: step tread | step: footfall
friend: companion | grandpa: elder | grandma: elder | mom: parent | mum: parent | dad: parent
papa: parent | mama: parent | mother: parent | father: parent | grandmother: elder | grandfather: elder
sister: sibling | brother: sibling | child: little one | family: kin | man: figure | woman: figure
tree: branch | flower: blossom | garden: yard | river: stream | bridge: crossing | harbour: port dock
harbor: port dock | station: platform | train: carriage | school: classroom | time: hours | year: season
summer: heat | winter: cold | memory: recollection | dream: vision | story: tale | echo: reverberation
silence: hush | fire: flame | smoke: haze | salt: brine | stone: pebble | sand: dust | snow: frost
cloud: mist | bird: wing | dog: hound | phone: screen | coffee: brew | tea: brew | bread: loaf | food: meal
smell: scent | sound: noise | place: spot | world: earth | life: days | love: tenderness | fear: dread
road: path | field: meadow | hill: slope | mountain: peak | island: isle | boat: vessel | ship: vessel
`);
const IRREGULAR_PLURAL_NOUNS = { people: 'others', children: 'little ones', men: 'figures', women: 'figures' };

const MODIFIERS = parse(`
old: aged weathered | new: fresh | small: little | little: small | big: vast | quiet: hushed still
loud: noisy | soft: gentle | warm: mild | cold: cool | dark: dim | bright: vivid | happy: glad
sad: heavy | empty: hollow | open: ajar | lost: missing | slow: unhurried | fast: swift | quieter: softer
softly: gently quietly | loudly: aloud boldly | slowly: gradually | always: forever | never: not once
anymore: these days | again: once more | together: side by side | alone: by themselves | often: frequently
far: distant | beautiful: lovely | strange: odd | tired: weary | last: final | every: each | quietly: softly
gently: softly | suddenly: at once | forever: always
`);

const VERBS = parse(`
remember: recall | forget: let go | fold: crease | hum: murmur | whisper: murmur | sing: chant
dance: sway | keep: hold store | wait: linger | walk: wander stroll | speak: murmur | say: murmur
look: gaze | see: glimpse notice | watch: observe | hear: catch | listen: hear | love: cherish
miss: long for ache for | want: wish for | run: hurry rush | fall: drop tumble
follow: trail | close: shut | drift: float wander | float: drift | flow: stream | cry: weep
laugh: chuckle | smile: grin | sleep: rest | dream: imagine | hold: clutch | carry: bear
break: crack | write: scribble | call: summon | come: arrive | go: wander | return: come back
grow: swell | burn: blaze | shine: gleam | glow: shine | fade: dim | stay: remain | live: dwell
die: perish | know: sense | think: wonder | feel: sense | touch: brush | hope: wish | find: discover
lose: misplace | hide: conceal | wake: stir | rise: climb | sit: rest | begin: start | end: cease
stop: halt | change: shift | move: shift | travel: journey | share: pass on | give: offer | bring: carry
make: shape | tell: murmur | answer: reply | meet: find | turn: spin | shake: tremble | tremble: shiver
breathe: sigh | eat: taste | drink: sip | kiss: brush | hug: hold | echo: repeat | linger: stay
vanish: disappear | appear: emerge | become: turn into
`);

const PERSON = {
  me: 'them', us: 'them', my: 'their', our: 'their', your: 'their', mine: 'theirs', ours: 'theirs',
  yours: 'theirs', myself: 'themselves', ourselves: 'themselves', yourself: 'themselves',
  yourselves: 'themselves', i: 'they', we: 'they', you: 'them'
};
const SUBJECT_PERSON = { i: 'someone', we: 'they', you: 'someone else' };

const PAST_NEGATIVE = {
  "don't": "didn't", "doesn't": "didn't", "isn't": "wasn't", "aren't": "weren't", "can't": "couldn't",
  "won't": "wouldn't", "haven't": "hadn't", "hasn't": "hadn't", "shouldn't": "shouldn't"
};
const MODAL_PAST = { will: 'would', can: 'could', shall: 'should', may: 'might' };
const AUX = new Set(['am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'has', 'have', 'had', 'do', 'does', 'did', ...G.MODALS]);

// Weave-in words used only when a long run of someone's original wording
// would otherwise survive.
const WEAVE_ADJ = ['faint', 'distant', 'half-remembered', 'pale', 'borrowed', 'quiet', 'small'];

function parse(src) {
  const map = {};
  for (const entry of src.split(/\||\n/)) {
    const [k, v] = entry.split(':');
    if (!k || !v) continue;
    map[k.trim()] = v.trim().split(/\s{1,}(?=[a-z])/).length && v.trim();
  }
  // values are space-separated alternatives, except known multi-word ones
  const multi = ['long for', 'ache for', 'let go', 'wish for', 'come back', 'pass on', 'turn into', 'little one',
    'not once', 'these days', 'once more', 'side by side', 'by themselves', 'at once'];
  for (const k of Object.keys(map)) {
    let v = map[k];
    const opts = [];
    for (const m of multi) if (v.includes(m)) { opts.push(m); v = v.replace(m, ' '); }
    opts.push(...v.split(/\s+/).filter(Boolean));
    map[k] = opts;
  }
  return map;
}

// --- helpers ------------------------------------------------------------------
function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
const choose = (opts, key) => opts[hash32(key) % opts.length];
const plural = (w) => (/(s|sh|ch|x|z)$/.test(w) ? w + 'es' : /[^aeiou]y$/.test(w) ? w.slice(0, -1) + 'ies' : w + 's');
const norm = (w) => w.toLowerCase().replace(/[.,]/g, '');

function nounSwap(w, key) {
  if (IRREGULAR_PLURAL_NOUNS[w]) return IRREGULAR_PLURAL_NOUNS[w];
  if (NOUNS[w]) return choose(NOUNS[w], key + w);
  const sing = w.endsWith('ies') ? w.slice(0, -3) + 'y' : w.endsWith('es') && NOUNS[w.slice(0, -2)] ? w.slice(0, -2) : w.endsWith('s') ? w.slice(0, -1) : null;
  if (sing && NOUNS[sing]) {
    const s = choose(NOUNS[sing], key + sing);
    return s.includes(' ') ? s.replace(/(\w+)$/, (x) => plural(x)) : plural(s);
  }
  return null;
}

// Rewrite one ordinary word (not the finite verb): person, modifiers, nouns.
// `next` lets "you" before a verb ("you would stay") become a subject.
function word(w, key, isSubjectStart, next) {
  if (isSubjectStart && SUBJECT_PERSON[w]) return SUBJECT_PERSON[w];
  if (w === 'you' && next && G.verbInfo(next)) return 'they';
  if (PERSON[w]) return PERSON[w];
  const poss = w.match(/^(.+)'s$/);
  if (poss) { const n = nounSwap(poss[1], key); if (n) return n + "'s"; }
  if (MODIFIERS[w]) return choose(MODIFIERS[w], key + w);
  return nounSwap(w, key) || w;
}

// Retell a verb chain in the past: "keeps" -> "held", "is waiting" -> "was waiting".
function pastChain(words, key) {
  const out = words.slice();
  const first = out[0];
  if (PAST_NEGATIVE[first]) out[0] = PAST_NEGATIVE[first];
  else if (MODAL_PAST[first]) out[0] = MODAL_PAST[first];
  else {
    const info = G.verbInfo(first);
    if (info) {
      let base = info.base;
      const isAux = AUX.has(first);
      if (!isAux && base && VERBS[base]) base = choose(VERBS[base], key + base);
      if (info.form === 'be-present') out[0] = first === 'are' ? 'were' : 'was';
      else if (first === 'has' || first === 'have') out[0] = 'had';
      else if (first === 'do' || first === 'does') out[0] = 'did';
      else if (base && (info.form === 'base' || info.form === '3sg')) out[0] = G.inflect(base, 'past');
      else if (base && base !== info.base) out[0] = G.inflect(base, info.form);
    }
  }
  // a main verb after an auxiliary keeps its form but may change its word
  for (let i = 1; i < out.length && AUX.has(words[i - 1]); i++) {
    const info = G.verbInfo(out[i]);
    if (info && info.base && VERBS[info.base] && !AUX.has(out[i])) {
      out[i] = G.inflect(choose(VERBS[info.base], key + info.base), info.form === 'base' ? 'base' : info.form);
    }
  }
  return out.join(' ').split(' ');
}

function verbChainLength(words) {
  if (!words.length) return 0;
  let n = 1;
  while (n < words.length && AUX.has(words[n - 1]) && (G.verbInfo(words[n]) || words[n] === 'not')) n++;
  return n;
}

// Past tense needs agreement only for "was/were".
function agreePast(subject, chain) {
  if (chain[0] !== 'was' && chain[0] !== 'were') return chain;
  const p = G.subjectPerson(subject);
  return [p === 'plural' ? 'were' : 'was', ...chain.slice(1)];
}

// Leading adverbs, then the verb chain in the past, then the rest.
function retellPredicate(subject, words, key) {
  let lead = 0;
  while (lead < words.length - 1 && (G.ADVERBS.has(words[lead]) || (/ly$/.test(words[lead]) && !G.verbInfo(words[lead])))) lead++;
  const adv = words.slice(0, lead).map((w) => word(w, key, false));
  const body = words.slice(lead);
  const n = verbChainLength(body);
  const chain = agreePast(subject, pastChain(body.slice(0, n), key));
  const rest = body.slice(n);
  const restOut = rest.map((w, i) => word(w, key, false, rest[i + 1]));
  return [...adv, ...chain, ...restOut];
}

// --- the retelling -----------------------------------------------------------
function retell(state) {
  const clauses = state.flatMap((s) => s.clauses);

  // 1. re-pair subjects with other sentences' verbs (a derangement where possible)
  const full = clauses.filter((c) => c.subj && c.pred);
  if (full.length >= 2) {
    const n = full.length;
    let k = 1;
    for (let t = 1; t < n; t++) {
      if (full.every((c, i) => full[(i + t) % n].subj.src !== c.pred.src || c.pred.src === 0)) { k = t; break; }
    }
    const subjects = full.map((c) => c.subj);
    full.forEach((c, i) => { c.subj = subjects[(i + k) % n]; });
  }
  // rotate place phrases one sentence onward
  const owners = [];
  for (const c of clauses) c.tails.forEach((t, i) => { if (t.kind === 'place') owners.push([c, i]); });
  if (owners.length >= 2) {
    const tails = owners.map(([c, i]) => c.tails[i]);
    owners.forEach(([c, i], j) => { c.tails[i] = tails[(j + 1) % tails.length]; });
  }

  // 2–4. person, tense, wording
  clauses.forEach((c, ci) => {
    const key = `c${ci}`;
    if (c.subj) c.subj.words = c.subj.words.map((w, i) => word(w, key, i === 0));
    if (c.frag) c.frag.words = c.frag.words.map((w, i) => word(w, key, i === 0));
    if (c.pred) c.pred.words = retellPredicate(c.subj.words, c.pred.words, key);
    for (const t of c.tails) {
      const after = t.words.slice(1);
      const ownSubject = t.kind === 'bound' && after.length > 1 && G.findVerb(after) > 0 && !G.verbInfo(after[0]);
      if (ownSubject) {
        // "and i am tired": a clause with its own subject
        const v = G.findVerb(after);
        const subj = after.slice(0, v).map((w, i) => word(w, key, i === 0));
        t.words = [t.words[0], ...subj, ...retellPredicate(subj, after.slice(v), key + 'b')];
      } else if (t.kind === 'bound' && after.length && (G.verbInfo(after[0]) || G.ADVERBS.has(after[0]))) {
        // "and remember loudly": shares the clause's subject
        t.words = [t.words[0], ...retellPredicate(c.subj ? c.subj.words : ['it'], after, key + 'b')];
      } else {
        t.words = t.words.map((w, i) => word(w, key, false, t.words[i + 1]));
      }
    }
    for (const ch of [c.subj, c.pred, c.frag, ...c.tails]) {
      if (ch && ch.ghost) ch.ghost = ch.ghost.split(' ').map((w) => word(w, key, false)).join(' ');
    }
  });
  return state;
}

// Fix a/an, and give bare kinship nouns an article ("grandpa" -> "an elder").
const NEEDS_ARTICLE = new Set(['elder', 'parent', 'companion', 'sibling']);
const OWNERS = new Set(['their', 'theirs', 'his', 'her', 'its', 'the', 'a', 'an', 'each', 'every', 'this', 'that', 'no', 'some', 'aged', 'weathered', 'old', 'faint', 'distant', 'pale', 'quiet', 'small', 'borrowed', 'half-remembered']);
function polish(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    const bare = norm(tokens[i].w);
    const prev = i > 0 ? norm(tokens[i - 1].w).replace(/'s$/, '') : '';
    const prevPossessive = i > 0 && /'s$/.test(tokens[i - 1].w);
    if (NEEDS_ARTICLE.has(bare) && !OWNERS.has(prev) && !prevPossessive) {
      const start = tokens[i].start;
      tokens.splice(i, 0, { w: 'a', src: tokens[i].src, age: tokens[i].age, echoes: 0, ghost: null, start });
      tokens[i + 1].start = false;
      i++;
    }
  }
  for (let i = 0; i < tokens.length - 1; i++) {
    const t = tokens[i];
    const bare = norm(t.w);
    if (bare !== 'a' && bare !== 'an') continue;
    const next = norm(tokens[i + 1].w);
    const vowel = /^(hour|honest|heir)/.test(next) || (/^[aeiou]/.test(next) && !/^(one|uni|use|eu)/.test(next));
    t.w = t.w.replace(/^an?/, vowel ? 'an' : 'a');
  }
  return tokens;
}

// 5. guarantee: break any surviving run of 4+ consecutive original words.
const RUN = 4;
function breakRuns(tokens, messages, tokenize) {
  const grams = new Set();
  for (const m of messages) {
    const ws = tokenize(m.text);
    for (let i = 0; i + RUN <= ws.length; i++) grams.add(ws.slice(i, i + RUN).join(' '));
  }
  for (let pass = 0; pass < 20; pass++) {
    let hit = -1;
    for (let i = 0; i + RUN <= tokens.length; i++) {
      if (grams.has(tokens.slice(i, i + RUN).map((t) => norm(t.w)).join(' '))) { hit = i; break; }
    }
    if (hit < 0) return tokens;
    // weave an adjective in after a determiner inside the run; else after its first word
    let at = -1;
    for (let j = hit; j < hit + RUN - 1; j++) {
      if (G.DETERMINERS.has(norm(tokens[j].w)) && !/[.,]$/.test(tokens[j].w)) { at = j + 1; break; }
    }
    const adj = WEAVE_ADJ[(hit + pass) % WEAVE_ADJ.length];
    if (at < 0) {
      // no determiner: put "once" before the run's verb, or "and" can't be split; fall back to a pause
      at = hit + 1;
      tokens.splice(at, 0, { w: '…', src: 0, age: tokens[hit].age, echoes: 0, ghost: null, link: true });
    } else {
      tokens.splice(at, 0, { w: adj, src: 0, age: tokens[at].age, echoes: 0, ghost: null, link: true });
    }
  }
  return tokens;
}

module.exports = { retell, polish, breakRuns, RUN };
