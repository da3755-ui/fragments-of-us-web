// Storage. SQLite via Node's built-in driver (Node 22.5+), one file on disk.
//
// What is stored, and nothing else:
//   messages:  the moderated text, a SHA-256 hash of the deletion token,
//              and the calendar day it arrived (for the retention limit).
//   snapshots: the memory as it stood right after each message, plus the
//              log of what the rules did. These are the "stored outputs".
// No IP addresses, user agents, cookies, accounts or exact timestamps.

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS messages (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      text        TEXT NOT NULL,
      token_hash  TEXT NOT NULL UNIQUE,
      created_day TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS snapshots (
      message_id  INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
      log_json    TEXT NOT NULL,
      memory_json TEXT NOT NULL
    );
  `);

  const q = {
    insert: db.prepare('INSERT INTO messages (text, token_hash, created_day) VALUES (?, ?, ?)'),
    all: db.prepare('SELECT id, text FROM messages ORDER BY id'),
    byToken: db.prepare('SELECT id, text FROM messages WHERE token_hash = ?'),
    byId: db.prepare('SELECT id, text FROM messages WHERE id = ?'),
    del: db.prepare('DELETE FROM messages WHERE id = ?'),
    recentText: db.prepare('SELECT 1 FROM messages WHERE lower(text) = lower(?) AND created_day >= ? LIMIT 1'),
    countAll: db.prepare('SELECT COUNT(*) AS n FROM messages'),
    expired: db.prepare('SELECT id FROM messages WHERE created_day < ? ORDER BY id'),
    clearSnapsFrom: db.prepare('DELETE FROM snapshots WHERE message_id >= ?'),
    clearSnaps: db.prepare('DELETE FROM snapshots'),
    putSnap: db.prepare('INSERT OR REPLACE INTO snapshots (message_id, log_json, memory_json) VALUES (?, ?, ?)'),
    snap: db.prepare('SELECT log_json, memory_json FROM snapshots WHERE message_id = ?'),
    latestSnap: db.prepare('SELECT memory_json FROM snapshots ORDER BY message_id DESC LIMIT 1')
  };

  return {
    raw: db,
    insertMessage: (text, tokenHash, day) => Number(q.insert.run(text, tokenHash, day).lastInsertRowid),
    allMessages: () => q.all.all().map((r) => ({ id: Number(r.id), text: r.text })),
    findByToken: (h) => q.byToken.get(h) || null,
    findById: (id) => q.byId.get(id) || null,
    deleteMessage: (id) => q.del.run(id),
    seenRecently: (text, sinceDay) => !!q.recentText.get(text, sinceDay),
    count: () => Number(q.countAll.get().n),
    expiredIds: (beforeDay) => q.expired.all(beforeDay).map((r) => Number(r.id)),
    clearSnapshotsFrom: (id) => q.clearSnapsFrom.run(id),
    clearAllSnapshots: () => q.clearSnaps.run(),
    putSnapshot: (id, log, tokens) => q.putSnap.run(id, JSON.stringify(log), JSON.stringify(tokens)),
    getSnapshot: (id) => {
      const r = q.snap.get(id);
      return r ? { log: JSON.parse(r.log_json), tokens: JSON.parse(r.memory_json) } : null;
    },
    latestTokens: () => {
      const r = q.latestSnap.get();
      return r ? JSON.parse(r.memory_json) : null;
    },
    transaction(fn) {
      db.exec('BEGIN');
      try { const out = fn(); db.exec('COMMIT'); return out; }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    }
  };
}

module.exports = { open };
