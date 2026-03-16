// fix-duplicates.js — Run from carecoord root, with server stopped
// Cleans up duplicate tickets and prevents future ones

const { initDb, getDb, saveDb } = require('./server/database');

initDb().then(() => {
  const db = getDb();

  // Find and remove duplicate tickets (keep first, delete rest)
  const dupes = db.prepare("SELECT gmail_message_id, COUNT(*) as c FROM messages WHERE gmail_message_id IS NOT NULL GROUP BY gmail_message_id HAVING c > 1").all();
  console.log('Found', dupes.length, 'duplicate groups');

  let removed = 0;
  dupes.forEach(d => {
    const msgs = db.prepare('SELECT id, ticket_id FROM messages WHERE gmail_message_id = ? ORDER BY sent_at ASC').all(d.gmail_message_id);
    msgs.slice(1).forEach(m => {
      db.prepare('DELETE FROM messages WHERE id = ?').run(m.id);
      db.prepare('DELETE FROM tickets WHERE id = ?').run(m.ticket_id);
      removed++;
      console.log('  Removed duplicate ticket:', m.ticket_id);
    });
  });

  // Show remaining synced tickets
  const synced = db.prepare("SELECT id, subject FROM tickets WHERE id LIKE 'tk-%-%'").all();
  console.log('Synced tickets remaining:', synced.length);
  synced.forEach(t => console.log('  ', t.id, '-', t.subject));

  saveDb();
  console.log('\nDone. Removed', removed, 'duplicates. Run: npm run dev');
});
