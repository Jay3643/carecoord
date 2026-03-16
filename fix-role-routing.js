const fs = require('fs');
let gmail = fs.readFileSync('server/routes/gmail.js', 'utf8');

// Fix the role check in syncUser
if (gmail.includes("role === 'admin'")) {
  gmail = gmail.replace(
    /  \/\/ ── Role-based routing ──[\s\S]*?if \(role === 'supervisor'\) return 0;/,
    `  // ── Role-based routing ──
  // Admin: no sync (emails stay in inbox, can push/pull manually)
  // Supervisor: no sync (emails stay in inbox, can push/pull manually)  
  // Coordinator: full treatment (queue + archive + remove from inbox)
  const userRow = db.prepare('SELECT role FROM users WHERE id = ?').get(uid);
  const role = userRow ? toStr(userRow.role) : 'coordinator';
  if (role === 'admin' || role === 'supervisor') return 0;`
  );
  
  if (!gmail.includes("role === 'admin' || role === 'supervisor'")) {
    gmail = gmail.replace(
      /  \/\/ Role-based routing:[\s\S]*?return 0;\n  \}/,
      `  const userRow = db.prepare('SELECT role FROM users WHERE id = ?').get(uid);
  const role = userRow ? toStr(userRow.role) : 'coordinator';
  if (role === 'admin' || role === 'supervisor') return 0;`
    );
  }
}

