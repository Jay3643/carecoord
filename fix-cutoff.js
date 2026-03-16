const fs = require('fs');

// 1. Fix personal inbox to only show emails before March 1, 2026
let gmail = fs.readFileSync('server/routes/gmail.js', 'utf8');

// Add before: filter to all personal inbox queries
gmail = gmail.replace(
  "const listParams = { userId: 'me', q, maxResults: max };",
  "// Only show emails from before 3/1/2026 in personal inbox — newer ones go to queue\n    const cutoffDate = '2026/03/01';\n    q = q ? q + ' before:' + cutoffDate : 'before:' + cutoffDate;\n    const listParams = { userId: 'me', q, maxResults: max };"
);

fs.writeFileSync('server/routes/gmail.js', gmail, 'utf8');
console.log('  ✓ gmail.js — personal inbox shows only emails before 3/1/2026');

// 2. Set the sync watermark to March 1, 2026 so only new emails after that go to queue
const { initDb, getDb, saveDb } = require('./server/database');
initDb().then(() => {
  const db = getDb();
  const march1 = new Date('2026-03-01T00:00:00').getTime();
  const users = db.prepare('SELECT user_id FROM gmail_tokens').all();
  users.forEach(u => {
    db.prepare('INSERT OR REPLACE INTO email_sync_state (user_id, last_sync_at) VALUES (?, ?)').run(u.user_id, march1);
    console.log('  ✓ Watermark set to 3/1/2026 for user', u.user_id);
  });
  saveDb();
  console.log('\nDone:');
  console.log('  • Personal inbox: shows all emails up to 2/28/2026');
  console.log('  • Regional queue: syncs emails from 3/1/2026 onward');
  console.log('  • Search still works within the historical inbox');
});
