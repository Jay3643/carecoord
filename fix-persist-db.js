// fix-persist-db.js
// Makes sql.js properly save and load the database file on disk
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, 'server', 'database.js');
let db = fs.readFileSync(dbPath, 'utf8');

// Completely rewrite database.js to properly persist
fs.writeFileSync(dbPath, `const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'carecoord.db');

let db = null;

async function initDb() {
  const SQL = await initSqlJs();

  // Load existing database from disk if it exists
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
    console.log('[DB] Loaded existing database from disk (' + fileBuffer.length + ' bytes)');
  } else {
    db = new SQL.Database();
    console.log('[DB] Created new empty database');
  }

  // Create tables if they don't exist
  db.run('CREATE TABLE IF NOT EXISTS regions (id TEXT PRIMARY KEY, name TEXT, description TEXT, is_active INTEGER DEFAULT 1)');
  db.run('CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT, email TEXT UNIQUE, role TEXT, avatar TEXT, is_active INTEGER DEFAULT 1, password_hash TEXT, totp_secret TEXT, totp_enabled INTEGER DEFAULT 0)');
  db.run('CREATE TABLE IF NOT EXISTS user_regions (user_id TEXT, region_id TEXT, PRIMARY KEY(user_id, region_id))');
  db.run('CREATE TABLE IF NOT EXISTS tickets (id TEXT PRIMARY KEY, subject TEXT, from_email TEXT, to_email TEXT, region_id TEXT, status TEXT DEFAULT \\'OPEN\\', priority TEXT DEFAULT \\'NORMAL\\', assignee_user_id TEXT, created_at INTEGER, last_activity_at INTEGER, closed_at INTEGER, closed_reason TEXT, gmail_message_id TEXT, gmail_thread_id TEXT, gmail_user_id TEXT)');
  db.run('CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, ticket_id TEXT, direction TEXT, sender TEXT, body TEXT, timestamp INTEGER, gmail_message_id TEXT, gmail_thread_id TEXT, gmail_user_id TEXT)');
  db.run('CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, ticket_id TEXT, user_id TEXT, body TEXT, timestamp INTEGER)');
  db.run('CREATE TABLE IF NOT EXISTS audit_log (id TEXT PRIMARY KEY, user_id TEXT, action TEXT, target_type TEXT, target_id TEXT, detail TEXT, timestamp INTEGER)');
  db.run('CREATE TABLE IF NOT EXISTS gmail_tokens (id TEXT PRIMARY KEY, user_id TEXT, access_token TEXT, refresh_token TEXT, expiry_date INTEGER, email TEXT)');
  db.run('CREATE TABLE IF NOT EXISTS email_filters (id TEXT PRIMARY KEY, domain TEXT, sender TEXT, subject_contains TEXT, action TEXT DEFAULT \\'personal\\', created_by TEXT, created_at INTEGER)');
  db.run('CREATE TABLE IF NOT EXISTS email_sync_state (user_id TEXT PRIMARY KEY, last_history_id TEXT, last_sync_at INTEGER)');

  // Auto-save to disk
  saveDb();

  return db;
}

function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');

  // Wrap prepare to return objects with all/get/run
  const origPrepare = db.prepare.bind(db);
  return {
    prepare: (sql) => {
      return {
        all: (...params) => {
          try {
            const stmt = origPrepare(sql);
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
            const stmt = origPrepare(sql);
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
            db.run(sql, params);
            return { changes: db.getRowsModified() };
          } catch (e) {
            if (e.message && e.message.includes('no such table')) return { changes: 0 };
            throw e;
          }
        },
      };
    },
  };
}

function saveDb() {
  if (!db) return;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  } catch (e) {
    console.error('[DB] Save error:', e.message);
  }
}

module.exports = { initDb, getDb, saveDb };
`, 'utf8');

console.log('✓ database.js — rewritten with full disk persistence');
console.log('  • Loads existing DB from disk on startup');
console.log('  • Creates tables only if missing');
console.log('  • Server restarts no longer lose data');
console.log('');
console.log('Now run:');
console.log('  del server\\carecoord.db');
console.log('  npm run seed');
console.log('  (in main PowerShell after Ctrl+C)');
