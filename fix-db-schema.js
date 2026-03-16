const fs = require('fs');
let db = fs.readFileSync('server/database.js', 'utf8');

// Add created_at to users table
db = db.replace(
  "r('CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT, email TEXT UNIQUE, role TEXT, avatar TEXT, is_active INTEGER DEFAULT 1, password_hash TEXT, totp_secret TEXT, totp_enabled INTEGER DEFAULT 0)');",
  "r('CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT, email TEXT UNIQUE, role TEXT, avatar TEXT, is_active INTEGER DEFAULT 1, password_hash TEXT, totp_secret TEXT, totp_enabled INTEGER DEFAULT 0, created_at INTEGER)');"
);

// Fix email_sync_state to have sync_start_date
db = db.replace(
  "r('CREATE TABLE IF NOT EXISTS email_sync_state (user_id TEXT PRIMARY KEY, last_history_id TEXT, last_sync_at INTEGER)');",
  "r('CREATE TABLE IF NOT EXISTS email_sync_state (user_id TEXT PRIMARY KEY, last_sync_at INTEGER DEFAULT 0, sync_start_date TEXT)');"
);

fs.writeFileSync('server/database.js', db, 'utf8');

// Verify
const check = fs.readFileSync('server/database.js', 'utf8');
console.log(check.includes('created_at INTEGER)') ? '✓ users table has created_at' : '✗ users missing created_at');
console.log(check.includes('sync_start_date TEXT') ? '✓ email_sync_state has sync_start_date' : '✗ missing sync_start_date');
console.log('Push and redeploy.');
