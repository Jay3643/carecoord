const initSqlJs = require('sql.js');
const fs = require('fs');
const p = require('path');
const DB_PATH = process.env.NODE_ENV === 'production' && require('fs').existsSync('/data') ? '/data/carecoord.db' : p.join(__dirname, 'carecoord.db');
let rawDb = null;

// Auto-convert all Uint8Array values to strings
function clean(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v instanceof Uint8Array) out[k] = Buffer.from(v).toString('utf8');
    else if (Buffer.isBuffer(v)) out[k] = v.toString('utf8');
    else out[k] = v;
  }
  return out;
}

async function initDb() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    rawDb = new SQL.Database(fs.readFileSync(DB_PATH));
    console.log('[DB] Loaded from disk');
  } else {
    rawDb = new SQL.Database();
    console.log('[DB] New database');
  }
  const r = s => rawDb.run(s);
  r('CREATE TABLE IF NOT EXISTS regions (id TEXT PRIMARY KEY, name TEXT, routing_aliases TEXT, is_active INTEGER DEFAULT 1)');
  r('CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT, email TEXT UNIQUE, role TEXT, avatar TEXT, is_active INTEGER DEFAULT 1, password_hash TEXT, totp_secret TEXT, totp_enabled INTEGER DEFAULT 0, created_at INTEGER, work_status TEXT DEFAULT \'active\', profile_photo_url TEXT)');
  r('CREATE TABLE IF NOT EXISTS user_regions (user_id TEXT, region_id TEXT, PRIMARY KEY(user_id, region_id))');
  r('CREATE TABLE IF NOT EXISTS close_reasons (id TEXT PRIMARY KEY, label TEXT, requires_comment INTEGER DEFAULT 0)');
  r('CREATE TABLE IF NOT EXISTS tags (id TEXT PRIMARY KEY, name TEXT, color TEXT)');
  r('CREATE TABLE IF NOT EXISTS tickets (id TEXT PRIMARY KEY, region_id TEXT, status TEXT DEFAULT \'OPEN\', assignee_user_id TEXT, subject TEXT, external_participants TEXT, last_activity_at INTEGER, created_at INTEGER, closed_at INTEGER, close_reason_id TEXT, locked_closed INTEGER DEFAULT 0, has_unread INTEGER DEFAULT 0, from_email TEXT, to_email TEXT, priority TEXT, category TEXT)');
  r('CREATE TABLE IF NOT EXISTS ticket_tags (ticket_id TEXT, tag_id TEXT, PRIMARY KEY(ticket_id, tag_id))');
  r('CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, ticket_id TEXT, direction TEXT, channel TEXT, from_address TEXT, to_addresses TEXT, subject TEXT, body_text TEXT, sent_at INTEGER, provider_message_id TEXT, in_reply_to TEXT, reference_ids TEXT, created_by_user_id TEXT, created_at INTEGER, gmail_message_id TEXT, gmail_thread_id TEXT, gmail_user_id TEXT, sender TEXT, body TEXT, timestamp INTEGER)');
  r('CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, ticket_id TEXT, author_user_id TEXT, body TEXT, created_at INTEGER, user_id TEXT, timestamp INTEGER)');
  r('CREATE TABLE IF NOT EXISTS audit_log (id TEXT PRIMARY KEY, actor_user_id TEXT, action_type TEXT, entity_type TEXT, entity_id TEXT, ts TEXT, detail TEXT, before_json TEXT, after_json TEXT)');
  r('CREATE TABLE IF NOT EXISTS attachments (id TEXT PRIMARY KEY, ticket_id TEXT, filename TEXT, data TEXT, message_id TEXT, mime_type TEXT, size INTEGER)');
  r('CREATE TABLE IF NOT EXISTS gmail_tokens (id TEXT PRIMARY KEY, user_id TEXT, access_token TEXT, refresh_token TEXT, expiry_date INTEGER, email TEXT)');
  r('CREATE TABLE IF NOT EXISTS email_filters (id TEXT PRIMARY KEY, domain TEXT, sender TEXT, subject_contains TEXT, action TEXT DEFAULT \'personal\', created_by TEXT, created_at INTEGER)');
  r('CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, user_id TEXT, expires INTEGER, last_active INTEGER)');
  try { r('ALTER TABLE sessions ADD COLUMN last_active INTEGER'); } catch(e) {}
  try { r('ALTER TABLE tickets ADD COLUMN assigned_at INTEGER'); } catch(e) {}
  try { r('ALTER TABLE tickets ADD COLUMN read_at INTEGER'); } catch(e) {}
  try { r('ALTER TABLE tickets ADD COLUMN read_by_user_id TEXT'); } catch(e) {}
  try { r('CREATE UNIQUE INDEX IF NOT EXISTS idx_msg_gmail_id ON messages(gmail_message_id)'); } catch(e) {}
  r('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)');
  r('CREATE TABLE IF NOT EXISTS invitations (id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL, region_ids TEXT, token TEXT UNIQUE NOT NULL, invited_by TEXT, created_at INTEGER, expires_at INTEGER, accepted_at INTEGER)');
  r('CREATE TABLE IF NOT EXISTS email_sync_state (user_id TEXT PRIMARY KEY, last_sync_at INTEGER DEFAULT 0, sync_start_date TEXT)');
  
    // Chat tables
    r("CREATE TABLE IF NOT EXISTS chat_channels (id TEXT PRIMARY KEY, name TEXT, type TEXT DEFAULT 'direct', ticket_id TEXT, created_by TEXT, created_at INTEGER)");
    r("CREATE TABLE IF NOT EXISTS chat_members (channel_id TEXT, user_id TEXT, joined_at INTEGER, last_read_at INTEGER DEFAULT 0, PRIMARY KEY(channel_id, user_id))");
    r("CREATE TABLE IF NOT EXISTS chat_messages (id TEXT PRIMARY KEY, channel_id TEXT, user_id TEXT, body TEXT, type TEXT DEFAULT 'text', file_name TEXT, file_data TEXT, file_mime TEXT, created_at INTEGER)");

    saveDb();
  return { exec: s => rawDb.exec(s), prepare: s => wrap(s), run: (s, p) => rawDb.run(s, p || []) };
}

function wrap(sql) {
  return {
    run: function() { rawDb.run(sql, Array.from(arguments)); return { changes: rawDb.getRowsModified() }; },
    all: function() {
      try {
        var a = Array.from(arguments);
        var st = rawDb.prepare(sql);
        if (a.length) st.bind(a);
        var r = [];
        while (st.step()) r.push(clean(st.getAsObject()));
        st.free();
        return r;
      } catch(e) { return []; }
    },
    get: function() {
      try {
        var a = Array.from(arguments);
        var st = rawDb.prepare(sql);
        if (a.length) st.bind(a);
        var r = st.step() ? clean(st.getAsObject()) : undefined;
        st.free();
        return r;
      } catch(e) { return undefined; }
    },
  };
}

function getDb() {
  if (!rawDb) throw new Error('DB not initialized');
  return { prepare: wrap, exec: s => rawDb.exec(s), run: (s, p) => rawDb.run(s, p || []) };
}

function saveDb() { if (rawDb) fs.writeFileSync(DB_PATH, Buffer.from(rawDb.export())); }
function closeDb() { saveDb(); }

module.exports = { initDb, getDb, saveDb, closeDb };
