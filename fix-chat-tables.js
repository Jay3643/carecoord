const fs = require('fs');
let index = fs.readFileSync('server/index.js', 'utf8');

// Add chat table migration right after initDb
index = index.replace(
  "initDb().then(() => {",
  `initDb().then(() => {
  // Migrate: ensure chat tables exist
  try {
    const { getDb, saveDb } = require('./database');
    const db = getDb();
    db.exec("CREATE TABLE IF NOT EXISTS chat_channels (id TEXT PRIMARY KEY, name TEXT, type TEXT DEFAULT 'direct', ticket_id TEXT, created_by TEXT, created_at INTEGER)");
    db.exec("CREATE TABLE IF NOT EXISTS chat_members (channel_id TEXT, user_id TEXT, joined_at INTEGER, last_read_at INTEGER DEFAULT 0, PRIMARY KEY(channel_id, user_id))");
    db.exec("CREATE TABLE IF NOT EXISTS chat_messages (id TEXT PRIMARY KEY, channel_id TEXT, user_id TEXT, body TEXT, type TEXT DEFAULT 'text', file_name TEXT, file_data TEXT, file_mime TEXT, created_at INTEGER)");
    saveDb();
    console.log('[DB] Chat tables ready');
  } catch(e) { console.log('[DB] Chat migration:', e.message); }`
);

fs.writeFileSync('server/index.js', index, 'utf8');
console.log(index.includes('Chat tables ready') ? '✓ Chat table migration added to startup' : '✗ Failed');
