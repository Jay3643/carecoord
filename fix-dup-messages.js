const fs = require('fs');
let gmail = fs.readFileSync('server/routes/gmail.js', 'utf8');

// In the existing ticket branch, before inserting the message, check if a message
// with the same RFC Message-ID already exists in this ticket
gmail = gmail.replace(
  `      if (existingTicketId) {
        // Ticket already exists — this is either a reply or another recipient got the same email
        const msgId = 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
        db.prepare('INSERT OR IGNORE INTO messages (id,ticket_id,direction,channel,from_address,to_addresses,sender,subject,body_text,sent_at,provider_message_id,in_reply_to,reference_ids,gmail_message_id,gmail_thread_id,gmail_user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(msgId, existingTicketId, 'inbound', 'email', from, JSON.stringify([toStr(row.email)]), from, subj, bd || subj, ts, rfcMessageId || m.id, null, '[]', m.id, thId, uid, ts);
        db.prepare('UPDATE tickets SET last_activity_at=?, has_unread=1, status=? WHERE id=?').run(ts, 'OPEN', existingTicketId);`,
  `      if (existingTicketId) {
        // Ticket already exists — check if this exact message (by RFC Message-ID) is already recorded
        const alreadyRecorded = rfcMessageId ? db.prepare("SELECT 1 FROM messages WHERE ticket_id = ? AND provider_message_id = ?").get(existingTicketId, rfcMessageId) : null;
        if (!alreadyRecorded) {
          // New message in this thread (reply or first sync) — add it
          const msgId = 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
          db.prepare('INSERT OR IGNORE INTO messages (id,ticket_id,direction,channel,from_address,to_addresses,sender,subject,body_text,sent_at,provider_message_id,in_reply_to,reference_ids,gmail_message_id,gmail_thread_id,gmail_user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
            .run(msgId, existingTicketId, 'inbound', 'email', from, JSON.stringify([toStr(row.email)]), from, subj, bd || subj, ts, rfcMessageId || m.id, null, '[]', m.id, thId, uid, ts);
          db.prepare('UPDATE tickets SET last_activity_at=?, has_unread=1, status=? WHERE id=?').run(ts, 'OPEN', existingTicketId);
        }`
);

fs.writeFileSync('server/routes/gmail.js', gmail, 'utf8');

const check = fs.readFileSync('server/routes/gmail.js', 'utf8');
console.log(check.includes('alreadyRecorded') ? '✓ Duplicate messages prevented — one message per RFC Message-ID per ticket' : '✗ Failed');
