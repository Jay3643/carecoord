// fix-db-wrapper.js
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, 'server', 'database.js');

fs.writeFileSync(dbPath, `const initSqlJs = require('sql.js');
const fs = require('fs');
const pathMod = require('path');

const DB_PATH = pathMod.join(__dirname, 'carecoord.db');

let rawDb = null;

async function initDb() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    rawDb = new SQL.Database(fileBuffer);
    console.log('[DB] Loaded existing database from disk (' + fileBuffer.length + ' bytes)');
  } else {
    rawDb = new SQL.Database();
    console.log('[DB] Created new empty database');
  }

  // Create all tables
  rawDb.run('CREATE TABLE IF NOT EXISTS regions (id TEXT PRIMARY KEY, name TEXT, description TEXT, is_active INTEGER DEFAULT 1)');
  rawDb.run('CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT, email TEXT UNIQUE, role TEXT, avatar TEXT, is_active INTEGER DEFAULT 1, password_hash TEXT, totp_secret TEXT, totp_enabled INTEGER DEFAULT 0)');
  rawDb.run('CREATE TABLE IF NOT EXISTS user_regions (user_id TEXT, region_id TEXT, PRIMARY KEY(user_id, region_id))');
  rawDb.run('CREATE TABLE IF NOT EXISTS tickets (id TEXT PRIMARY KEY, subject TEXT, from_email TEXT, to_email TEXT, region_id TEXT, status TEXT DEFAULT \\'OPEN\\', priority TEXT DEFAULT \\'NORMAL\\', assignee_user_id TEXT, created_at INTEGER, last_activity_at INTEGER, closed_at INTEGER, closed_reason TEXT)');
  rawDb.run('CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, ticket_id TEXT, direction TEXT, sender TEXT, body TEXT, timestamp INTEGER, gmail_message_id TEXT, gmail_thread_id TEXT, gmail_user_id TEXT)');
  rawDb.run('CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, ticket_id TEXT, user_id TEXT, body TEXT, timestamp INTEGER)');
  rawDb.run('CREATE TABLE IF NOT EXISTS audit_log (id TEXT PRIMARY KEY, user_id TEXT, action TEXT, target_type TEXT, target_id TEXT, detail TEXT, timestamp INTEGER)');
  rawDb.run('CREATE TABLE IF NOT EXISTS gmail_tokens (id TEXT PRIMARY KEY, user_id TEXT, access_token TEXT, refresh_token TEXT, expiry_date INTEGER, email TEXT)');
  rawDb.run('CREATE TABLE IF NOT EXISTS email_filters (id TEXT PRIMARY KEY, domain TEXT, sender TEXT, subject_contains TEXT, action TEXT DEFAULT \\'personal\\', created_by TEXT, created_at INTEGER)');
  rawDb.run('CREATE TABLE IF NOT EXISTS email_sync_state (user_id TEXT PRIMARY KEY, last_history_id TEXT, last_sync_at INTEGER)');
  rawDb.run('CREATE TABLE IF NOT EXISTS close_reasons (id TEXT PRIMARY KEY, label TEXT)');
  rawDb.run('CREATE TABLE IF NOT EXISTS tags (id TEXT PRIMARY KEY, label TEXT, color TEXT)');
  rawDb.run('CREATE TABLE IF NOT EXISTS ticket_tags (ticket_id TEXT, tag_id TEXT, PRIMARY KEY(ticket_id, tag_id))');
  rawDb.run('CREATE TABLE IF NOT EXISTS attachments (id TEXT PRIMARY KEY, ticket_id TEXT, message_id TEXT, filename TEXT, mime_type TEXT, size INTEGER, path TEXT, uploaded_by TEXT, uploaded_at INTEGER)');
  rawDb.run('CREATE TABLE IF NOT EXISTS contacts (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, organization TEXT, role TEXT, region_id TEXT, created_by TEXT, created_at INTEGER)');
  rawDb.run('CREATE TABLE IF NOT EXISTS ticket_contacts (ticket_id TEXT, contact_id TEXT, PRIMARY KEY(ticket_id, contact_id))');
  rawDb.run('CREATE TABLE IF NOT EXISTS templates (id TEXT PRIMARY KEY, name TEXT, subject TEXT, body TEXT, created_by TEXT, created_at INTEGER)');
  rawDb.run('CREATE TABLE IF NOT EXISTS escalations (id TEXT PRIMARY KEY, ticket_id TEXT, from_user_id TEXT, to_user_id TEXT, reason TEXT, created_at INTEGER)');
  rawDb.run('CREATE TABLE IF NOT EXISTS sla_rules (id TEXT PRIMARY KEY, name TEXT, priority TEXT, response_minutes INTEGER, resolve_minutes INTEGER)');

  saveDb();
  return rawDb;
}

function getDb() {
  if (!rawDb) throw new Error('Database not initialized. Call initDb() first.');

  return {
    prepare: (sql) => ({
      all: (...params) => {
        try {
          const stmt = rawDb.prepare(sql);
          if (params.length) stmt.bind(params);
          const results = [];
          while (stmt.step()) results.push(stmt.getAsObject());
          stmt.free();
          return results;
        } catch (e) {
          if (e.message && e.message.includes('no such table')) return [];
          throw e;
        }
      },
      get: (...params) => {
        try {
          const stmt = rawDb.prepare(sql);
          if (params.length) stmt.bind(params);
          const result = stmt.step() ? stmt.getAsObject() : undefined;
          stmt.free();
          return result;
        } catch (e) {
          if (e.message && e.message.includes('no such table')) return undefined;
          throw e;
        }
      },
      run: (...params) => {
        try {
          rawDb.run(sql, params);
          return { changes: rawDb.getRowsModified() };
        } catch (e) {
          if (e.message && e.message.includes('no such table')) return { changes: 0 };
          throw e;
        }
      },
    }),
    exec: (sql) => rawDb.exec(sql),
    run: (sql, params) => rawDb.run(sql, params || []),
  };
}

function saveDb() {
  if (!rawDb) return;
  try {
    const data = rawDb.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  } catch (e) {
    console.error('[DB] Save error:', e.message);
  }
}

module.exports = { initDb, getDb, saveDb };
`, 'utf8');

console.log('✓ database.js — fixed wrapper with exec() and run() methods');
console.log('Now: del server\\carecoord.db && npm run seed');
