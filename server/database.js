const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'carecoord.db');

let db = null;

function wrapStatement(stmt, rawDb) {
  return {
    run(...params) {
      rawDb.run(stmt, params);
      return { changes: rawDb.getRowsModified() };
    },
    get(...params) {
      let result = null;
      const s = rawDb.prepare(stmt);
      if (params.length > 0) s.bind(params);
      if (s.step()) result = s.getAsObject();
      s.free();
      return result;
    },
    all(...params) {
      const results = [];
      const s = rawDb.prepare(stmt);
      if (params.length > 0) s.bind(params);
      while (s.step()) results.push(s.getAsObject());
      s.free();
      return results;
    }
  };
}

function wrapDb(rawDb) {
  return {
    prepare(sql) { return wrapStatement(sql, rawDb); },
    exec(sql) { rawDb.exec(sql); },
    _raw: rawDb,
  };
}

async function initDb() {
  if (db) return db;
  const SQL = await initSqlJs();
  let rawDb;
  if (fs.existsSync(DB_PATH)) {
    rawDb = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    rawDb = new SQL.Database();
  }
  rawDb.exec('PRAGMA foreign_keys = ON;');
  db = wrapDb(rawDb);
  initSchema();
  return db;
}

function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}

function saveDb() {
  if (db && db._raw) {
    fs.writeFileSync(DB_PATH, Buffer.from(db._raw.export()));
  }
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS regions (
      id TEXT PRIMARY KEY, name TEXT NOT NULL,
      routing_aliases TEXT DEFAULT '[]', is_active INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL CHECK(role IN ('coordinator','supervisor','admin')),
      avatar TEXT, is_active INTEGER DEFAULT 1, password_hash TEXT, totp_secret TEXT, totp_enabled INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS user_regions (
      user_id TEXT NOT NULL REFERENCES users(id),
      region_id TEXT NOT NULL REFERENCES regions(id),
      PRIMARY KEY (user_id, region_id)
    );
    CREATE TABLE IF NOT EXISTS close_reasons (
      id TEXT PRIMARY KEY, label TEXT NOT NULL,
      scope TEXT DEFAULT 'global', requires_comment INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY, name TEXT NOT NULL,
      color TEXT DEFAULT '#6366f1', scope TEXT DEFAULT 'global'
    );
    CREATE TABLE IF NOT EXISTS tickets (
      id TEXT PRIMARY KEY,
      region_id TEXT NOT NULL REFERENCES regions(id),
      status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','WAITING_ON_EXTERNAL','CLOSED')),
      assignee_user_id TEXT REFERENCES users(id),
      subject TEXT NOT NULL,
      external_participants TEXT DEFAULT '[]',
      last_activity_at INTEGER NOT NULL, created_at INTEGER NOT NULL,
      closed_at INTEGER, close_reason_id TEXT REFERENCES close_reasons(id),
      locked_closed INTEGER DEFAULT 0, has_unread INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS ticket_tags (
      ticket_id TEXT NOT NULL REFERENCES tickets(id),
      tag_id TEXT NOT NULL REFERENCES tags(id),
      PRIMARY KEY (ticket_id, tag_id)
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL REFERENCES tickets(id),
      direction TEXT NOT NULL CHECK(direction IN ('inbound','outbound')),
      channel TEXT DEFAULT 'email', from_address TEXT,
      to_addresses TEXT DEFAULT '[]', cc_addresses TEXT DEFAULT '[]',
      subject TEXT, body_text TEXT, body_html TEXT, sent_at INTEGER,
      provider_message_id TEXT, in_reply_to TEXT,
      reference_ids TEXT DEFAULT '[]', raw_source_uri TEXT,
      created_by_user_id TEXT REFERENCES users(id),
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES messages(id),
      filename TEXT NOT NULL, mime_type TEXT, size_bytes INTEGER,
      storage_uri TEXT, checksum TEXT
    );
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL REFERENCES tickets(id),
      author_user_id TEXT NOT NULL REFERENCES users(id),
      body TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY, actor_user_id TEXT,
      action_type TEXT NOT NULL, entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL, ts INTEGER NOT NULL,
      detail TEXT, before_json TEXT, after_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tickets_region ON tickets(region_id);
    CREATE INDEX IF NOT EXISTS idx_tickets_assignee ON tickets(assignee_user_id);
    CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
    CREATE INDEX IF NOT EXISTS idx_tickets_last_activity ON tickets(last_activity_at DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_ticket ON messages(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_messages_sent ON messages(sent_at);
    CREATE INDEX IF NOT EXISTS idx_notes_ticket ON notes(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);
  `);
  saveDb();
}

function closeDb() {
  if (db && db._raw) { saveDb(); db._raw.close(); db = null; }
}

module.exports = { initDb, getDb, closeDb, saveDb, DB_PATH };
