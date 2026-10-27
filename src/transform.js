// The server-side transformation function.
//
// The memory is never edited in place. It is *reconstructed* by replaying
// every surviving message, in order, through a small set of controlled,
// deterministic rules. Each rule's randomness is seeded by the message
// itself, so the same messages always yield the same memory, and removing
// one (erase my trace) yields a different memory.
//
// To keep the result readable, rules never move single words. They move
// whole phrases (see grammar.js), so every sentence keeps a subject, a
// verb and its places: "the sea remembers every footstep" and "light folds
// over the old harbour" can become "light remembers every footstep over
// the old harbour", never "harbour footstep the folds".
//
// Structure:
//   sentence = { clauses: [clause], links: ['while'], echoes, age }
//   clause   = { subj, pred, frag, tails: [chunk] }   (subj+pred, or frag)
//   chunk    = { words: [], src, age, ghost, ghostAge, echoes, kind }

const G = require('./grammar');
const R = require('./reformulate');

// Contractions are opened up so the grammar can see subject and verb.
const CONTRACTIONS = {
  "i'm": 'i am', "i've": 'i have', "i'll": 'i will', "i'd": 'i would', "we're": 'we are',
  "we've": 'we have', "we'll": 'we will', "you're": 'you are', "you've": 'you have',
  "they're": 'they are', "they've": 'they have', "it's": 'it is', "that's": 'that is',
  "there's": 'there is', "let's": 'let us', "she's": 'she is', "he's": 'he is'
};

const SEED_TEXT = 'nothing here has been remembered yet';
const CAPACITY = 56;        // words; beyond this the memory forgets
const MAX_SENTENCES = 6;
const MAX_TAILS = 3;        // place phrases per clause
const GHOST_LIFETIME = 3;   // messages a replaced phrase lingers as a ghost
const MAX_WORDS_PER_MSG = 20;

const LINKS_CLAUSE = ['while', 'and', 'where', 'until', 'as', 'and'];
const LINKS_FRAGMENT = ['and', 'with', 'beside'];

// Exported so the front end and the privacy page can describe them.
const RULES = [
  { id: 'age', label: 'Everything already remembered grows one step older and fainter.' },
  { id: 'echo', label: 'A message that shares a word with a remembered sentence strengthens that sentence and is drawn towards it.' },
  { id: 'join', label: 'A new sentence may be joined to an old one with a small linking word (while, where, until…).' },
  { id: 'overwrite', label: 'A new subject and verb may overwrite an old one. The old words linger as a ghost, and the old places stay.' },
  { id: 'swap', label: 'Two sentences may exchange subjects; verbs change to agree ("we remember" becomes "the sea remembers").' },
  { id: 'exchange', label: 'Two sentences may trade a place phrase ("in the rain" for "over the old harbour").' },
  { id: 'forget', label: 'When the memory is full, the oldest, least-echoed phrases are forgotten first, then whole sentences.' }
];

// --- deterministic randomness -------------------------------------------
function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rand, arr) => arr[Math.floor(rand() * arr.length)];

// --- parsing -------------------------------------------------------------
function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^\p{L}\p{N}'\s-]/gu, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^['-]+|['-]+$/g, '').slice(0, 18))
    .filter(Boolean)
    .flatMap((w) => (CONTRACTIONS[w] ? CONTRACTIONS[w].split(' ') : [w]))
    .slice(0, MAX_WORDS_PER_MSG);
}

const chunk = (words, src, kind) => ({ words, src, age: 0, ghost: null, ghostAge: 0, echoes: 0, kind });

function parseClause(words, src) {
  const parts = G.phrases(words);
  if (!parts.length) return null;
  const head = parts[0];
  const clause = { subj: null, pred: null, frag: null, tails: [] };
  const startsWithPlace = G.PREPOSITIONS.has(head[0]);
  const v = startsWithPlace ? -1 : G.findVerb(head);
  // adverbs just before the verb belong to the predicate ("she | never called")
  let cut = v;
  while (cut > 1 && (G.ADVERBS.has(head[cut - 1]) || /ly$/.test(head[cut - 1]))) cut--;
  if (v > 0) {
    clause.subj = chunk(head.slice(0, cut), src, 'subj');
    clause.pred = chunk(head.slice(cut), src, 'pred');
  } else if (false) {
    clause.pred = chunk(head.slice(v), src, 'pred');
  } else {
    clause.frag = chunk(head, src, 'frag');
  }
  for (const p of parts.slice(1)) {
    clause.tails.push(chunk(p, src, G.CONJUNCTIONS.has(p[0]) ? 'bound' : 'place'));
  }
  return clause;
}

