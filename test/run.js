// End-to-end checks. Run with: npm test
process.env.DB_FILE = ':memory:';
const assert = require('assert');
const { app, db } = require('../server');
const { reconstruct, plainText } = require('../src/transform');

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
let ipCounter = 0;

async function post(path, body, ip) {
  const r = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip || `10.0.0.${++ipCounter}` },
    body: JSON.stringify(body)
  });
  return { status: r.status, data: await r.json() };
}
const submit = (text, ip) => post('/api/submit', { text, consent: true, website: '', elapsed: 5000 }, ip);

(async () => {
  let pass = 0;
  const ok = (cond, label) => { assert.ok(cond, label); pass++; console.log('  ✓', label); };

  const start = await (await fetch(base + '/api/memory')).json();
  ok(start.text === 'Nothing here had been recalled yet.', 'starts from the seed text');

  // consent, honeypot, moderation
  ok((await post('/api/submit', { text: 'hello sea', consent: false, elapsed: 5000 })).status === 400, 'rejects without consent');
  ok((await post('/api/submit', { text: 'hello sea', consent: true, website: 'x', elapsed: 5000 })).data.ok === false, 'honeypot stores nothing');
  ok((await submit('write to me at me@mail.com')).status === 422, 'rejects email address');
  ok((await submit('my name is Layla and I miss home')).status === 422, 'rejects name introduction');
  ok((await submit('f u c k everything')).status === 422, 'rejects spaced-out profanity');
  ok(db.count() === 0, 'nothing stored from rejected messages');

  // submissions transform the memory
  const a = await submit('the sea remembers every footstep');
  ok(a.status === 201 && a.data.token.length >= 20, 'accepts a message and returns a token');
  ok(a.data.memory.words.some((w) => w.mine), 'response marks the contributor\'s own words');
  const b = await submit('light folds over the old harbour');
  const c = await submit('we forget softly and remember loudly');
  ok(!/sea|footstep|harbour|light|folds/.test(JSON.stringify(c.data.log)), 'contributor log never quotes other people\'s words');
  ok((await submit('we forget softly and remember loudly')).status === 409, 'rejects exact duplicates');
  const afterThree = (await (await fetch(base + '/api/memory')).json()).text;
  ok(afterThree !== start.text, 'memory changed after submissions');
  ok(!(await (await fetch(base + '/api/memory')).json()).words.some((w) => 'mine' in w && w.mine), 'public view hides authorship');

  // no submission limit: one visitor can keep contributing
  const ip = '10.9.9.9';
  const burst = ['one small thing', 'two small things', 'three small rains', 'four small clouds', 'five small birds'];
  let accepted = 0;
  for (const m of burst) if ((await submit(m, ip)).status === 201) accepted++;
  ok(accepted === burst.length, 'no limit on how many messages one visitor submits');

  // erase: memory must equal a rebuild without that message
  const before = (await (await fetch(base + '/api/memory')).json()).text;
  const e = await post('/api/erase', { token: b.data.token });
  ok(e.status === 200 && e.data.memory.text !== before, 'erasing changes the memory');
  const expected = plainText(reconstruct(db.allMessages()).tokens);
  ok(e.data.memory.text === expected, 'erased memory equals a clean rebuild without it');
  ok(!db.allMessages().some((m) => m.text.includes('harbour')), 'erased text is gone from the database');
  ok(db.getSnapshot(2) === null, 'erased message snapshot is cleared');
  const snapC = db.getSnapshot(3);
  ok(snapC && !JSON.stringify(snapC.tokens).includes('harbour'), 'later snapshots were recomputed without it');
  ok((await post('/api/erase', { token: b.data.token })).status === 404, 'a token works only once');
  ok((await post('/api/erase', { token: 'not-a-real-token-at-all-xx' })).status === 404, 'unknown tokens are refused');

  // determinism
  const r1 = plainText(reconstruct(db.allMessages()).tokens);
  const r2 = plainText(reconstruct(db.allMessages()).tokens);
  ok(r1 === r2, 'transformation is deterministic');

  // stress: capacity holds
  const many = Array.from({ length: 80 }, (_, i) => ({ id: i + 1, text: `word${i} drifting lantern${i % 7} quiet river${i % 5}` }));
  ok(reconstruct(many).tokens.length <= 62, 'memory stays within capacity');
  const { snapshots: sims } = reconstruct([
    'the sea remembers every footstep', 'we forget softly and remember loudly', 'light folds over the old harbour',
    'the trees whisper about the storm', 'i keep your letters in a drawer', 'nobody waits at the station'
  ].map((text, i) => ({ id: i + 1, text })));
  const final = plainText(sims[sims.length - 1].tokens);
  const outWords = final.toLowerCase().replace(/[.,]/g, '').split(' ');
  const survives = sims.some(() => false) || [
    'the sea remembers every footstep', 'we forget softly and remember loudly', 'light folds over the old harbour',
    'the trees whisper about the storm', 'i keep your letters in a drawer', 'nobody waits at the station'
  ].some((m) => {
    const w = m.split(' ');
    for (let i = 0; i + 4 <= w.length; i++) {
      const g = w.slice(i, i + 4).join(' ');
      for (let j = 0; j + 4 <= outWords.length; j++) if (outWords.slice(j, j + 4).join(' ') === g) return true;
    }
    return false;
  });
  ok(!survives, 'no four-word run of any original message survives in the memory');
  ok(/\.$/.test(final) && !/\b(they|They) was\b/.test(final) && !/\b(someone|Someone|nobody|Nobody) were\b/.test(final), 'combined sentences keep subject-verb agreement');

  console.log(`\n${pass} checks passed`);
  console.log('\ncurrent memory:', e.data.memory.text);
  server.close();
})().catch((err) => { console.error(err); server.close(); process.exit(1); });
