const fs = require('fs');

// 1. Add bulk pull endpoint to server
let gmail = fs.readFileSync('server/routes/gmail.js', 'utf8');

if (!gmail.includes('/bulk-pull')) {
  gmail = gmail.replace(
    "// ── Filters ──",
    `// ── Bulk pull from queue (supervisor + admin) ──
router.post('/bulk-pull', requireAuth, async (req, res) => {
  if (req.user.role !== 'supervisor' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Supervisor or admin access required' });
  }
  const db = getDb();
  const { ticketIds } = req.body;
  if (!ticketIds || !ticketIds.length) return res.status(400).json({ error: 'ticketIds required' });

  const t = getTokens(req.user.id);
  let gm = null;
  if (t) gm = google.gmail({ version: 'v1', auth: authClient(t) });

  let pulled = 0;
  for (const ticketId of ticketIds) {
    const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
    if (!ticket) continue;

    // Restore emails to inbox in Gmail
    if (gm) {
      const msgs = db.prepare('SELECT gmail_message_id FROM messages WHERE ticket_id = ? AND gmail_message_id IS NOT NULL').all(ticketId);
      for (const m of msgs) {
        try { await gm.users.messages.modify({ userId: 'me', id: m.gmail_message_id, requestBody: { addLabelIds: ['INBOX'] } }); } catch(e) {}
      }
    }

    // Remove from queue
    db.prepare('DELETE FROM attachments WHERE ticket_id = ?').run(ticketId);
    db.prepare('DELETE FROM messages WHERE ticket_id = ?').run(ticketId);
    db.prepare('DELETE FROM ticket_tags WHERE ticket_id = ?').run(ticketId);
    db.prepare('DELETE FROM tickets WHERE id = ?').run(ticketId);
    pulled++;
  }

  saveDb();
  console.log('[Queue] Bulk pulled', pulled, 'tickets');
  res.json({ pulled });
});

// ── Bulk push to queue (supervisor + admin) ──
router.post('/bulk-push', requireAuth, async (req, res) => {
  if (req.user.role !== 'supervisor' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Supervisor or admin access required' });
  }
  const db = getDb();
  const { gmailMessageIds, regionId } = req.body;
  if (!gmailMessageIds || !gmailMessageIds.length) return res.status(400).json({ error: 'gmailMessageIds required' });

  const t = getTokens(req.user.id);
  if (!t) return res.status(400).json({ error: 'Not connected' });
  const gm = google.gmail({ version: 'v1', auth: authClient(t) });
  const regions = db.prepare('SELECT region_id FROM user_regions WHERE user_id=?').all(req.user.id);
  const rid = regionId || (regions.length ? toStr(regions[0].region_id) : 'r1');
  const archiveRow = db.prepare("SELECT value FROM settings WHERE key='archive_email'").get();
  const archiveAddr = archiveRow ? toStr(archiveRow.value) : 'thinkprompted@gmail.com';

  let pushed = 0;
  for (const gmailMessageId of gmailMessageIds) {
    if (db.prepare('SELECT 1 FROM messages WHERE gmail_message_id=?').get(gmailMessageId)) continue;

    try {
      const msg = await gm.users.messages.get({ userId: 'me', id: gmailMessageId, format: 'full' });
      const h = msg.data.payload.headers;
      const from = hdr(h, 'From'), subj = hdr(h, 'Subject') || '(no subject)';
      const bd = body(msg.data.payload), thId = msg.data.threadId;
      const ts = parseInt(msg.data.internalDate) || Date.now();

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
      }

      // Forward to archive
      try {
        const fwd = ['From: ' + toStr(t.email), 'To: ' + archiveAddr, 'Subject: Fwd: ' + subj,
          'Content-Type: text/plain; charset=utf-8', 'MIME-Version: 1.0', '',
          '---------- Forwarded message ----------', 'From: ' + from,
          'Date: ' + hdr(h, 'Date'), 'Subject: ' + subj, '', bd || subj];
        const raw = Buffer.from(fwd.join(String.fromCharCode(13,10))).toString('base64url');
        await gm.users.messages.send({ userId: 'me', requestBody: { raw } });
      } catch(e) {}

      // Hide from Gmail
      try {
        const hiddenLabelId = typeof getOrCreateLabel === 'function' ? await getOrCreateLabel(gm, 'CareCoord/Archived') : null;
        const modReq = { removeLabelIds: ['INBOX', 'UNREAD', 'SENT', 'CATEGORY_PERSONAL', 'CATEGORY_SOCIAL', 'CATEGORY_UPDATES', 'CATEGORY_FORUMS', 'CATEGORY_PROMOTIONS'] };
        if (hiddenLabelId) modReq.addLabelIds = [hiddenLabelId];
        await gm.users.messages.modify({ userId: 'me', id: gmailMessageId, requestBody: modReq });
      } catch(e) {}

      pushed++;
    } catch(e) { console.log('[BulkPush] Error:', e.message); }
  }

  saveDb();
  console.log('[Queue] Bulk pushed', pushed, 'emails');
  res.json({ pushed });
});

// ── Filters ──`
  );
  fs.writeFileSync('server/routes/gmail.js', gmail, 'utf8');
  console.log('  ✓ gmail.js — bulk-pull and bulk-push endpoints');
}

