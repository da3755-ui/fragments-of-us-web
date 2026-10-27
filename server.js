// Fragments of Us: one shared text, reconstructed from anonymous messages.

const express = require('express');
const crypto = require('crypto');
const path = require('path');

const { open } = require('./src/db');
const { moderateInput, moderateOutput } = require('./src/moderation');
const { reconstruct, publicView, plainText, RULES, CAPACITY } = require('./src/transform');

const PORT = Number(process.env.PORT || 3000);
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'memory.db');
const RETENTION_DAYS = Number(process.env.RETENTION_DAYS || 90);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const TRUST_PROXY = process.env.TRUST_PROXY || 'loopback';

const db = open(DB_FILE);

// --- helpers ---------------------------------------------------------------
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

// --- the memory --------------------------------------------------------------
let current = { tokens: [], version: 0 };

function masked(tokens) {
  const copy = tokens.map((t) => ({ ...t }));
  moderateOutput(copy); // output moderation runs on every stored or shown result
  return copy;
}

// Replay every surviving message. Snapshots from `fromId` onward are
// cleared and rewritten, because each of them depended on what came before.
function rebuild(fromId = 0) {
  const messages = db.allMessages();
  const { tokens, snapshots } = reconstruct(messages);
  db.transaction(() => {
    if (fromId <= 0) db.clearAllSnapshots();
    else db.clearSnapshotsFrom(fromId);
    for (const s of snapshots) {
      if (s.messageId >= fromId) db.putSnapshot(s.messageId, s.log, masked(s.tokens));
    }
  });
  current = { tokens: masked(tokens), version: current.version + 1 };
}

function memoryPayload(highlightId = null) {
  return {
    version: current.version,
    words: publicView(current.tokens, highlightId),
    text: plainText(current.tokens),
    contributions: db.count(),
    capacity: CAPACITY
  };
}

// Remove messages past the retention limit. Forgetting is part of the work.
function purgeExpired() {
  const ids = db.expiredIds(daysAgo(RETENTION_DAYS));
  if (!ids.length) return 0;
  db.transaction(() => ids.forEach((id) => db.deleteMessage(id)));
  rebuild(Math.min(...ids));
  return ids.length;
}

// --- erase-attempt limiting (in memory only, never written to disk) ----------
// There is NO limit on how many messages a visitor can submit. The only
// limit is on erase attempts, so nobody can guess deletion tokens by brute
// force. Visitors are keyed by a salted hash of their IP. The salt is random and
// rotates every 24 hours, so keys cannot be linked across days or reversed.
let salt = crypto.randomBytes(32).toString('hex');
setInterval(() => { salt = crypto.randomBytes(32).toString('hex'); buckets.clear(); }, 86400000).unref();
const buckets = new Map();

function limited(req, kind, max, windowMs) {
  const key = kind + ':' + sha256(salt + (req.ip || ''));
  const now = Date.now();
  const hits = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (hits.length >= max) { buckets.set(key, hits); return true; }
  hits.push(now);
  buckets.set(key, hits);
  return false;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets) if (!v.some((t) => now - t < 86400000)) buckets.delete(k);
}, 600000).unref();

// --- app ---------------------------------------------------------------------
const app = express();
app.set('trust proxy', TRUST_PROXY);
app.disable('x-powered-by');
app.use(express.json({ limit: '2kb' }));

app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()'
  });
  next();
});

// Deliberately no request logging: access logs would record IP addresses.

app.get('/api/memory', (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (Number(req.query.since) === current.version) return res.json({ version: current.version, unchanged: true });
  res.json(memoryPayload());
});

// Lets the hosting platform check the site is up.
app.get('/healthz', (req, res) => res.type('text').send('ok'));

app.get('/api/rules', (req, res) => res.json({ rules: RULES, capacity: CAPACITY, retentionDays: RETENTION_DAYS }));

app.post('/api/submit', (req, res) => {
  const { text, consent, website, elapsed } = req.body || {};

  // Honeypot and too-fast submissions: answer as if fine, store nothing.
  if (website || (typeof elapsed === 'number' && elapsed < 2500)) {
    return res.status(202).json({ ok: false, error: 'That was very fast. Wait a few seconds after the page loads, then try again.' });
  }
  if (consent !== true) {
    return res.status(400).json({ ok: false, error: 'Please confirm that you understand how your words will be used.' });
  }

  const mod = moderateInput(text);
  if (!mod.ok) return res.status(422).json({ ok: false, error: mod.reason });
  if (db.seenRecently(mod.text, daysAgo(1))) {
    return res.status(409).json({ ok: false, error: 'The memory already heard those exact words today.' });
  }

  const before = plainText(current.tokens);
  const token = crypto.randomBytes(18).toString('base64url'); // 144 bits
  const id = db.insertMessage(mod.text, sha256(token), today());
  rebuild(id);
  const snap = db.getSnapshot(id);

  res.status(201).json({
    ok: true,
    token, // shown once; only its hash is stored
    before,
    log: snap ? snap.log : [],
    memory: memoryPayload(id)
  });
});

app.post('/api/erase', (req, res) => {
  if (limited(req, 'erase', 10, 10 * 60000)) {
    return res.status(429).json({ ok: false, error: 'Too many attempts. Try again in a few minutes.' });
  }
  const token = String((req.body || {}).token || '').trim();
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) {
    return res.status(400).json({ ok: false, error: 'That does not look like a deletion token.' });
  }
  const row = db.findByToken(sha256(token));
  if (!row) {
    return res.status(404).json({ ok: false, error: 'No trace matches that token. It may already have been erased or expired.' });
  }
  const id = Number(row.id);
  const before = plainText(current.tokens);
  db.deleteMessage(id); // the text, token hash and its snapshot are gone
  rebuild(id);           // every later snapshot is cleared and recomputed
  res.json({ ok: true, before, memory: memoryPayload() });
});

// --- minimal moderation tools for the person running the site -------------
function admin(req, res, next) {
  const given = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!ADMIN_TOKEN || given.length !== ADMIN_TOKEN.length ||
      !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(ADMIN_TOKEN))) {
    return res.status(404).end();
  }
  next();
}
app.get('/api/admin/messages', admin, (req, res) => res.json(db.allMessages()));
app.delete('/api/admin/messages/:id', admin, (req, res) => {
  const id = Number(req.params.id);
  if (!db.findById(id)) return res.status(404).json({ ok: false });
  db.deleteMessage(id);
  rebuild(id);
  res.json({ ok: true, memory: memoryPayload() });
});

// p5.js is served from our own origin, so visitors' browsers make no
// requests to third-party CDNs.
app.get('/vendor/p5.min.js', (req, res) => res.sendFile(require.resolve('p5/lib/p5.min.js')));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.use((req, res) => res.status(404).sendFile(path.join(__dirname, 'public', 'index.html')));

// --- start -------------------------------------------------------------------
rebuild(0);
purgeExpired();
setInterval(purgeExpired, 6 * 3600000).unref();

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => console.log(`fragments of us listening on http://localhost:${PORT}`));
}

module.exports = { app, rebuild, db };
