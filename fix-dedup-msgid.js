const fs = require('fs');
let gmail = fs.readFileSync('server/routes/gmail.js', 'utf8');

// Replace the dedup section that checks gmail_thread_id across users
// We need to use the RFC Message-ID header which is identical for all recipients

// First, add Message-ID extraction after the "from" and "subj" lines
gmail = gmail.replace(
  "      const from = hdr(h, 'From'), subj = hdr(h, 'Subject') || '(no subject)';\n      const bd = body(msg.data.payload), thId = msg.data.threadId;\n      const ts = parseInt(msg.data.internalDate) || Date.now();",
  "      const from = hdr(h, 'From'), subj = hdr(h, 'Subject') || '(no subject)';\n      const bd = body(msg.data.payload), thId = msg.data.threadId;\n      const ts = parseInt(msg.data.internalDate) || Date.now();\n      const rfcMessageId = hdr(h, 'Message-ID') || hdr(h, 'Message-Id') || '';"
);

// Now replace the entire "Route to Regional Queue" block with Message-ID based dedup
gmail = gmail.replace(
  `      // ── Route to Regional Queue (with multi-recipient dedup) ──

      // Check if a ticket already exists for this thread (across ALL users)
      const existingThread = db.prepare('SELECT ticket_id FROM messages WHERE gmail_thread_id = ? LIMIT 1').get(thId);
      if (existingThread && db.prepare('SELECT id FROM tickets WHERE id = ?').get(existingThread.ticket_id)) {
        // Ticket exists for this thread — check if this is a new message or just another recipient
        const alreadyHasThisMsg = db.prepare('SELECT 1 FROM messages WHERE gmail_message_id = ?').get(m.id);
        if (!alreadyHasThisMsg) {
          // New message in existing thread (reply) — add it
          const msgId = 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
          db.prepare('INSERT OR IGNORE INTO messages (id,ticket_id,direction,channel,from_address,to_addresses,sender,subject,body_text,sent_at,provider_message_id,in_reply_to,reference_ids,gmail_message_id,gmail_thread_id,gmail_user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
            .run(msgId, existingThread.ticket_id, 'inbound', 'email', from, JSON.stringify([toStr(row.email)]), from, subj, bd || subj, ts, m.id, null, '[]', m.id, thId, uid, ts);
          db.prepare('UPDATE tickets SET last_activity_at=?, has_unread=1, status=? WHERE id=?').run(ts, 'OPEN', existingThread.ticket_id);
        }
        // Check if another user already created this ticket — if so, unassign for supervisor
        const ticket = db.prepare('SELECT assignee_user_id FROM tickets WHERE id = ?').get(existingThread.ticket_id);
        if (ticket && ticket.assignee_user_id && toStr(ticket.assignee_user_id) !== uid) {
          // Multiple coordinators received this — unassign so supervisor decides
          db.prepare('UPDATE tickets SET assignee_user_id = NULL WHERE id = ?').run(existingThread.ticket_id);
          console.log('[Sync] Multi-recipient detected — unassigned ticket', existingThread.ticket_id);
        }
      } else {
        // No existing ticket for this thread — create new one, auto-assign to this coordinator
        const tid = 'tk-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
        db.prepare('INSERT OR IGNORE INTO tickets (id,subject,from_email,region_id,status,assignee_user_id,created_at,last_activity_at,external_participants,has_unread) VALUES (?,?,?,?,?,?,?,?,?,1)')
          .run(tid, subj, from, rid, 'OPEN', uid, ts, ts, JSON.stringify([from]));
        const msgId = 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
        db.prepare('INSERT OR IGNORE INTO messages (id,ticket_id,direction,channel,from_address,to_addresses,sender,subject,body_text,sent_at,provider_message_id,in_reply_to,reference_ids,gmail_message_id,gmail_thread_id,gmail_user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(msgId, tid, 'inbound', 'email', from, JSON.stringify([toStr(row.email)]), from, subj, bd || subj, ts, m.id, null, '[]', m.id, thId, uid, ts);

        // Attachments
        try {
          const parts = msg.data.payload.parts || [];
          for (const part of parts) {
            if (part.filename && part.body && part.body.attachmentId) {
              const att = await gm.users.messages.attachments.get({ userId: 'me', messageId: m.id, id: part.body.attachmentId });
              if (att.data && att.data.data) {
                db.prepare('INSERT OR IGNORE INTO attachments (id,ticket_id,filename,data,message_id,mime_type,size) VALUES (?,?,?,?,?,?,?)')
                  .run('att-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6), tid, part.filename, att.data.data, msgId, part.mimeType || 'application/octet-stream', att.data.size || 0);
              }
            }
          }
        } catch(e) {}
      }`,
  `      // ── Route to Regional Queue (with multi-recipient dedup via Message-ID) ──

      // Check if this exact email (by RFC Message-ID) already created a ticket
      // Message-ID is identical across all recipients, unlike gmail thread/message IDs
      let existingTicketId = null;
      if (rfcMessageId) {
        const existingByMsgId = db.prepare("SELECT ticket_id FROM messages WHERE provider_message_id = ? LIMIT 1").get(rfcMessageId);
        if (existingByMsgId) existingTicketId = toStr(existingByMsgId.ticket_id);
      }
      // Also check by gmail thread ID for replies within same account
      if (!existingTicketId) {
        const existingByThread = db.prepare('SELECT ticket_id FROM messages WHERE gmail_thread_id = ? LIMIT 1').get(thId);
        if (existingByThread && db.prepare('SELECT id FROM tickets WHERE id = ?').get(existingByThread.ticket_id)) {
          existingTicketId = toStr(existingByThread.ticket_id);
        }
      }

      if (existingTicketId) {
        // Ticket already exists — this is either a reply or another recipient got the same email
        const msgId = 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
        db.prepare('INSERT OR IGNORE INTO messages (id,ticket_id,direction,channel,from_address,to_addresses,sender,subject,body_text,sent_at,provider_message_id,in_reply_to,reference_ids,gmail_message_id,gmail_thread_id,gmail_user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(msgId, existingTicketId, 'inbound', 'email', from, JSON.stringify([toStr(row.email)]), from, subj, bd || subj, ts, rfcMessageId || m.id, null, '[]', m.id, thId, uid, ts);
        db.prepare('UPDATE tickets SET last_activity_at=?, has_unread=1, status=? WHERE id=?').run(ts, 'OPEN', existingTicketId);

        // If a different coordinator already owns this ticket, unassign for supervisor
        const ticket = db.prepare('SELECT assignee_user_id FROM tickets WHERE id = ?').get(existingTicketId);
        if (ticket && ticket.assignee_user_id && toStr(ticket.assignee_user_id) !== uid) {
          db.prepare('UPDATE tickets SET assignee_user_id = NULL WHERE id = ?').run(existingTicketId);
          console.log('[Sync] Multi-recipient — unassigned ticket', existingTicketId, '(was', toStr(ticket.assignee_user_id), ', also received by', uid, ')');
        }
      } else {
        // Brand new email — create ticket, auto-assign to this coordinator
        const tid = 'tk-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
        db.prepare('INSERT OR IGNORE INTO tickets (id,subject,from_email,region_id,status,assignee_user_id,created_at,last_activity_at,external_participants,has_unread) VALUES (?,?,?,?,?,?,?,?,?,1)')
          .run(tid, subj, from, rid, 'OPEN', uid, ts, ts, JSON.stringify([from]));
        const msgId = 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
        db.prepare('INSERT OR IGNORE INTO messages (id,ticket_id,direction,channel,from_address,to_addresses,sender,subject,body_text,sent_at,provider_message_id,in_reply_to,reference_ids,gmail_message_id,gmail_thread_id,gmail_user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(msgId, tid, 'inbound', 'email', from, JSON.stringify([toStr(row.email)]), from, subj, bd || subj, ts, rfcMessageId || m.id, null, '[]', m.id, thId, uid, ts);

        // Attachments
        try {
          const parts = msg.data.payload.parts || [];
          for (const part of parts) {
            if (part.filename && part.body && part.body.attachmentId) {
              const att = await gm.users.messages.attachments.get({ userId: 'me', messageId: m.id, id: part.body.attachmentId });
              if (att.data && att.data.data) {
                db.prepare('INSERT OR IGNORE INTO attachments (id,ticket_id,filename,data,message_id,mime_type,size) VALUES (?,?,?,?,?,?,?)')
                  .run('att-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6), tid, part.filename, att.data.data, msgId, part.mimeType || 'application/octet-stream', att.data.size || 0);
              }
            }
          }
        } catch(e) {}
      }`
);

fs.writeFileSync('server/routes/gmail.js', gmail, 'utf8');

const check = fs.readFileSync('server/routes/gmail.js', 'utf8');
if (check.includes('rfcMessageId') && check.includes('Multi-recipient')) {
  console.log('✓ Dedup now uses RFC Message-ID header (same across all recipients)');
  console.log('');
  console.log('How it works:');
  console.log('  1. Extract Message-ID header from email (identical for all recipients)');
  console.log('  2. Check if any ticket already has a message with that Message-ID');
  console.log('  3. If yes → attach to existing ticket, unassign if different coordinator');
  console.log('  4. If no → create new ticket, auto-assign to this coordinator');
  console.log('  5. Email hidden from this coordinator\'s Gmail regardless');
} else {
  console.log('✗ Failed — replacement did not match');
}