// 2. Update api.js
let api = fs.readFileSync('client/src/api.js', 'utf8');
if (!api.includes('bulkPushToQueue')) {
  api = api.replace(
    "pushToQueue:",
    "bulkPushToQueue: (gmailMessageIds, regionId) => request('/gmail/bulk-push', { method: 'POST', body: { gmailMessageIds, regionId } }),\n  bulkPullFromQueue: (ticketIds) => request('/gmail/bulk-pull', { method: 'POST', body: { ticketIds } }),\n  pushToQueue:"
  );
  fs.writeFileSync('client/src/api.js', api, 'utf8');
  console.log('  ✓ api.js — bulk methods added');
}

// 3. Update PersonalInbox to use bulk endpoint
let inbox = fs.readFileSync('client/src/components/PersonalInbox.jsx', 'utf8');
inbox = inbox.replace(
  `const bulkPushToQueue = async () => {
    if (checkedIds.size === 0) return;
    const ids = Array.from(checkedIds);
    let pushed = 0, failed = 0;
    for (const id of ids) {
      try {
        await api.pushToQueue(id);
        pushed++;
      } catch(e) { failed++; }
    }
    showToast?.((pushed ? pushed + ' pushed to queue' : '') + (failed ? (pushed ? ', ' : '') + failed + ' failed' : ''));
    setMessages(prev => prev.filter(m => !checkedIds.has(m.id)));
    setCheckedIds(new Set());
  };`,
  `const bulkPushToQueue = async () => {
    if (checkedIds.size === 0) return;
    try {
      const d = await api.bulkPushToQueue(Array.from(checkedIds));
      showToast?.(d.pushed + ' pushed to queue');
      setMessages(prev => prev.filter(m => !checkedIds.has(m.id)));
      setCheckedIds(new Set());
    } catch(e) { showToast?.(e.message || 'Failed'); }
  };`
);
fs.writeFileSync('client/src/components/PersonalInbox.jsx', inbox, 'utf8');
console.log('  ✓ PersonalInbox — uses bulk push endpoint');

// 4. Update QueueScreen to use bulk endpoint
let queue = fs.readFileSync('client/src/components/QueueScreen.jsx', 'utf8');
queue = queue.replace(
  `const bulkPullFromQueue = async () => {
    if (selectedTicketIds.size === 0) return;
    let pulled = 0;
    for (const tid of selectedTicketIds) {
      try { await api.pullFromQueue(tid); pulled++; } catch(e) {}
    }
    setSelectedTicketIds(new Set());
    fetchTickets();
  };`,
  `const bulkPullFromQueue = async () => {
    if (selectedTicketIds.size === 0) return;
    try {
      const d = await api.bulkPullFromQueue(Array.from(selectedTicketIds));
      showToast?.(d.pulled + ' pulled from queue');
    } catch(e) {}
    setSelectedTicketIds(new Set());
    fetchTickets();
  };`
);

// QueueScreen needs showToast prop
if (!queue.includes('showToast')) {
  queue = queue.replace(
    'export default function QueueScreen({ title, mode, currentUser, regions, onOpenTicket }) {',
    'export default function QueueScreen({ title, mode, currentUser, regions, onOpenTicket, showToast }) {'
  );
}

fs.writeFileSync('client/src/components/QueueScreen.jsx', queue, 'utf8');
console.log('  ✓ QueueScreen — uses bulk pull endpoint');

// 5. Pass showToast to QueueScreen in App.jsx
let app = fs.readFileSync('client/src/App.jsx', 'utf8');
if (!app.includes('QueueScreen') || !app.match(/QueueScreen[^/]*showToast/)) {
  app = app.replace(
    '<QueueScreen title="Region Queue" mode="region" currentUser={currentUser} regions={regions} onOpenTicket={openTicket} />',
    '<QueueScreen title="Region Queue" mode="region" currentUser={currentUser} regions={regions} onOpenTicket={openTicket} showToast={showToast} />'
  );
  app = app.replace(
    '<QueueScreen title="My Queue" mode="personal" currentUser={currentUser} regions={regions} onOpenTicket={openTicket} />',
    '<QueueScreen title="My Queue" mode="personal" currentUser={currentUser} regions={regions} onOpenTicket={openTicket} showToast={showToast} />'
  );
  fs.writeFileSync('client/src/App.jsx', app, 'utf8');
  console.log('  ✓ App.jsx — showToast passed to QueueScreen');
}

try { require('./server/routes/gmail'); console.log('  ✓ gmail.js compiles OK'); }
catch(e) { console.log('  ERROR:', e.message); }

console.log('');
console.log('Done. Refresh browser.');
console.log('  Bulk push: single API call, all emails at once');
console.log('  Bulk pull: single API call, all tickets at once');
