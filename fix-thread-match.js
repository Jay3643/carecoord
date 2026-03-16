const fs = require('fs');
let gmail = fs.readFileSync('server/routes/gmail.js', 'utf8');

// Find the section where new tickets are created and add thread matching BEFORE it
// The key: check if a message with the same gmail_thread_id already exists — if so, add to that ticket instead of creating new one

gmail = gmail.replace(
  "if (personal) continue;",
  `if (personal) continue;
    // Check if this email belongs to an existing ticket thread
    const existingMsg = db.prepare('SELECT ticket_id FROM messages WHERE gmail_thread_id = ? LIMIT 1').get(thId);
    if (existingMsg) {
      // Add reply to existing ticket
      const existingTicket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(existingMsg.ticket_id);
      if (existingTicket) {
        const msgDbId = 'msg-'+Date.now()+'-'+Math.random().toString(36).slice(2,6);
        db.prepare('INSERT OR IGNORE INTO messages (id,ticket_id,direction,channel,from_address,to_addresses,sender,subject,body_text,sent_at,provider_message_id,in_reply_to,reference_ids,gmail_message_id,gmail_thread_id,gmail_user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(msgDbId, existingMsg.ticket_id, 'inbound', 'email', from, JSON.stringify([toStr(row.email)]), from, subj, bd||subj, ts, m.id, null, '[]', m.id, thId, uid, ts);
        db.prepare('UPDATE tickets SET last_activity_at = ?, has_unread = 1, status = ? WHERE id = ?')
          .run(ts, 'OPEN', existingMsg.ticket_id);
        n++;
        console.log('[Sync] Reply added to ticket:', existingMsg.ticket_id);
        continue;
      }
    }`
);

fs.writeFileSync('server/routes/gmail.js', gmail, 'utf8');
console.log('✓ Sync now matches replies to existing tickets by thread ID');
console.log('  - New email → new ticket');
console.log('  - Reply in same thread → added to existing ticket');

// Clean up the duplicate ticket from the reply
const { initDb, getDb, saveDb } = require('./server/database');
initDb().then(() => {
  const db = getDb();
  // Find tickets that share a gmail_thread_id and merge them
  const threads = db.prepare("SELECT gmail_thread_id, COUNT(DISTINCT ticket_id) as tc FROM messages WHERE gmail_thread_id IS NOT NULL GROUP BY gmail_thread_id HAVING tc > 1").all();
  threads.forEach(t => {
    const msgs = db.prepare('SELECT DISTINCT ticket_id FROM messages WHERE gmail_thread_id = ? ORDER BY sent_at ASC').all(t.gmail_thread_id);
    if (msgs.length > 1) {
      const keepTicket = msgs[0].ticket_id;
      msgs.slice(1).forEach(m => {
        // Move messages to the first ticket
        db.prepare('UPDATE messages SET ticket_id = ? WHERE ticket_id = ?').run(keepTicket, m.ticket_id);
        // Delete the duplicate ticket
        db.prepare('DELETE FROM tickets WHERE id = ?').run(m.ticket_id);
        console.log('  Merged ticket', m.ticket_id, '→', keepTicket);
      });
    }
  });
  saveDb();
  console.log('Done.');
});
