const fs = require('fs');
let tickets = fs.readFileSync('server/routes/tickets.js', 'utf8');

// After sending via Gmail, save the thread ID and message ID back to the DB
tickets = tickets.replace(
  "await gm.users.messages.send({ userId: 'me', requestBody: { raw } });\n      console.log('[Gmail] Reply sent to', toAddr);",
  `const sent = await gm.users.messages.send({ userId: 'me', requestBody: { raw } });
      console.log('[Gmail] Reply sent to', toAddr, 'threadId:', sent.data.threadId, 'msgId:', sent.data.id);
      // Save Gmail IDs back to the outbound message so thread matching works
      db.prepare('UPDATE messages SET gmail_message_id = ?, gmail_thread_id = ?, gmail_user_id = ? WHERE id = ?')
        .run(sent.data.id, sent.data.threadId, req.user.id, msgId);
      // Also update any other messages in this ticket that lack a thread ID
      db.prepare('UPDATE messages SET gmail_thread_id = ? WHERE ticket_id = ? AND gmail_thread_id IS NULL')
        .run(sent.data.threadId, req.params.id);
      saveDb();`
);

// Do the same for the compose/new ticket route
tickets = tickets.replace(
  "await gm.users.messages.send({ userId: 'me', requestBody: { raw } });\n      console.log('[Gmail] New message sent to', toEmail.trim());",
  `const sent = await gm.users.messages.send({ userId: 'me', requestBody: { raw } });
      console.log('[Gmail] New message sent to', toEmail.trim(), 'threadId:', sent.data.threadId, 'msgId:', sent.data.id);
      // Save Gmail IDs back to the outbound message
      db.prepare('UPDATE messages SET gmail_message_id = ?, gmail_thread_id = ?, gmail_user_id = ? WHERE id = ?')
        .run(sent.data.id, sent.data.threadId, req.user.id, msgId);
      saveDb();`
);

fs.writeFileSync('server/routes/tickets.js', tickets, 'utf8');
console.log('✓ Outbound messages now save Gmail thread ID');
console.log('  Future replies will match to existing tickets');

// Fix existing tickets: backfill thread IDs from inbound messages
const { initDb, getDb, saveDb } = require('./server/database');
initDb().then(() => {
  const db = getDb();
  // For each ticket with mixed null/non-null thread IDs, fill in the blanks
  const ticketsWithThreads = db.prepare(
    "SELECT DISTINCT ticket_id, gmail_thread_id FROM messages WHERE gmail_thread_id IS NOT NULL"
  ).all();
  ticketsWithThreads.forEach(t => {
    const updated = db.prepare('UPDATE messages SET gmail_thread_id = ? WHERE ticket_id = ? AND gmail_thread_id IS NULL')
      .run(t.gmail_thread_id, t.ticket_id);
    if (updated.changes > 0) console.log('  Backfilled', updated.changes, 'messages in ticket', t.ticket_id);
  });
  saveDb();
  console.log('Done.');
});
