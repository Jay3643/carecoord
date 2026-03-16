const fs = require('fs');
let gmail = fs.readFileSync('server/routes/gmail.js', 'utf8');

// Replace the entire "Route to Regional Queue" section inside syncUser
// This is the block from "// ── Route to Regional Queue ──" to before "// ── Hide from coordinator"

gmail = gmail.replace(
      `      // ── Route to Regional Queue ──

      // Check if reply to existing thread
      const existing = db.prepare('SELECT ticket_id FROM messages WHERE gmail_thread_id = ? LIMIT 1').get(thId);
      if (existing && db.prepare('SELECT id FROM tickets WHERE id = ?').get(existing.ticket_id)) {
        const msgId = 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
        db.prepare('INSERT OR IGNORE INTO messages (id,ticket_id,direction,channel,from_address,to_addresses,sender,subject,body_text,sent_at,provider_message_id,in_reply_to,reference_ids,gmail_message_id,gmail_thread_id,gmail_user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(msgId, existing.ticket_id, 'inbound', 'email', from, JSON.stringify([toStr(row.email)]), from, subj, bd || subj, ts, m.id, null, '[]', m.id, thId, uid, ts);
        db.prepare('UPDATE tickets SET last_activity_at=?, has_unread=1, status=? WHERE id=?').run(ts, 'OPEN', existing.ticket_id);
      } else {
        // Create new ticket
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
      }`
);

fs.writeFileSync('server/routes/gmail.js', gmail, 'utf8');

// Verify
const check = fs.readFileSync('server/routes/gmail.js', 'utf8');
console.log(check.includes('Multi-recipient detected') ? '✓ Multi-recipient dedup logic added' : '✗ Failed');
console.log('');
console.log('How it works now:');
console.log('  1. Email sent to ONE coordinator → auto-assigned to them');
console.log('  2. Same thread found by ANOTHER coordinator → ticket unassigned');
console.log('  3. Supervisor/admin assigns from queue');
console.log('  4. Email hidden from ALL coordinators who received it');
console.log('');
console.log('Push and redeploy.');