// Re-agree a clause's verbs with its (possibly new) subject, including
// verbs in its "and …" phrases ("and remember loudly" -> "and remembers loudly").
function agreeClause(c) {
  if (!c.subj || !c.pred) return;
  c.pred.words = G.agree(c.subj.words, c.pred.words);
  for (const t of c.tails) {
    if (t.kind === 'bound' && t.words.length > 1 && G.verbInfo(t.words[1])) {
      t.words = [t.words[0], ...G.agree(c.subj.words, t.words.slice(1))];
    }
  }
}

// Place phrases go before a clause's "and …" phrases, so they stay
// attached to the first verb: "forgets softly in the kitchen and remembers".
function addPlace(c, tail) {
  const i = c.tails.findIndex((t) => t.kind === 'bound');
  if (i < 0) c.tails.push(tail); else c.tails.splice(i, 0, tail);
}

const clauseChunks = (c) => [c.subj, c.pred, c.frag, ...c.tails].filter(Boolean);
const sentenceChunks = (s) => s.clauses.flatMap(clauseChunks);
const sentenceWords = (s) => sentenceChunks(s).flatMap((c) => c.words);
const totalWords = (state) => state.reduce((n, s) => n + sentenceWords(s).length + s.links.length, 0);
const text = (c) => c.words.join(' ');

function newSentence(clause) {
  return { clauses: [clause], links: [], echoes: 0, age: 0 };
}

function seedMemory() {
  const s = newSentence(parseClause(tokenize(SEED_TEXT), 0));
  s.age = 6;
  for (const c of sentenceChunks(s)) c.age = 6;
  return [s];
}

// --- one step ------------------------------------------------------------
// The log is shown to the contributor, so it only ever names their own
// words, never what anyone else wrote.
function applyMessage(state, msg) {
  const rand = mulberry32(hash32(`${msg.id}:${msg.text}`));
  const words = tokenize(msg.text);
  const log = [];
  const clause = parseClause(words, msg.id);
  if (!clause) return log;

  // 1. age
  for (const s of state) {
    s.age += 1;
    for (const c of sentenceChunks(s)) {
      c.age += 1;
      if (c.ghost && ++c.ghostAge > GHOST_LIFETIME) { c.ghost = null; c.ghostAge = 0; }
    }
  }

  // 2. echo: find the remembered sentence that shares the most words
  const mine = new Set(G.contentWords(words).map(G.stem));
  let target = null;
  let shared = [];
  for (const s of state) {
    const hits = [...new Set(G.contentWords(sentenceWords(s)).filter((w) => mine.has(G.stem(w))))];
    if (hits.length > shared.length) { target = s; shared = hits; }
  }
  if (target) {
    target.echoes += 1;
    target.age = 0;
    for (const c of sentenceChunks(target)) if (c.words.some((w) => shared.includes(w))) c.echoes += 1;
    log.push({ rule: 'echo' });
  } else {
    const older = state.filter((s) => s.age >= 2);
    if (older.length) target = pick(rand, older);
  }

  const newChunks = clauseChunks(clause);
  const roll = rand();
  const short = newChunks.reduce((n, c) => n + c.words.length, 0) <= 9;

  if (target && target.clauses.length === 1 && short && roll < 0.22) {
    // 3. join
    const link = pick(rand, clause.frag ? LINKS_FRAGMENT : LINKS_CLAUSE);
    target.clauses.push(clause);
    target.links.push(link);
    target.age = 0;
    log.push({ rule: 'join', link });
  } else if (target && roll < 0.42) {
    // 4. overwrite: the new head takes an old clause's place; its places stay
    const old = pick(rand, target.clauses);
    const oldHead = [old.subj, old.pred, old.frag].filter(Boolean).map(text).join(' ');
    old.subj = clause.subj; old.pred = clause.pred; old.frag = clause.frag;
    const first = old.subj || old.frag;
    first.ghost = oldHead;
    // the old clause's own "and …" tails belonged to the old subject
    const keptPlaces = old.tails.filter((t) => t.kind === 'place');
    const lost = old.tails.filter((t) => t.kind !== 'place').map(text);
    old.tails = clause.tails.slice();
    for (const p of keptPlaces) if (old.tails.length < MAX_TAILS) addPlace(old, p);
    target.age = 0;
    log.push({ rule: 'overwrite' });
  } else {
    // 5. the message enters as its own sentence
    const s = newSentence(clause);
    const at = Math.floor(rand() * (state.length + 1));
    state.splice(at, 0, s);
    log.push({ rule: 'enter' });

    const other = target && target !== s ? pick(rand, target.clauses) : null;
    if (other && clause.subj && other.subj && rand() < 0.55) {
      // 6. swap subjects, with agreement
      const a = clause.subj, b = other.subj;
      clause.subj = b; other.subj = a;
      agreeClause(clause);
      agreeClause(other);
      a.ghost = text(b); a.ghostAge = 0;
      log.push({ rule: 'swap', gave: text(a) });
    } else if (other) {
      // 7. exchange place phrases
      const mineP = clause.tails.filter((t) => t.kind === 'place');
      const theirs = other.tails.filter((t) => t.kind === 'place');
      if (mineP.length && theirs.length) {
        const x = pick(rand, mineP), y = pick(rand, theirs);
        clause.tails[clause.tails.indexOf(x)] = y;
        other.tails[other.tails.indexOf(y)] = x;
        log.push({ rule: 'exchange', gave: text(x) });
      } else if (mineP.length && other.tails.length < MAX_TAILS && rand() < 0.5) {
        // lend a place phrase: it now belongs to both sentences' story
        const x = pick(rand, mineP);
        clause.tails.splice(clause.tails.indexOf(x), 1);
        addPlace(other, x);
        log.push({ rule: 'exchange', gave: text(x) });
      }
    }
  }

  // 8. forget: selective, not first-in-first-out; trims before it deletes
  const forgotten = [];
  const fresh = (s) => sentenceChunks(s).some((c) => c.src === msg.id && c.age === 0);
  while (totalWords(state) > CAPACITY || state.length > MAX_SENTENCES) {
    const candidates = state.filter((s) => !fresh(s));
    if (!candidates.length) break;
    const victim = candidates.reduce((a, b) => (b.age - 3 * b.echoes > a.age - 3 * a.echoes ? b : a));
    const lastClause = victim.clauses[victim.clauses.length - 1];
    if (lastClause.tails.length && totalWords(state) > CAPACITY && state.length <= MAX_SENTENCES) {
      forgotten.push(text(lastClause.tails.pop()));
    } else if (victim.clauses.length > 1) {
      forgotten.push(clauseChunks(victim.clauses.pop()).map(text).join(' '));
      victim.links.pop();
    } else {
      forgotten.push(sentenceWords(victim).join(' '));
      state.splice(state.indexOf(victim), 1);
    }
  }
  if (forgotten.length) log.push({ rule: 'forget', count: forgotten.length });

  return log;
}

