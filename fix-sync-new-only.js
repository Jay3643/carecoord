// fix-sync-new-only.js
// Changes sync so first run sets a watermark (now), only future emails become tickets

const fs = require('fs');
let gmail = fs.readFileSync('server/routes/gmail.js', 'utf8');

// Replace the syncUser function
gmail = gmail.replace(
  /async function syncUser\(db, row\) \{[\s\S]*?return n;\n\}/,
  `async function syncUser(db, row) {
  const auth = authClient(row), gmail = google.gmail({version:'v1',auth}), uid = toStr(row.user_id);
  const regions = db.prepare('SELECT region_id FROM user_regions WHERE user_id=?').all(uid);
  if (!regions.length) return 0;

  // Check if this is the first sync — if so, just set the watermark, don't import old emails
  const syncState = db.prepare('SELECT last_sync_at FROM email_sync_state WHERE user_id=?').get(uid);
  if (!syncState) {
    db.prepare('INSERT INTO email_sync_state (user_id, last_sync_at) VALUES (?, ?)').run(uid, Date.now());
    saveDb();
    console.log('[Sync]', toStr(row.email), 'first sync — watermark set, skipping existing emails');
    return 0;
  }

  // Only fetch emails AFTER the last sync timestamp
  const afterDate = new Date(syncState.last_sync_at).toISOString().split('T')[0];
  const list = await gmail.users.messages.list({userId:'me', q:'in:inbox after:'+afterDate, maxResults:20});
  if (!list.data.messages) { db.prepare('UPDATE email_sync_state SET last_sync_at=? WHERE user_id=?').run(Date.now(), uid); saveDb(); return 0; }

  const filters = db.prepare("SELECT * FROM email_filters WHERE action='personal'").all();
  let n = 0;
  for (const m of list.data.messages) {
    if (db.prepare('SELECT id FROM messages WHERE gmail_message_id=?').get(m.id)) continue;
    const msg = await gmail.users.messages.get({userId:'me',id:m.id,format:'full'});
    // Skip emails older than our watermark (Gmail 'after:' is date-level, not timestamp-level)
    const internalDate = parseInt(msg.data.internalDate);
    if (internalDate <= syncState.last_sync_at) continue;

    const h = msg.data.payload.headers;
    const from=hdr(h,'From'), subj=hdr(h,'Subject')||'(no subject)', bd=body(msg.data.payload), dt=hdr(h,'Date'), thId=msg.data.threadId;
    let personal = false;
    for (const f of filters) {
      if (toStr(f.domain) && from.toLowerCase().includes(toStr(f.domain).toLowerCase())) { personal=true; break; }
      if (toStr(f.sender) && from.toLowerCase().includes(toStr(f.sender).toLowerCase())) { personal=true; break; }
      if (toStr(f.subject_contains) && subj.toLowerCase().includes(toStr(f.subject_contains).toLowerCase())) { personal=true; break; }
    }
    if (personal) continue;
    const rid=toStr(regions[0].region_id), ts=internalDate||Date.now();
    const tid='tk-'+Date.now()+'-'+Math.random().toString(36).slice(2,6);
    db.prepare('INSERT INTO tickets (id,subject,from_email,region_id,status,created_at,last_activity_at) VALUES (?,?,?,?,?,?,?)').run(tid,subj,from,rid,'OPEN',ts,ts);
    db.prepare('INSERT INTO messages (id,ticket_id,direction,sender,body_text,sent_at,gmail_message_id,gmail_thread_id,gmail_user_id) VALUES (?,?,?,?,?,?,?,?,?)').run('msg-'+Date.now()+'-'+Math.random().toString(36).slice(2,6),tid,'inbound',from,bd||subj,ts,m.id,thId,uid);
    n++;
  }
  db.prepare('UPDATE email_sync_state SET last_sync_at=? WHERE user_id=?').run(Date.now(), uid);
  saveDb();
  if (n) console.log('[Sync]', toStr(row.email), n, 'new');
  return n;
}`
);

fs.writeFileSync('server/routes/gmail.js', gmail, 'utf8');
console.log('✓ gmail.js — sync only imports NEW emails after watermark');
console.log('  First sync sets the marker. Existing inbox stays in Personal Email only.');
