const fs = require('fs');
let gmail = fs.readFileSync('server/routes/gmail.js', 'utf8');

// Replace the entire syncUser function
gmail = gmail.replace(
  /async function syncUser\(db, row\) \{[\s\S]*?return n;\n\}/,
  `async function syncUser(db, row) {
  const auth = authClient(row), gm = google.gmail({version:'v1',auth}), uid = toStr(row.user_id);
  const regions = db.prepare('SELECT region_id FROM user_regions WHERE user_id=?').all(uid);
  if (!regions.length) return 0;

  const syncState = db.prepare('SELECT last_sync_at, sync_start_date FROM email_sync_state WHERE user_id=?').get(uid);
  if (!syncState) {
    db.prepare('INSERT OR REPLACE INTO email_sync_state (user_id, last_sync_at, sync_start_date) VALUES (?, ?, ?)').run(uid, Date.now(), '2026/03/07');
    saveDb();
    console.log('[Sync]', toStr(row.email), 'initialized');
    return 0;
  }

  const startDate = toStr(syncState.sync_start_date) || '2026/03/07';
  const rid = toStr(regions[0].region_id);
  const archiveEmail = db.prepare("SELECT value FROM settings WHERE key='archive_email'").get();
  const archiveAddr = archiveEmail ? toStr(archiveEmail.value) : 'thinkprompted@gmail.com';

  // Load exception list — these senders/domains SKIP the queue, stay in personal inbox
  const exceptions = db.prepare("SELECT * FROM email_filters WHERE action='exception'").all();

  let n = 0, pageToken = null, scanned = 0;

  do {
    const params = { userId: 'me', q: 'in:inbox -from:me after:' + startDate, maxResults: 500 };
    if (pageToken) params.pageToken = pageToken;

    let list;
    try { list = await gm.users.messages.list(params); } catch(e) { console.error('[Sync] List error:', e.message); break; }
    if (!list.data.messages) break;

    for (const m of list.data.messages) {
      scanned++;

      // Already synced? Skip.
      if (db.prepare('SELECT 1 FROM messages WHERE gmail_message_id=?').get(m.id)) continue;

      let msg;
      try { msg = await gm.users.messages.get({ userId: 'me', id: m.id, format: 'full' }); } catch(e) { continue; }

      const h = msg.data.payload.headers;
      const from = hdr(h, 'From'), subj = hdr(h, 'Subject') || '(no subject)';
      const bd = body(msg.data.payload), thId = msg.data.threadId;
      const ts = parseInt(msg.data.internalDate) || Date.now();

      // Check exception list — if sender matches, skip queue (stays in personal inbox)
      let isException = false;
      for (const ex of exceptions) {
        const domain = toStr(ex.domain), sender = toStr(ex.sender), subjMatch = toStr(ex.subject_contains);
        if (domain && from.toLowerCase().includes(domain.toLowerCase())) { isException = true; break; }
        if (sender && from.toLowerCase().includes(sender.toLowerCase())) { isException = true; break; }
        if (subjMatch && subj.toLowerCase().includes(subjMatch.toLowerCase())) { isException = true; break; }
      }
      if (isException) continue;

      // ── Route to Regional Queue ──

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
        db.prepare('INSERT OR IGNORE INTO tickets (id,subject,from_email,region_id,status,created_at,last_activity_at,external_participants) VALUES (?,?,?,?,?,?,?,?)')
          .run(tid, subj, from, rid, 'OPEN', ts, ts, JSON.stringify([from]));
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
      }

      // ── Forward to archive ──
      try {
        const fwdHeaders = [
          'From: ' + toStr(row.email),
          'To: ' + archiveAddr,
          'Subject: Fwd: ' + subj,
          'Content-Type: text/plain; charset=utf-8',
          'MIME-Version: 1.0',
          '',
          '---------- Forwarded message ----------',
          'From: ' + from,
          'Date: ' + hdr(h, 'Date'),
          'Subject: ' + subj,
          '',
          bd || subj,
        ];
        const raw = Buffer.from(fwdHeaders.join('\\r\\n')).toString('base64url');
        await gm.users.messages.send({ userId: 'me', requestBody: { raw } });
      } catch(fwdErr) { console.log('[Sync] Forward failed:', fwdErr.message); }

      // ── Remove from coordinator's inbox (archive it) ──
      try {
        await gm.users.messages.modify({ userId: 'me', id: m.id, requestBody: { removeLabelIds: ['INBOX'] } });
      } catch(archErr) { console.log('[Sync] Archive failed:', archErr.message); }

      n++;
      if (n % 50 === 0) { saveDb(); console.log('[Sync]', toStr(row.email), n, 'processed (' + scanned + ' scanned)...'); }
    }

    pageToken = list.data.nextPageToken || null;
  } while (pageToken);

  db.prepare('UPDATE email_sync_state SET last_sync_at=? WHERE user_id=?').run(Date.now(), uid);
  saveDb();
  if (n || scanned > 0) console.log('[Sync]', toStr(row.email), n, 'new (' + scanned + ' scanned)');
  return n;
}`
);

// Add settings table to database.js if not exists
let dbFile = fs.readFileSync('server/database.js', 'utf8');
if (!dbFile.includes("'settings'")) {
  dbFile = dbFile.replace(
    "r('CREATE TABLE IF NOT EXISTS email_sync_state",
    "r('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)');\n  r('CREATE TABLE IF NOT EXISTS email_sync_state"
  );
  fs.writeFileSync('server/database.js', dbFile, 'utf8');
  console.log('  ✓ database.js — settings table added');
}

// Update email_filters: change 'personal' action to 'exception' for the new model
gmail = gmail.replace(
  `const filters = db.prepare("SELECT * FROM email_filters WHERE action='personal'").all();`,
  `// Legacy: no longer used in sync, exceptions handled in syncUser`
);

fs.writeFileSync('server/routes/gmail.js', gmail, 'utf8');

// Set archive email in settings
const { initDb, getDb, saveDb } = require('./server/database');
initDb().then(() => {
  const db = getDb();
  try { db.prepare("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)").run(); } catch(e) {}
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('archive_email', 'thinkprompted@gmail.com')").run();
  
  // Convert existing 'personal' filters to 'exception'
  try { db.prepare("UPDATE email_filters SET action='exception' WHERE action='personal'").run(); } catch(e) {}
  
  saveDb();
  console.log('  ✓ Archive email set to thinkprompted@gmail.com');
});

// Verify
try { require('./server/routes/gmail'); console.log('  ✓ gmail.js compiles OK'); }
catch(e) { console.log('  ERROR:', e.message); }

console.log('');
console.log('✅ New email flow:');
console.log('   1. Email arrives at coordinator inbox');
console.log('   2. Sync picks it up → creates ticket in Regional Queue');
console.log('   3. Forwards to thinkprompted@gmail.com (archive)');
console.log('   4. Removes from coordinator inbox (archived in Gmail)');
console.log('   5. Exception senders bypass queue, stay in personal inbox');
console.log('');
console.log('To add exceptions: Admin → Email Filters → add sender/domain with action "exception"');
console.log('');
console.log('Restart: taskkill /F /IM node.exe && npm run dev');