// --- output --------------------------------------------------------------
// Flatten sentences into word tokens for drawing and storage.
// What is shown and stored: the memory retold (see reformulate.js), so no
// contributor's original wording can be read back out of it.
function output(state, messages) {
  const tokens = flatten(R.retell(clone(state)));
  return R.breakRuns(R.polish(tokens), messages, tokenize);
}

function flatten(state) {
  const tokens = [];
  for (const s of state) {
    const startAt = tokens.length;
    s.clauses.forEach((c, ci) => {
      if (ci > 0) {
        tokens[tokens.length - 1].w += ',';
        tokens.push({ w: s.links[ci - 1], src: 0, age: s.age, echoes: 0, ghost: null, link: true });
      }
      for (const ch of clauseChunks(c)) {
        ch.words.forEach((w, wi) => {
          tokens.push({ w, src: ch.src, age: ch.age, echoes: ch.echoes, ghost: wi === 0 ? ch.ghost : null });
        });
      }
    });
    if (tokens.length > startAt) {
      tokens[startAt].start = true;
      tokens[tokens.length - 1].w += '.';
    }
  }
  return tokens;
}

function clone(state) {
  return JSON.parse(JSON.stringify(state));
}

function reconstruct(messages) {
  const state = seedMemory();
  const snapshots = [];
  const seen = [];
  for (const msg of messages) {
    const log = applyMessage(state, msg);
    seen.push(msg);
    snapshots.push({ messageId: msg.id, log, tokens: output(state, seen) });
  }
  return { tokens: output(state, messages), snapshots };
}

const display = (t) => {
  const w = t.w.replace(/^i(?=$|'|[.,]$)/, 'I');
  return t.start ? w.charAt(0).toUpperCase() + w.slice(1) : w;
};

function publicView(tokens, highlightId = null) {
  return tokens.map((t) => ({
    w: display(t),
    ghost: t.ghost,
    fade: t.link ? 0.5 : Math.min(1, t.age / 14),
    echoes: t.echoes,
    mine: highlightId !== null && t.src === highlightId
  }));
}

function plainText(tokens) {
  return tokens.map(display).join(' ');
}

module.exports = { reconstruct, applyMessage, publicView, plainText, tokenize, RULES, CAPACITY };
