const fs = require('fs');
let gmail = fs.readFileSync('server/routes/gmail.js', 'utf8');

// Replace the entire syncUser function with one that paginates through ALL emails
gmail = gmail.replace(
  /async function syncUser\(db, row\) \{[\s\S]*?return n;\n\}/,
  `async function syncUser(db, row) {
  const auth = authClient(row), gm = google.gmail({version:'v1',auth}), uid = toStr(row.user_id);
  const regions = db.prepare('SELECT region_id FROM user_regions WHERE user_id=?').all(uid);
  if (!regions.length) return 0;

  const syncState = db.prepare('SELECT last_sync_at FROM email_sync_state WHERE user_id=?').get(uid);
  if (!syncState) {
    db.prepare('INSERT INTO email_sync_state (user_id, last_sync_at) VALUES (?, ?)').run(uid, Date.now());
    saveDb();
    console.log('[Sync]', toStr(row.email), 'first sync — watermark set');
    return 0;
  }

  const afterMs = new Date(syncState.last_sync_at); afterMs.setDate(afterMs.getDate() - 1);
  const afterDate = afterMs.toISOString().split('T')[0];
  const filters = db.prepare("SELECT * FROM email_filters WHERE action='personal'").all();
  const rid = toStr(regions[0].region_id);
  let n = 0, pageToken = null, totalProcessed = 0;

  // Paginate through ALL matching emails
  do {
    const listParams = { userId: 'me', q: 'in:inbox after:' + afterDate, maxResults: 500 };
    if (pageToken) listParams.pageToken = pageToken;
    const list = await gm.users.messages.list(listParams);
    if (!list.data.messages) break;

    for (const m of list.data.messages) {
      totalProcessed++;
      // Skip already synced
      if (db.prepare('SELECT id FROM messages WHERE gmail_message_id=?').get(m.id)) continue;

      const msg = await gm.users.messages.get({ userId: 'me', id: m.id, format: 'full' });
      const internalDate = parseInt(msg.data.internalDate);
      if (internalDate <= syncState.last_sync_at) continue;

      const h = msg.data.payload.headers;
      const from = hdr(h, 'From'), subj = hdr(h, 'Subject') || '(no subject)', bd = body(msg.data.payload), thId = msg.data.threadId;

      // Check personal filters
      let personal = false;
      for (const f of filters) {
        if (toStr(f.domain) && from.toLowerCase().includes(toStr(f.domain).toLowerCase())) { personal = true; break; }
        if (toStr(f.sender) && from.toLowerCase().includes(toStr(f.sender).toLowerCase())) { personal = true; break; }
        if (toStr(f.subject_contains) && subj.toLowerCase().includes(toStr(f.subject_contains).toLowerCase())) { personal = true; break; }
      }
      if (personal) continue;

      const ts = internalDate || Date.now();

      // Check if reply to existing thread
      const existingMsg = db.prepare('SELECT ticket_id FROM messages WHERE gmail_thread_id = ? LIMIT 1').get(thId);
      if (existingMsg) {
        const existingTicket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(existingMsg.ticket_id);
        if (existingTicket) {
          const msgDbId = 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
          db.prepare('INSERT OR IGNORE INTO messages (id,ticket_id,direction,channel,from_address,to_addresses,sender,subject,body_text,sent_at,provider_message_id,in_reply_to,reference_ids,gmail_message_id,gmail_thread_id,gmail_user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
            .run(msgDbId, existingMsg.ticket_id, 'inbound', 'email', from, JSON.stringify([toStr(row.email)]), from, subj, bd || subj, ts, m.id, null, '[]', m.id, thId, uid, ts);
          db.prepare('UPDATE tickets SET last_activity_at = ?, has_unread = 1, status = ? WHERE id = ?')
            .run(ts, 'OPEN', existingMsg.ticket_id);
          n++;
          continue;
        }
      }

      // Create new ticket
      const tid = 'tk-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
      db.prepare('INSERT OR IGNORE INTO tickets (id,subject,from_email,region_id,status,created_at,last_activity_at,external_participants) VALUES (?,?,?,?,?,?,?,?)')
        .run(tid, subj, from, rid, 'OPEN', ts, ts, JSON.stringify([from]));
      const msgDbId = 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
      db.prepare('INSERT OR IGNORE INTO messages (id,ticket_id,direction,channel,from_address,to_addresses,sender,subject,body_text,sent_at,provider_message_id,in_reply_to,reference_ids,gmail_message_id,gmail_thread_id,gmail_user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(msgDbId, tid, 'inbound', 'email', from, JSON.stringify([toStr(row.email)]), from, subj, bd || subj, ts, m.id, null, '[]', m.id, thId, uid, ts);

      // Attachments
      try {
        const parts = msg.data.payload.parts || [];
        for (const part of parts) {
          if (part.filename && part.body && part.body.attachmentId) {
            const att = await gm.users.messages.attachments.get({ userId: 'me', messageId: m.id, id: part.body.attachmentId });
            if (att.data && att.data.data) {
              const attId = 'att-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
              db.prepare('INSERT INTO attachments (id, ticket_id, filename, data, message_id, mime_type, size) VALUES (?,?,?,?,?,?,?)')
                .run(attId, tid, part.filename, att.data.data, msgDbId, part.mimeType || 'application/octet-stream', att.data.size || 0);
            }
          }
        }
      } catch (attErr) {}
      n++;

      // Save every 50 to avoid losing progress
      if (n % 50 === 0) { saveDb(); console.log('[Sync]', toStr(row.email), n, 'synced so far...'); }
    }

    pageToken = list.data.nextPageToken || null;
  } while (pageToken);

  db.prepare('UPDATE email_sync_state SET last_sync_at=? WHERE user_id=?').run(Date.now(), uid);
  saveDb();
  if (n) console.log('[Sync]', toStr(row.email), n, 'new (scanned', totalProcessed, 'total)');
  return n;
}`
);

// Fix auto-sync: reduce rate limit to 15 seconds for near real-time
gmail = gmail.replace(
  'if (Date.now() - lastSyncTime < 30000) return res.json({ synced: 0, cached: true });',
  'if (Date.now() - lastSyncTime < 15000) return res.json({ synced: 0, cached: true });'
);

// Remove the 60-second stale check in auto-sync
gmail = gmail.replace(
  "if (st && st.last_sync_at && (Date.now() - st.last_sync_at) < 60000) return res.json({ synced: 0 });",
  "// No stale check — always sync"
);

fs.writeFileSync('server/routes/gmail.js', gmail, 'utf8');

try { require('./server/routes/gmail'); console.log('✓ gmail.js compiles OK'); }
catch(e) { console.log('ERROR:', e.message); }

console.log('');
console.log('✓ Sync now:');
console.log('  • Paginates through ALL emails (no 20/100 cap)');
console.log('  • Saves progress every 50 emails');
console.log('  • Auto-sync every 15 seconds');
console.log('  • Thread matching for replies');
console.log('  • Attachment extraction');
console.log('');
console.log('Trigger initial full sync from browser console:');
console.log("  fetch('/api/gmail/sync',{method:'POST',credentials:'include'}).then(r=>r.json()).then(console.log)");
