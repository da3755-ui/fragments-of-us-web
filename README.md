# Fragments of Us

One shared text, rebuilt every time someone adds to it. Visitors anonymously leave a short message; a server-side transformation function folds it into the memory, rearranging, overwriting, fusing and forgetting earlier words. Each contributor gets a private deletion token; using it ("erase my trace") removes their message, clears every stored output that depended on it, and rebuilds the memory without them.

The project asks whether digital systems, AI memory included, *preserve* what we share or *reconstruct* it.

## Run it

Requires Node 22.5 or newer (uses the built-in `node:sqlite`).

```bash
npm install
npm start            # http://localhost:3000
npm test             # 24 end-to-end checks
```

Environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | |
| `DB_FILE` | `data/memory.db` | SQLite file |
| `RETENTION_DAYS` | `90` | messages older than this are deleted and the memory rebuilt |
| `ADMIN_TOKEN` | *(unset)* | enables the moderation endpoints below |
| `TRUST_PROXY` | `loopback` | set to your proxy's address/hops when deployed behind one, so the erase-attempt limit sees real client IPs |

## How it works

```
server.js            Express app: API, erase-attempt limit, security headers, retention
src/transform.js     the transformation rules (pure, deterministic)
src/grammar.js       phrase cutting, verb lexicon, subject–verb agreement
src/reformulate.js   retelling: re-pairing, person, past tense, synonyms, no-survival check
src/moderation.js    input moderation + output masking
src/db.js            SQLite schema and queries
public/index.html    the single page: memory, submission field, erase dialog
public/sketch.js     p5.js rendering (drift, fade, ghosts)
public/app.js        page logic
public/privacy.html  privacy policy
test/run.js          end-to-end tests
```

**Reconstruction, not editing.** The memory is never edited in place. `reconstruct()` starts from a seed sentence and replays every surviving message, in order, through controlled rules.

**Phrases, not words.** To keep the memory intelligible, `src/grammar.js` cuts each message into phrases: a *head* (subject + verb, found with a small verb lexicon, or a fragment like "salt"), *place* phrases starting with a preposition ("over the old harbour"), and *bound* phrases starting with a conjunction ("and remember loudly"), which stay with their own subject. The rules only ever move whole phrases:

1. **age**: every remembered phrase grows older and fainter
2. **echo**: a message sharing a word with a remembered sentence strengthens it (bolder, harder to forget) and becomes the target of the next rule
3. **join**: the new sentence attaches to an old one with a linking word (*while, where, until, as, and*; *with, beside* for fragments)
4. **overwrite**: the new subject + verb replaces an old one; the old head lingers as a ghost, the old place phrases stay
5. **swap**: the new sentence enters and exchanges subjects with an old one; verbs re-agree (*we remember* ↔ *the sea remembers*, *is/are*, *has/have*, *doesn't/don't*)
6. **exchange**: the new sentence trades or lends a place phrase to an old one
7. **forget**: past 56 words or 6 sentences, the oldest, least-echoed sentence loses its last place phrase, then its joined clause, then itself

**Retelling, so originals can't be read back.** Before anything is shown or stored as output, `src/reformulate.js` retells a copy of the memory (the internal state keeps the real phrases, so the rules still work on what people wrote):

1. **re-pair**: every subject is told with another sentence's verb (a derangement, so no clause keeps its own subject), and place phrases rotate one sentence onward
2. **person**: *I / we / you / my / your* become *someone / they / their*
3. **tense**: everything is retold in the past (*remembers* → *recalled*, *is* → *was*, *can't* → *couldn't*), keeping the memory's voice as a recollection
4. **wording**: common nouns, verbs and modifiers are replaced with near-synonyms (*sea* → *tide/ocean*, *keep* → *hold/store*, *softly* → *gently*); extend the lists at the top of the file
5. **guarantee**: if any run of four consecutive words from any message survives, a quiet modifier is woven into it; a test checks this

Example: *the sea remembers every footstep*, *we forget softly and remember loudly*, *I keep your letters in a drawer* → *They stored their notes in a box. The tide recalled each tread. Someone let go quietly and recalled boldly.*

Each rule's randomness is seeded by the message itself, so the same messages always produce the same memory, and removing one produces a genuinely different one. Tune probabilities and limits at the top of `src/transform.js`; extend the verb list in `src/grammar.js` (unknown verbs ending in *-ed* are recognized automatically; otherwise an unrecognized sentence is treated as a fragment and still moves safely).

**Stored outputs.** After each message the resulting memory and a log of what the rules did are stored as a snapshot. Erasing message *n* deletes snapshot *n* and every later snapshot (they all depended on it) and recomputes them.

**Moderation.** Input: length and word limits, all-caps/repetition checks, PII patterns (emails, links, domains, phone/ID numbers, handles, "my name is", addresses, credentials), a blocklist with leetspeak normalization, threat phrases. Output: because fusing words can create new strings, every token and adjacent pair is checked again and masked as `░░░`. Rejected messages are never stored. Extend the lists in `src/moderation.js` for your audience and languages.

**Spam.** There is deliberately no limit on how many messages a visitor can submit. Remaining checks: a hidden honeypot field, a minimum of 2.5 s on the page before submitting, and rejection of exact duplicates within 24 h. Only erase attempts are limited (10 per 10 min), keyed by a salted IP hash held only in memory with the salt rotated daily, to block token guessing. All of this is explained to visitors on the page and in the privacy policy.

**Data minimization.** Stored: moderated text, SHA-256 of the deletion token, arrival day, snapshots. Not stored: IPs, user agents, cookies, accounts, exact times. No request logging. p5.js is served from the site's own origin, so there are no third-party requests.

## Moderation endpoints

With `ADMIN_TOKEN` set:

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/api/admin/messages
curl -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/api/admin/messages/12
```

Removing a message rebuilds the memory exactly as erasure does.

## Before you deploy

- Put your contact address in `public/privacy.html` (search for `[operator contact email]`) and review the policy against your institution's requirements (for a class project, check whether your university needs ethics/IRB review for collecting public submissions).
- Serve over HTTPS. Behind a proxy, set `TRUST_PROXY`, and make sure the proxy itself is not writing access logs with IPs, or update the privacy policy to say so.
- Hosting needs a persistent disk for the SQLite file (e.g. Render or Railway with a volume, Fly.io, a small VPS). Static-only hosts won't work.
- If you keep backups, keep them for 30 days at most, as the policy states.