// Add push-to-queue and pull-from-queue endpoints
if (!gmail.includes('/push-to-queue')) {
  gmail = gmail.replace(
    "// ── Filters ──",
    `// ── Push email to queue (supervisor + admin) ──
router.post('/push-to-queue', requireAuth, async (req, res) => {
  if (req.user.role !== 'supervisor' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Supervisor or admin access required' });
  }
  const db = getDb();
  const { gmailMessageId, regionId } = req.body;
  if (!gmailMessageId) return res.status(400).json({ error: 'gmailMessageId required' });
  if (db.prepare('SELECT 1 FROM messages WHERE gmail_message_id=?').get(gmailMessageId)) {
    return res.status(400).json({ error: 'Already in queue' });
  }
  const t = getTokens(req.user.id);
  if (!t) return res.status(400).json({ error: 'Not connected' });
  try {
    const gm = google.gmail({ version: 'v1', auth: authClient(t) });
    const msg = await gm.users.messages.get({ userId: 'me', id: gmailMessageId, format: 'full' });
    const h = msg.data.payload.headers;
    const from = hdr(h, 'From'), subj = hdr(h, 'Subject') || '(no subject)';
    const bd = body(msg.data.payload), thId = msg.data.threadId;
    const ts = parseInt(msg.data.internalDate) || Date.now();
    const regions = db.prepare('SELECT region_id FROM user_regions WHERE user_id=?').all(req.user.id);
    const rid = regionId || (regions.length ? toStr(regions[0].region_id) : 'r1');
    const existing = db.prepare('SELECT ticket_id FROM messages WHERE gmail_thread_id = ? LIMIT 1').get(thId);
    let ticketId;
    if (existing && db.prepare('SELECT id FROM tickets WHERE id = ?').get(existing.ticket_id)) {
      ticketId = existing.ticket_id;
      const msgId = 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
      db.prepare('INSERT OR IGNORE INTO messages (id,ticket_id,direction,channel,from_address,to_addresses,sender,subject,body_text,sent_at,provider_message_id,in_reply_to,reference_ids,gmail_message_id,gmail_thread_id,gmail_user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(msgId, ticketId, 'inbound', 'email', from, JSON.stringify([toStr(t.email)]), from, subj, bd || subj, ts, gmailMessageId, null, '[]', gmailMessageId, thId, req.user.id, ts);
      db.prepare('UPDATE tickets SET last_activity_at=?, has_unread=1, status=? WHERE id=?').run(ts, 'OPEN', ticketId);
    } else {
      ticketId = 'tk-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
      db.prepare('INSERT OR IGNORE INTO tickets (id,subject,from_email,region_id,status,created_at,last_activity_at,external_participants) VALUES (?,?,?,?,?,?,?,?)')
        .run(ticketId, subj, from, rid, 'OPEN', ts, ts, JSON.stringify([from]));
      const msgId = 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
      db.prepare('INSERT OR IGNORE INTO messages (id,ticket_id,direction,channel,from_address,to_addresses,sender,subject,body_text,sent_at,provider_message_id,in_reply_to,reference_ids,gmail_message_id,gmail_thread_id,gmail_user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(msgId, ticketId, 'inbound', 'email', from, JSON.stringify([toStr(t.email)]), from, subj, bd || subj, ts, gmailMessageId, null, '[]', gmailMessageId, thId, req.user.id, ts);
      try {
        const parts = msg.data.payload.parts || [];
        for (const part of parts) {
          if (part.filename && part.body && part.body.attachmentId) {
            const att = await gm.users.messages.attachments.get({ userId: 'me', messageId: gmailMessageId, id: part.body.attachmentId });
            if (att.data && att.data.data) {
              db.prepare('INSERT OR IGNORE INTO attachments (id,ticket_id,filename,data,message_id,mime_type,size) VALUES (?,?,?,?,?,?,?)')
                .run('att-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6), ticketId, part.filename, att.data.data, msgId, part.mimeType || 'application/octet-stream', att.data.size || 0);
            }
          }
        }
      } catch(e) {}
    }
    try {
      const archiveRow = db.prepare("SELECT value FROM settings WHERE key='archive_email'").get();
      const archiveAddr = archiveRow ? toStr(archiveRow.value) : 'thinkprompted@gmail.com';
      const fwd = ['From: ' + toStr(t.email), 'To: ' + archiveAddr, 'Subject: Fwd: ' + subj,
        'Content-Type: text/plain; charset=utf-8', 'MIME-Version: 1.0', '',
        '---------- Forwarded message ----------', 'From: ' + from,
        'Date: ' + hdr(h, 'Date'), 'Subject: ' + subj, '', bd || subj];
      const raw = Buffer.from(fwd.join(String.fromCharCode(13,10))).toString('base64url');
      await gm.users.messages.send({ userId: 'me', requestBody: { raw } });
    } catch(e) { console.log('[Push] Forward failed:', e.message); }
    try { await gm.users.messages.modify({ userId: 'me', id: gmailMessageId, requestBody: { removeLabelIds: ['INBOX'] } }); } catch(e) {}
    saveDb();
    console.log('[Queue] Pushed:', ticketId, '-', subj);
    res.json({ ticketId, subject: subj });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/pull-from-queue', requireAuth, async (req, res) => {
  if (req.user.role !== 'supervisor' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Supervisor or admin access required' });
  }
  const db = getDb();
  const { ticketId } = req.body;
  if (!ticketId) return res.status(400).json({ error: 'ticketId required' });
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  const t = getTokens(req.user.id);
  if (t) {
    const gm = google.gmail({ version: 'v1', auth: authClient(t) });
    const msgs = db.prepare('SELECT gmail_message_id FROM messages WHERE ticket_id = ? AND gmail_message_id IS NOT NULL').all(ticketId);
    for (const m of msgs) {
      try { await gm.users.messages.modify({ userId: 'me', id: m.gmail_message_id, requestBody: { addLabelIds: ['INBOX'] } }); } catch(e) {}
    }
  }
  db.prepare('DELETE FROM attachments WHERE ticket_id = ?').run(ticketId);
  db.prepare('DELETE FROM messages WHERE ticket_id = ?').run(ticketId);
  db.prepare('DELETE FROM ticket_tags WHERE ticket_id = ?').run(ticketId);
  db.prepare('DELETE FROM tickets WHERE id = ?').run(ticketId);
  saveDb();
  console.log('[Queue] Pulled:', ticketId);
  res.json({ ok: true, ticketId });
});

// ── Filters ──`
  );
}

