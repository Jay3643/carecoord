const fs = require('fs');

// 1. Add unique index on gmail_message_id to database.js
let db = fs.readFileSync('server/database.js', 'utf8');
if (!db.includes('idx_msg_gmail_id')) {
  db = db.replace(
    "r('CREATE TABLE IF NOT EXISTS email_sync_state",
    "try { r('CREATE UNIQUE INDEX IF NOT EXISTS idx_msg_gmail_id ON messages(gmail_message_id)'); } catch(e) {}\n  r('CREATE TABLE IF NOT EXISTS email_sync_state"
  );
  fs.writeFileSync('server/database.js', db, 'utf8');
  console.log('  ✓ database.js — unique index on gmail_message_id');
}

// 2. Add INSERT OR IGNORE in gmail.js sync to skip duplicates
let gmail = fs.readFileSync('server/routes/gmail.js', 'utf8');

// Fix ticket insert to use OR IGNORE
gmail = gmail.replace(
  "db.prepare('INSERT INTO tickets (id,subject,from_email,region_id,status,created_at,last_activity_at,external_participants) VALUES (?,?,?,?,?,?,?,?)').run(",
  "db.prepare('INSERT OR IGNORE INTO tickets (id,subject,from_email,region_id,status,created_at,last_activity_at,external_participants) VALUES (?,?,?,?,?,?,?,?)').run("
);

// Fix message insert to use OR IGNORE
gmail = gmail.replace(
  "db.prepare('INSERT INTO messages (id,ticket_id,direction,channel,from_address,to_addresses,sender,subject,body_text,sent_at,provider_message_id,in_reply_to,reference_ids,gmail_message_id,gmail_thread_id,gmail_user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(",
  "db.prepare('INSERT OR IGNORE INTO messages (id,ticket_id,direction,channel,from_address,to_addresses,sender,subject,body_text,sent_at,provider_message_id,in_reply_to,reference_ids,gmail_message_id,gmail_thread_id,gmail_user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run("
);

// 3. Add rate limiting to auto-sync (skip if synced within 30 seconds)
if (!gmail.includes('lastSyncTime')) {
  gmail = gmail.replace(
    "router.get('/auto-sync', requireAuth, async (req, res) => {",
    "let lastSyncTime = 0;\nrouter.get('/auto-sync', requireAuth, async (req, res) => {\n  if (Date.now() - lastSyncTime < 30000) return res.json({ synced: 0, cached: true });\n  lastSyncTime = Date.now();"
  );
}

fs.writeFileSync('server/routes/gmail.js', gmail, 'utf8');
console.log('  ✓ gmail.js — INSERT OR IGNORE + 30s rate limit on auto-sync');

// 4. Clean up existing duplicates
const { initDb, getDb, saveDb } = require('./server/database');
initDb().then(() => {
  const ddb = getDb();
  
  // Add the unique index to running DB
  try { ddb.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_msg_gmail_id ON messages(gmail_message_id)').run(); } catch(e) {}
  
  // Find and remove duplicate messages
  const dupes = ddb.prepare("SELECT gmail_message_id, COUNT(*) as c FROM messages WHERE gmail_message_id IS NOT NULL GROUP BY gmail_message_id HAVING c > 1").all();
  let removed = 0;
  dupes.forEach(d => {
    const msgs = ddb.prepare('SELECT id, ticket_id FROM messages WHERE gmail_message_id = ? ORDER BY sent_at ASC').all(d.gmail_message_id);
    msgs.slice(1).forEach(m => {
      ddb.prepare('DELETE FROM messages WHERE id = ?').run(m.id);
      // Only delete ticket if it has no other messages
      const count = ddb.prepare('SELECT COUNT(*) as c FROM messages WHERE ticket_id = ?').get(m.ticket_id);
      if (count.c === 0) ddb.prepare('DELETE FROM tickets WHERE id = ?').run(m.ticket_id);
      removed++;
    });
  });
  
  saveDb();
  console.log('  ✓ Cleaned', removed, 'duplicate messages');
  console.log('\nDone. Server will auto-restart.');
});