fs.writeFileSync('server/routes/gmail.js', gmail, 'utf8');

// Add API methods
let api = fs.readFileSync('client/src/api.js', 'utf8');
if (!api.includes('pushToQueue')) {
  api = api.replace(
    "gmailAuth:",
    "pushToQueue: (gmailMessageId, regionId) => request('/gmail/push-to-queue', { method: 'POST', body: { gmailMessageId, regionId } }),\n  pullFromQueue: (ticketId) => request('/gmail/pull-from-queue', { method: 'POST', body: { ticketId } }),\n  gmailAuth:"
  );
  fs.writeFileSync('client/src/api.js', api, 'utf8');
  console.log('  ✓ api.js — push/pull methods added');
}

// Add Push to Queue button in PersonalInbox
let inbox = fs.readFileSync('client/src/components/PersonalInbox.jsx', 'utf8');
if (!inbox.includes('pushToQueue')) {
  inbox = inbox.replace(
    /<GIcon name="reply" size=\{18\} \/> Reply/,
    '<GIcon name="reply" size={18} /> Reply'
  );
  inbox = inbox.replace(
    `<GIcon name="reply" size={18} /> Reply
                    </div>`,
    `<GIcon name="reply" size={18} /> Reply
                    </div>
                    <div onClick={async () => {
                      try {
                        const d = await api.pushToQueue(selected.id);
                        showToast?.('Pushed to queue: ' + (d.subject||''));
                        setMessages(prev => prev.filter(m => m.id !== selected.id));
                        setSelected(null); setDetail(null);
                      } catch(e) { showToast?.(e.message || 'Failed to push'); }
                    }} style={{ display:'inline-flex',alignItems:'center',gap:8,padding:'8px 24px',border:'1px solid #dadce0',borderRadius:18,cursor:'pointer',fontSize:14,color:'#1a73e8',marginLeft:8 }} className="gi-row">
                      Push to Queue
                    </div>`
  );
  fs.writeFileSync('client/src/components/PersonalInbox.jsx', inbox, 'utf8');
  console.log('  ✓ PersonalInbox — Push to Queue button');
}

// Add Pull from Queue button in TicketDetail
let td = fs.readFileSync('client/src/components/TicketDetail.jsx', 'utf8');
if (!td.includes('pullFromQueue')) {
  td = td.replace(
    `<button onClick={() => setShowCloseModal(true)} style={{ padding: '6px 12px', background: '#dde8f2', color: '#d94040', border: '1px solid #c0d0e4', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>Close</button>`,
    `<button onClick={() => setShowCloseModal(true)} style={{ padding: '6px 12px', background: '#dde8f2', color: '#d94040', border: '1px solid #c0d0e4', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>Close</button>
                {isSupervisor && (
                  <button onClick={async () => { try { await api.pullFromQueue(ticketId); showToast('Returned to inbox'); onBack(); } catch(e) { showToast(e.message); } }}
                    style={{ padding: '6px 12px', background: '#dde8f2', color: '#c96a1b', border: '1px solid #c0d0e4', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>Pull from Queue</button>
                )}`
  );
  fs.writeFileSync('client/src/components/TicketDetail.jsx', td, 'utf8');
  console.log('  ✓ TicketDetail — Pull from Queue button');
}

try { require('./server/routes/gmail'); console.log('  ✓ gmail.js compiles OK'); }
catch(e) { console.log('  ERROR:', e.message); }

console.log('');
console.log('Done. Refresh browser.');
console.log('');
console.log('Admin & Supervisor:');
console.log('  • Emails stay in personal inbox');
console.log('  • "Push to Queue" button in email detail');
console.log('  • "Pull from Queue" button in ticket detail');
console.log('');
console.log('Coordinator:');
console.log('  • All emails auto-routed to queue');
console.log('  • Forwarded to archive, removed from inbox');
