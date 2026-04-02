const fs = require('fs');
const express = require('express');
const { google } = require('googleapis');
const { getDb, saveDb } = require('../database');
const { requireAuth, toStr } = require('../middleware');
const router = express.Router();

function generateTicketId(db, regionId) {
  const region = regionId ? db.prepare('SELECT name FROM regions WHERE id = ?').get(regionId) : null;
  const regionName = region ? toStr(region.name) : 'GEN';
  const abbr = regionName.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 3);
  const last = db.prepare("SELECT id FROM tickets WHERE id LIKE ? ORDER BY id DESC LIMIT 1").get(abbr + '-%');
  let num = 1;
  if (last) {
    const match = toStr(last.id).match(/-(\d+)$/);
    if (match) num = parseInt(match[1]) + 1;
  }
  return abbr + '-' + String(num).padStart(4, '0');
}

function oauth2() { return new google.auth.OAuth2(process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET, process.env.GMAIL_REDIRECT_URI); }
function authClient(t) { const c = oauth2(); c.setCredentials({ access_token: toStr(t.access_token), refresh_token: toStr(t.refresh_token), expiry_date: t.expiry_date }); return c; }
function getTokens(uid) { return getDb().prepare('SELECT * FROM gmail_tokens WHERE user_id = ?').get(uid) || null; }
function putTokens(uid, t, email) {
  const db = getDb();
  if (db.prepare('SELECT id FROM gmail_tokens WHERE user_id = ?').get(uid))
    db.prepare('UPDATE gmail_tokens SET access_token=?, refresh_token=COALESCE(?,refresh_token), expiry_date=?, email=COALESCE(?,email) WHERE user_id=?').run(t.access_token, t.refresh_token||null, t.expiry_date||null, email||null, uid);
  else
    db.prepare('INSERT INTO gmail_tokens (id,user_id,access_token,refresh_token,expiry_date,email) VALUES (?,?,?,?,?,?)').run('gt-'+Date.now(), uid, t.access_token, t.refresh_token||null, t.expiry_date||null, email||null);
  saveDb();
}
// ── Service Account with Domain-Wide Delegation ──
let serviceAccountKey = null;
if (process.env.SA_CLIENT_EMAIL && process.env.SA_PRIVATE_KEY) {
  serviceAccountKey = { client_email: process.env.SA_CLIENT_EMAIL, private_key: process.env.SA_PRIVATE_KEY };
  console.log('[SA] Service account from env vars:', serviceAccountKey.client_email);
} else {
  try { serviceAccountKey = JSON.parse(fs.readFileSync(require('path').join(__dirname, '..', 'service-account.json'), 'utf8')); console.log('[SA] Service account from file:', serviceAccountKey.client_email); }
  catch(e) { console.log('[SA] No service account found'); }
}

function getServiceAuth(userEmail) {
  if (!serviceAccountKey) return null;
  const auth = new google.auth.JWT({
    email: serviceAccountKey.client_email,
    key: serviceAccountKey.private_key,
    scopes: ['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.send','https://www.googleapis.com/auth/gmail.modify','https://www.googleapis.com/auth/userinfo.email','https://www.googleapis.com/auth/calendar','https://www.googleapis.com/auth/drive.readonly'],
    subject: userEmail,
  });
  return auth;
}

// Get auth for a user — tries service account first, falls back to OAuth tokens
function getAuthForUser(userId) {
  const db = getDb();
  const user = db.prepare('SELECT email FROM users WHERE id = ?').get(userId);
  if (!user) return null;
  const email = toStr(user.email);
  
  // Try service account first
  const sa = getServiceAuth(email);
  if (sa) return { auth: sa, email };
  
  // Fall back to OAuth tokens
  const t = getTokens(userId);
  if (t) return { auth: authClient(t), email: toStr(t.email) };
  
  return null;
}

function hdr(h, n) { const x = (h||[]).find(x => x.name.toLowerCase() === n.toLowerCase()); return x ? x.value : ''; }
function body(payload) { let t='',h=''; (function w(p){ if(p.body&&p.body.data){ const d=Buffer.from(p.body.data,'base64').toString(); if(p.mimeType==='text/plain'&&!t)t=d; if(p.mimeType==='text/html')h=d; } if(p.parts)p.parts.forEach(w); })(payload); return h||t; }

// ── Hidden label for archived coordinator emails ──
const labelCache = {};
async function getOrCreateLabel(gm, name) {
  if (labelCache[name]) return labelCache[name];
  try {
    const list = await gm.users.labels.list({ userId: 'me' });
    const existing = (list.data.labels || []).find(l => l.name === name);
    if (existing) { labelCache[name] = existing.id; return existing.id; }
    const created = await gm.users.labels.create({ userId: 'me', requestBody: {
      name, labelListVisibility: 'labelHide', messageListVisibility: 'hide'
    }});
    labelCache[name] = created.data.id;
    return created.data.id;
  } catch(e) { console.log('[Label] Error:', e.message); return null; }
}

// ── OAuth ──
router.get('/auth', requireAuth, (req, res) => {
  res.json({ authUrl: oauth2().generateAuthUrl({ access_type:'offline', prompt:'consent', state:req.user.id,
    scope:['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.send','https://www.googleapis.com/auth/gmail.modify','https://www.googleapis.com/auth/userinfo.email','https://www.googleapis.com/auth/calendar','https://www.googleapis.com/auth/drive.readonly'] }) });
});
router.get('/callback', async (req, res) => {
  try {
    const c = oauth2(); const { tokens: t } = await c.getToken(req.query.code); c.setCredentials(t);
    const userInfo = (await google.oauth2({version:'v2',auth:c}).userinfo.get()).data;
    const email = userInfo.email;
    putTokens(req.query.state, t, email);
    // Save Google profile photo
    if (userInfo.picture) {
      const db = getDb();
      db.prepare('UPDATE users SET profile_photo_url = ? WHERE id = ?').run(userInfo.picture, req.query.state);
      saveDb();
      console.log('[Workspace] Saved profile photo for', email);
    }
    console.log('[Workspace] Connected:', email);
    res.send('<html><body><h2>Google Workspace Connected!</h2><script>window.close()</script></body></html>');
  } catch(e) { res.status(500).send('<h2>Failed</h2><p>'+e.message+'</p>'); }
});
// ── Admin connects workspace for another user ──
router.get('/admin-auth/:userId', requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const targetUserId = req.params.userId;
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(targetUserId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ authUrl: oauth2().generateAuthUrl({ access_type:'offline', prompt:'consent', state: targetUserId,
    scope:['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.send','https://www.googleapis.com/auth/gmail.modify','https://www.googleapis.com/auth/userinfo.email','https://www.googleapis.com/auth/calendar','https://www.googleapis.com/auth/drive.readonly'] }) });
});

// ── Admin checks workspace status for any user ──
router.get('/admin-status/:userId', requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const t = getTokens(req.params.userId);
  const user = getDb().prepare('SELECT email FROM users WHERE id = ?').get(req.params.userId);
  const hasOAuth = !!(t && t.access_token);
  const hasSA = !!serviceAccountKey;
  const email = hasOAuth ? toStr(t.email) : (user ? toStr(user.email) : null);
  res.json({ connected: hasOAuth || hasSA, email, method: hasOAuth ? 'oauth' : hasSA ? 'service-account' : 'none' });
});

// ── Admin disconnects workspace for any user ──
router.post('/admin-disconnect/:userId', requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  getDb().prepare('DELETE FROM gmail_tokens WHERE user_id=?').run(req.params.userId); saveDb();
  res.json({ ok: true });
});

// ── Sync profile photos for all connected users ──
router.post('/sync-photos', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const db = getDb();
  const users = db.prepare('SELECT id, email FROM users WHERE is_active = 1').all();
  let updated = 0;
  for (const u of users) {
    try {
      const email = toStr(u.email);
      // Try service account first
      const sa = getServiceAuth(email);
      if (sa) {
        const info = await google.people({version:'v1', auth: sa}).people.get({ resourceName: 'people/me', personFields: 'photos' });
        const photo = (info.data.photos || []).find(p => p.metadata?.primary);
        if (photo?.url) { db.prepare('UPDATE users SET profile_photo_url = ? WHERE id = ?').run(photo.url, u.id); updated++; continue; }
      }
      // Try OAuth tokens
      const t = getTokens(toStr(u.id));
      if (t) {
        const c = authClient(t);
        const userInfo = (await google.oauth2({version:'v2', auth: c}).userinfo.get()).data;
        if (userInfo.picture) { db.prepare('UPDATE users SET profile_photo_url = ? WHERE id = ?').run(userInfo.picture, u.id); updated++; }
      }
    } catch(e) { console.log('[Photo] Failed for', toStr(u.email), e.message); }
  }
  saveDb();
  res.json({ updated, total: users.length });
});

router.get('/status', requireAuth, (req, res) => {
  const t = getTokens(req.user.id);
  const hasOAuth = !!(t && t.access_token);
  const hasSA = !!serviceAccountKey;
  const email = hasOAuth ? toStr(t.email) : req.user.email;
  res.json({ connected: hasOAuth || hasSA, email });
});
router.post('/disconnect', requireAuth, (req, res) => {
  getDb().prepare('DELETE FROM gmail_tokens WHERE user_id=?').run(req.user.id); saveDb(); res.json({ ok: true });
});

// ── Set sync start date (supervisor only) ──
router.post('/set-sync-date', requireAuth, (req, res) => {
  if (req.user.role !== 'supervisor' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Supervisor access required' });
  }
  const { syncDate, resetSync } = req.body;
  if (!syncDate) return res.status(400).json({ error: 'syncDate required' });
  
  const db = getDb();
  
  // Convert sync date to timestamp for comparison
  const newCutoff = new Date(syncDate.replace(/\//g, '-') + 'T00:00:00').getTime();
  
  // Get the old sync date to determine if we're moving forward
  const existing = db.prepare('SELECT * FROM email_sync_state WHERE user_id=?').get(req.user.id);
  const oldDate = existing ? toStr(existing.sync_start_date) : null;
  const oldCutoff = oldDate ? new Date(oldDate.replace(/\//g, '-') + 'T00:00:00').getTime() : 0;
  
  // If moving the date FORWARD, delete tickets/messages that fall before the new date
  // These emails will now show in personal inbox since the cutoff moved
  if (newCutoff > oldCutoff) {
    // Find all synced tickets created between old and new cutoff dates
    const oldTickets = db.prepare(
      "SELECT t.id FROM tickets t WHERE t.created_at >= ? AND t.created_at < ? AND t.id LIKE 'tk-%-%'"
    ).all(oldCutoff, newCutoff);
    
    let removed = 0;
    for (const t of oldTickets) {
      // Delete messages and attachments for this ticket
      db.prepare('DELETE FROM attachments WHERE ticket_id = ?').run(t.id);
      db.prepare('DELETE FROM messages WHERE ticket_id = ?').run(t.id);
      db.prepare('DELETE FROM ticket_tags WHERE ticket_id = ?').run(t.id);
      db.prepare('DELETE FROM tickets WHERE id = ?').run(t.id);
      removed++;
    }
    if (removed) console.log('[Sync] Removed', removed, 'tickets before new cutoff', syncDate);
  }
  
  // If moving the date BACKWARD, we need to re-sync the gap
  // Setting last_sync_at to 0 forces a full re-scan
  
  // Update the sync state
  if (existing) {
    db.prepare('UPDATE email_sync_state SET sync_start_date=?, last_sync_at=0 WHERE user_id=?').run(syncDate, req.user.id);
  } else {
    db.prepare('INSERT INTO email_sync_state (user_id, last_sync_at, sync_start_date) VALUES (?, 0, ?)').run(req.user.id, syncDate);
  }
  saveDb();
  console.log('[Sync] Start date changed from', oldDate || 'none', 'to', syncDate, 'for user', req.user.id);
  res.json({ ok: true, syncDate });
});

// ── Sync into regional queue ──
router.post('/sync', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const db = getDb(); let total = 0;
    // Sync users with OAuth tokens
    for (const a of db.prepare('SELECT * FROM gmail_tokens WHERE access_token IS NOT NULL').all()) {
      try { total += await syncUser(db, a); } catch(e) { console.error('[Sync]', toStr(a.email), e.message); }
    }
    // Also sync users connected via service account (no OAuth tokens needed)
    if (serviceAccountKey) {
      const allUsers = db.prepare("SELECT id, email FROM users WHERE is_active = 1").all();
      for (const u of allUsers) {
        const uid = toStr(u.id);
        // Skip if already synced via OAuth token
        if (db.prepare('SELECT 1 FROM gmail_tokens WHERE user_id = ? AND access_token IS NOT NULL').get(uid)) continue;
        try { total += await syncUser(db, { user_id: uid, email: toStr(u.email) }); } catch(e) { console.error('[Sync SA]', toStr(u.email), e.message); }
      }
    }
    res.json({ synced: total });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
let lastSyncTime = 0;
const inboxCache = new Map();
function getCached(key) { const c = inboxCache.get(key); if (c && Date.now() - c.ts < 15000) return c.data; return null; }
function setCache(key, data) { inboxCache.set(key, { data, ts: Date.now() }); if (inboxCache.size > 50) { const first = inboxCache.keys().next().value; inboxCache.delete(first); } }
router.get('/auto-sync', requireAuth, async (req, res) => {
  if (Date.now() - lastSyncTime < 15000) return res.json({ synced: 0, cached: true });
  lastSyncTime = Date.now();
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
  try {
    const db = getDb();
    const st = db.prepare('SELECT last_sync_at FROM email_sync_state WHERE user_id=?').get(req.user.id);
    // No stale check — always sync
    let total = 0;
    for (const a of db.prepare('SELECT * FROM gmail_tokens WHERE access_token IS NOT NULL').all()) {
      try { total += await syncUser(db, a); } catch(e) {}
    }
    // Service account users
    if (serviceAccountKey) {
      const allUsers = db.prepare("SELECT id, email FROM users WHERE is_active = 1").all();
      for (const u of allUsers) {
        const uid = toStr(u.id);
        if (db.prepare('SELECT 1 FROM gmail_tokens WHERE user_id = ? AND access_token IS NOT NULL').get(uid)) continue;
        try { total += await syncUser(db, { user_id: uid, email: toStr(u.email) }); } catch(e) {}
      }
    }
    res.json({ synced: total });
  } catch(e) { res.json({ synced: 0 }); }
});

async function syncUser(db, row) {
  const uid = toStr(row.user_id);
  // Try service account first, fall back to OAuth tokens
  const userAuth = getAuthForUser(uid);
  if (!userAuth) { 
    // Last resort: use OAuth token directly
    if (!row.access_token) return 0;
  }
  const auth = userAuth ? userAuth.auth : authClient(row);
  const gm = google.gmail({version:'v1',auth});

  // Role-based routing: admin and supervisor skip sync entirely
  // Also skip inactive users
  const userRow = db.prepare('SELECT role, is_active, work_status FROM users WHERE id = ?').get(uid);
  const role = userRow ? toStr(userRow.role) : 'coordinator';
  if (role === 'admin' || role === 'supervisor') return 0;
  if (userRow && (!userRow.is_active || toStr(userRow.work_status) === 'inactive')) return 0;

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
  const defaultRid = toStr(regions[0].region_id);
  const archiveEmail = db.prepare("SELECT value FROM settings WHERE key='archive_email'").get();
  const archiveAddr = archiveEmail ? toStr(archiveEmail.value) : 'thinkprompted@gmail.com';

  // Build alias-to-region map for routing by To address
  const allRegions = db.prepare("SELECT id, routing_aliases FROM regions WHERE is_active = 1").all();
  const aliasMap = {};
  for (const r of allRegions) {
    const aliases = JSON.parse(toStr(r.routing_aliases) || '[]');
    for (const a of aliases) aliasMap[a.toLowerCase()] = toStr(r.id);
  }

  // Load exception list — these senders/domains SKIP the queue, stay in personal inbox
  const exceptions = db.prepare("SELECT * FROM email_filters WHERE action='exception'").all();

  let n = 0, pageToken = null, scanned = 0;

  do {
    const params = { userId: 'me', q: '{in:inbox label:CareCoord-Archived} -from:me after:' + startDate, maxResults: 500 };
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
      const rfcMessageId = hdr(h, 'Message-ID') || hdr(h, 'Message-Id') || '';
      const toAddr = hdr(h, 'To') || '';
      const ccAddr = hdr(h, 'Cc') || '';
      const allRecipients = (toAddr + ',' + ccAddr).toLowerCase();

      // Route to region by matching To/Cc against region aliases
      let rid = defaultRid;
      for (const [alias, regionId] of Object.entries(aliasMap)) {
        if (allRecipients.includes(alias)) { rid = regionId; break; }
      }

      // Check exception list — if sender matches, skip queue (stays in personal inbox)
      let isException = false;
      for (const ex of exceptions) {
        const domain = toStr(ex.domain), sender = toStr(ex.sender), subjMatch = toStr(ex.subject_contains);
        if (domain && from.toLowerCase().includes(domain.toLowerCase())) { isException = true; break; }
        if (sender && from.toLowerCase().includes(sender.toLowerCase())) { isException = true; break; }
        if (subjMatch && subj.toLowerCase().includes(subjMatch.toLowerCase())) { isException = true; break; }
      }
      if (isException) continue;

      // ── Route to Regional Queue (with multi-recipient dedup via Message-ID) ──

      // Check if this exact email (by RFC Message-ID) already created a ticket
      // Message-ID is identical across all recipients, unlike gmail thread/message IDs
      let existingTicketId = null;
      if (rfcMessageId) {
        const existingByMsgId = db.prepare("SELECT ticket_id FROM messages WHERE provider_message_id = ? LIMIT 1").get(rfcMessageId);
        if (existingByMsgId) existingTicketId = toStr(existingByMsgId.ticket_id);
      }
      // Check by gmail thread ID for replies within same account
      if (!existingTicketId) {
        const existingByThread = db.prepare('SELECT ticket_id FROM messages WHERE gmail_thread_id = ? LIMIT 1').get(thId);
        if (existingByThread && db.prepare('SELECT id FROM tickets WHERE id = ?').get(existingByThread.ticket_id)) {
          existingTicketId = toStr(existingByThread.ticket_id);
        }
      }
      // Check by In-Reply-To header — matches against our stored gmail_message_id or provider_message_id
      if (!existingTicketId) {
        const inReplyTo = (hdr(h, 'In-Reply-To') || '').replace(/[<>]/g, '').trim();
        if (inReplyTo) {
          const byInReplyTo = db.prepare("SELECT ticket_id FROM messages WHERE gmail_message_id = ? OR provider_message_id = ? LIMIT 1").get(inReplyTo, inReplyTo);
          if (byInReplyTo && db.prepare('SELECT id FROM tickets WHERE id = ?').get(byInReplyTo.ticket_id)) {
            existingTicketId = toStr(byInReplyTo.ticket_id);
          }
        }
      }
      // Check References header for any known message ID
      if (!existingTicketId) {
        const refs = (hdr(h, 'References') || '').split(/\s+/).map(r => r.replace(/[<>]/g, '').trim()).filter(Boolean);
        for (const ref of refs) {
          const byRef = db.prepare("SELECT ticket_id FROM messages WHERE gmail_message_id = ? OR provider_message_id = ? LIMIT 1").get(ref, ref);
          if (byRef && db.prepare('SELECT id FROM tickets WHERE id = ?').get(byRef.ticket_id)) {
            existingTicketId = toStr(byRef.ticket_id);
            break;
          }
        }
      }

      if (existingTicketId) {
        // Find this user's ticket: check assignee, synced_for, or any ticket with matching thread
        let myTicketId = null;
        // 1. Check if user owns the existing ticket (assigned or synced_for)
        const existTicket = db.prepare('SELECT id, assignee_user_id, synced_for_user_id FROM tickets WHERE id = ?').get(existingTicketId);
        if (existTicket && (toStr(existTicket.assignee_user_id) === uid || toStr(existTicket.synced_for_user_id) === uid)) {
          myTicketId = existingTicketId;
        }
        // 2. Check if user has a different ticket linked to this thread
        if (!myTicketId) {
          const myOther = db.prepare("SELECT id FROM tickets WHERE (assignee_user_id = ? OR synced_for_user_id = ?) AND id IN (SELECT ticket_id FROM messages WHERE gmail_thread_id = ?)").get(uid, uid, thId);
          if (myOther) myTicketId = toStr(myOther.id);
        }
        // 3. Check linked tickets
        if (!myTicketId && existTicket) {
          const linked = JSON.parse(toStr(existTicket.linked_ticket_ids) || '[]');
          for (const lid of linked) {
            const lt = db.prepare('SELECT id, assignee_user_id, synced_for_user_id FROM tickets WHERE id = ?').get(lid);
            if (lt && (toStr(lt.assignee_user_id) === uid || toStr(lt.synced_for_user_id) === uid)) {
              myTicketId = toStr(lt.id);
              break;
            }
          }
        }

        if (myTicketId) {
          // Add reply to existing ticket thread
          const alreadyRecorded = rfcMessageId ? db.prepare("SELECT 1 FROM messages WHERE ticket_id = ? AND provider_message_id = ?").get(myTicketId, rfcMessageId) : null;
          if (!alreadyRecorded) {
            const msgId = 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
            db.prepare('INSERT OR IGNORE INTO messages (id,ticket_id,direction,channel,from_address,to_addresses,sender,subject,body_text,sent_at,provider_message_id,in_reply_to,reference_ids,gmail_message_id,gmail_thread_id,gmail_user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
              .run(msgId, myTicketId, 'inbound', 'email', from, JSON.stringify([toStr(row.email)]), from, subj, bd || subj, ts, rfcMessageId || m.id, null, '[]', m.id, thId, uid, ts);
            // Reopen if closed, keep existing tags
            const currentTicket = db.prepare('SELECT status FROM tickets WHERE id = ?').get(myTicketId);
            const newStatus = currentTicket && toStr(currentTicket.status) === 'CLOSED' ? 'OPEN' : toStr(currentTicket?.status) || 'OPEN';
            db.prepare('UPDATE tickets SET last_activity_at=?, has_unread=1, status=? WHERE id=?').run(ts, newStatus === 'CLOSED' ? 'OPEN' : newStatus, myTicketId);
          }
        } else {
          // No ticket for this user yet — create a new one and link
          const tid = generateTicketId(db, rid);
          const userStatus = userRow ? toStr(userRow.work_status) : 'active';
          const assignTo = userStatus === 'active' ? uid : null;
          db.prepare('INSERT OR IGNORE INTO tickets (id,subject,from_email,region_id,status,assignee_user_id,created_at,last_activity_at,external_participants,has_unread,assigned_at,synced_for_user_id,synced_for_user_ids,linked_ticket_ids) VALUES (?,?,?,?,?,?,?,?,?,1,?,?,?,?)')
            .run(tid, subj, from, rid, 'OPEN', assignTo, ts, ts, JSON.stringify([from]), assignTo ? ts : null, uid, JSON.stringify([uid]), JSON.stringify([existingTicketId]));
          const msgId = 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
          db.prepare('INSERT OR IGNORE INTO messages (id,ticket_id,direction,channel,from_address,to_addresses,sender,subject,body_text,sent_at,provider_message_id,in_reply_to,reference_ids,gmail_message_id,gmail_thread_id,gmail_user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
            .run(msgId, tid, 'inbound', 'email', from, JSON.stringify([toStr(row.email)]), from, subj, bd || subj, ts, rfcMessageId || m.id, null, '[]', m.id, thId, uid, ts);
          // Link tickets bidirectionally
          const existingLinks = JSON.parse(toStr(db.prepare('SELECT linked_ticket_ids FROM tickets WHERE id = ?').get(existingTicketId)?.linked_ticket_ids) || '[]');
          if (!existingLinks.includes(tid)) {
            existingLinks.push(tid);
            db.prepare('UPDATE tickets SET linked_ticket_ids = ? WHERE id = ?').run(JSON.stringify(existingLinks), existingTicketId);
          }
          const allLinked = [...existingLinks.filter(id => id !== tid), existingTicketId];
          db.prepare('UPDATE tickets SET linked_ticket_ids = ? WHERE id = ?').run(JSON.stringify(allLinked), tid);
          console.log('[Sync] Multi-recipient — created', tid, 'for', uid, 'linked to', existingTicketId);
        }
      } else {
        // Brand new email — routing depends on user's work status
        const userStatus = userRow ? toStr(userRow.work_status) : 'active';
        const isActive = userStatus === 'active';
        const isBusy = userStatus === 'busy';
        // Active: auto-assign directly to user's queue
        // Busy: goes to unassigned with no intended recipient tag
        // Otherwise: goes to unassigned tagged for the user
        const assignTo = isActive ? uid : null;
        const syncForUid = isBusy ? null : uid;
        const syncForIds = isBusy ? '[]' : JSON.stringify([uid]);
        const assignedAt = isActive ? ts : null;
        const tid = generateTicketId(db, rid);
        db.prepare('INSERT OR IGNORE INTO tickets (id,subject,from_email,region_id,status,assignee_user_id,created_at,last_activity_at,external_participants,has_unread,assigned_at,synced_for_user_id,synced_for_user_ids) VALUES (?,?,?,?,?,?,?,?,?,1,?,?,?)')
          .run(tid, subj, from, rid, 'OPEN', assignTo, ts, ts, JSON.stringify([from]), assignedAt, syncForUid, syncForIds);
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
      }

      // ── Hide from coordinator's Gmail completely ──
      // No forwarding — CareCoord IS the archive. Just hide the original.
      try {
        const hiddenLabelId = await getOrCreateLabel(gm, 'CareCoord/Archived');
        const modifyReq = { removeLabelIds: ['INBOX', 'UNREAD'] };
        if (hiddenLabelId) modifyReq.addLabelIds = [hiddenLabelId];
        await gm.users.messages.modify({ userId: 'me', id: m.id, requestBody: modifyReq });
      } catch(archErr) { console.log('[Sync] Hide failed:', archErr.message); }

      n++;
      if (n % 50 === 0) { saveDb(); console.log('[Sync]', toStr(row.email), n, 'processed (' + scanned + ' scanned)...'); }
    }

    pageToken = list.data.nextPageToken || null;
  } while (pageToken);

  db.prepare('UPDATE email_sync_state SET last_sync_at=? WHERE user_id=?').run(Date.now(), uid);
  saveDb();
  if (n || scanned > 0) console.log('[Sync]', toStr(row.email), n, 'new (' + scanned + ' scanned)');
  return n;
}

// ── Personal inbox (full Gmail mirror) ──
router.get('/personal', requireAuth, async (req, res) => {
  try {
    const userAuth = getAuthForUser(req.user.id);
    const t = getTokens(req.user.id);
    if (!userAuth && !t) return res.json({ messages: [] });
    const gm = google.gmail({version:'v1', auth: userAuth ? userAuth.auth : authClient(t)});
    
    const folderMap = {
      INBOX: 'in:inbox', SENT: 'in:sent', DRAFT: 'in:drafts', STARRED: 'is:starred',
      SPAM: 'in:spam', TRASH: 'in:trash', IMPORTANT: 'is:important', ALL: '',
      SCHEDULED: 'in:scheduled',
      CATEGORY_SOCIAL: 'category:social', CATEGORY_UPDATES: 'category:updates',
      CATEGORY_FORUMS: 'category:forums', CATEGORY_PROMOTIONS: 'category:promotions',
    };
    let q = folderMap[req.query.folder || 'INBOX'];
    if (q === undefined) q = 'in:inbox';
    if (req.query.q) q += ' ' + req.query.q;
    
    const max = Math.min(parseInt(req.query.max) || 50, 50);
    const pt = req.query.pageToken || '';
    const cacheKey = req.user.id + ':' + q + ':' + (req.query.labelId || '') + ':' + max + ':' + pt;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);
    // Only apply cutoff for coordinators — admin/supervisor see full inbox
    if (req.user.role === 'coordinator') {
      const syncState = getDb().prepare('SELECT sync_start_date FROM email_sync_state WHERE user_id=?').get(req.user.id);
      const cutoffDate = syncState?.sync_start_date || '2026/03/01';
      q = q ? q + ' before:' + cutoffDate : 'before:' + cutoffDate;
    }
    const listParams = { userId: 'me', q, maxResults: max };
    // Support filtering by label ID directly for reliable label-based views
    if (req.query.labelId) listParams.labelIds = [req.query.labelId];
    if (req.query.pageToken) listParams.pageToken = req.query.pageToken;
    const list = await gm.users.messages.list(listParams);
    if (!list.data.messages) return res.json({ messages: [] });
    
    // Fetch all in parallel but use METADATA format (lighter than FULL)
    const results = await Promise.allSettled(
      list.data.messages.slice(0, max).map(m =>
        gm.users.messages.get({ userId: 'me', id: m.id, format: 'METADATA', metadataHeaders: ['From','To','Subject','Date'] })
      )
    );
    
    const msgs = [];
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      const msg = r.value.data;
      const h = msg.payload?.headers || [];
      msgs.push({
        id: msg.id, threadId: msg.threadId, snippet: msg.snippet || '',
        from: hdr(h,'From'), to: hdr(h,'To'),
        subject: hdr(h,'Subject') || '(no subject)',
        date: hdr(h,'Date'),
        labels: msg.labelIds || [],
        isUnread: (msg.labelIds || []).includes('UNREAD'),
        hasAttachment: (msg.payload?.parts || []).some(p => p.filename && p.filename.length > 0),
      });
    }
    const result = { messages: msgs, nextPageToken: list.data.nextPageToken || null, resultSizeEstimate: list.data.resultSizeEstimate || 0 }; setCache(cacheKey, result); res.json(result);
  } catch(e) { console.error('[Gmail]', e.message); res.status(500).json({ error: e.message }); }
});
router.get('/personal/:id', requireAuth, async (req, res) => {
  try {
    const userAuth = getAuthForUser(req.user.id);
    const t = getTokens(req.user.id);
    if (!userAuth && !t) return res.status(400).json({ error: 'Not connected' });
    const gmail = google.gmail({version:'v1', auth: userAuth ? userAuth.auth : authClient(t)});
    const msg = await gmail.users.messages.get({userId:'me',id:req.params.id,format:'full'});
    const h = msg.data.payload.headers;
    if ((msg.data.labelIds||[]).includes('UNREAD')) await gmail.users.messages.modify({userId:'me',id:req.params.id,requestBody:{removeLabelIds:['UNREAD']}});
    // Extract attachment info
    const attachments = [];
    function findAtts(parts) {
      if (!parts) return;
      for (const p of parts) {
        if (p.filename && p.filename.length > 0 && p.body) {
          attachments.push({ filename: p.filename, mimeType: p.mimeType || 'application/octet-stream', size: p.body.size || 0, attachmentId: p.body.attachmentId });
        }
        if (p.parts) findAtts(p.parts);
      }
    }
    findAtts(msg.data.payload.parts);
    // Generate download URLs
    attachments.forEach(a => { a.url = '/api/gmail/attachment/' + req.params.id + '/' + encodeURIComponent(a.attachmentId); });
    res.json({ id:msg.data.id, threadId:msg.data.threadId, from:hdr(h,'From'), to:hdr(h,'To'), cc:hdr(h,'Cc'), subject:hdr(h,'Subject'), date:hdr(h,'Date'), body:body(msg.data.payload), labels:msg.data.labelIds||[], attachments });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
router.post('/personal/send', requireAuth, async (req, res) => {
  try {
    const userAuth = getAuthForUser(req.user.id);
    const t = getTokens(req.user.id);
    if (!userAuth && !t) return res.status(400).json({ error: 'Not connected' });
    const gmail = google.gmail({version:'v1', auth: userAuth ? userAuth.auth : authClient(t)});
    const senderEmail = userAuth ? userAuth.email : toStr(t.email);
    const { to, cc, subject, body: b, threadId, attachments } = req.body;
    const CRLF = '\r\n';
    let raw;

    if (attachments && attachments.length > 0) {
      const boundary = 'boundary_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      const headers = ['From: ' + senderEmail, 'To: ' + to];
      if (cc) headers.push('Cc: ' + cc);
      headers.push('Subject: ' + (subject || ''), 'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="' + boundary + '"');
      let mime = headers.join(CRLF) + CRLF + CRLF;
      mime += '--' + boundary + CRLF + 'Content-Type: text/html; charset=utf-8' + CRLF + 'Content-Transfer-Encoding: 7bit' + CRLF + CRLF + b + CRLF + CRLF;
      for (const att of attachments) {
        mime += '--' + boundary + CRLF;
        mime += 'Content-Type: ' + (att.mimeType || 'application/octet-stream') + '; name="' + att.name + '"' + CRLF;
        mime += 'Content-Disposition: attachment; filename="' + att.name + '"' + CRLF;
        mime += 'Content-Transfer-Encoding: base64' + CRLF + CRLF;
        mime += att.data + CRLF + CRLF;
      }
      mime += '--' + boundary + '--' + CRLF;
      raw = Buffer.from(mime).toString('base64url');
    } else {
      const lines = ['From: ' + senderEmail, 'To: ' + to];
      if (cc) lines.push('Cc: ' + cc);
      lines.push('Subject: ' + (subject || ''), 'MIME-Version: 1.0', 'Content-Type: text/html; charset=utf-8', '', b);
      raw = Buffer.from(lines.join(CRLF)).toString('base64url');
    }

    const p = { userId: 'me', requestBody: { raw } };
    if (threadId) p.requestBody.threadId = threadId;
    const r = await gmail.users.messages.send(p);
    res.json({ id: r.data.id, threadId: r.data.threadId });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Contacts (People API) ──
const contactsCache = {}; // userId -> { data, ts }
const CONTACTS_TTL = 10 * 60 * 1000; // 10 min cache

// Get auth specifically for contacts — uses separate scope to avoid breaking main Gmail auth
function getContactsAuth(userId) {
  const db = getDb();
  const user = db.prepare('SELECT email FROM users WHERE id = ?').get(userId);
  if (!user) return null;
  const email = toStr(user.email);

  // Try service account with contacts scope
  if (serviceAccountKey) {
    try {
      const auth = new google.auth.JWT({
        email: serviceAccountKey.client_email,
        key: serviceAccountKey.private_key,
        scopes: ['https://www.googleapis.com/auth/contacts.readonly'],
        subject: email,
      });
      return auth;
    } catch(e) {}
  }

  // Fall back to OAuth tokens (if user granted contacts scope)
  const t = getTokens(userId);
  if (t) return authClient(t);
  return null;
}

router.get('/contacts', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    // Return cached if fresh
    if (contactsCache[userId] && (Date.now() - contactsCache[userId].ts) < CONTACTS_TTL) {
      return res.json({ contacts: contactsCache[userId].data });
    }

    const contacts = [];

    // Strategy 1: Try People API (works if contacts.readonly scope is delegated)
    try {
      const auth = getContactsAuth(userId);
      if (auth) {
        const people = google.people({ version: 'v1', auth });
        let nextPageToken = null;
        do {
          const resp = await people.people.connections.list({
            resourceName: 'people/me',
            pageSize: 1000,
            personFields: 'names,emailAddresses,photos,organizations',
            pageToken: nextPageToken || undefined,
          });
          for (const p of (resp.data.connections || [])) {
            const emails = (p.emailAddresses || []).map(e => e.value).filter(Boolean);
            if (emails.length === 0) continue;
            const name = p.names?.[0]?.displayName || '';
            const photo = p.photos?.[0]?.url || null;
            const org = p.organizations?.[0]?.name || '';
            for (const email of emails) {
              contacts.push({ name, email: email.toLowerCase(), photo, org });
            }
          }
          nextPageToken = resp.data.nextPageToken;
        } while (nextPageToken);

        // Also pull "Other Contacts"
        try {
          const otherResp = await people.otherContacts.list({ pageSize: 1000, readMask: 'names,emailAddresses' });
          for (const p of (otherResp.data.otherContacts || [])) {
            const emails = (p.emailAddresses || []).map(e => e.value).filter(Boolean);
            if (emails.length === 0) continue;
            const name = p.names?.[0]?.displayName || '';
            for (const email of emails) {
              if (!contacts.find(c => c.email === email.toLowerCase())) {
                contacts.push({ name, email: email.toLowerCase(), photo: null, org: '' });
              }
            }
          }
        } catch(e) { /* otherContacts may not be available */ }
      }
    } catch(e) {
      console.log('[Contacts] People API not available:', e.message);
    }

    // Strategy 2: If People API returned nothing, extract contacts from Gmail history
    if (contacts.length === 0) {
      const userAuth = getAuthForUser(userId);
      if (userAuth) {
        const gm = google.gmail({ version: 'v1', auth: userAuth.auth });
        const seen = new Set();

        // Parse "Name <email>" or plain "email" format (handles group addresses like region1@seniorityhealthcare.com)
        function parseAddresses(header) {
          if (!header) return [];
          const results = [];
          // Split on commas that are not inside quotes
          const parts = header.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
          for (const part of parts) {
            const trimmed = part.trim();
            // Handle "Name <email>" format
            const match = trimmed.match(/^"?(.+?)"?\s*<(.+@.+?)>$/);
            if (match) {
              results.push({ name: match[1].trim().replace(/^"|"$/g, ''), email: match[2].toLowerCase().trim() });
            } else if (trimmed.includes('@')) {
              // Handle bare email or group address (e.g. region1@seniorityhealthcare.com)
              const emailMatch = trimmed.match(/([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/);
              if (emailMatch) {
                results.push({ name: '', email: emailMatch[1].toLowerCase().trim() });
              }
            }
          }
          return results;
        }

        // Scan recent sent messages for recipient addresses
        try {
          const sentList = await gm.users.messages.list({ userId: 'me', q: 'in:sent', maxResults: 500 });
          if (sentList.data.messages) {
            const batched = await Promise.allSettled(
              sentList.data.messages.map(m =>
                gm.users.messages.get({ userId: 'me', id: m.id, format: 'METADATA', metadataHeaders: ['To', 'Cc', 'From'] })
              )
            );
            for (const r of batched) {
              if (r.status !== 'fulfilled') continue;
              const hdrs = r.value.data.payload?.headers || [];
              const toH = hdrs.find(h => h.name === 'To')?.value || '';
              const ccH = hdrs.find(h => h.name === 'Cc')?.value || '';
              for (const addr of [...parseAddresses(toH), ...parseAddresses(ccH)]) {
                if (!seen.has(addr.email) && !addr.email.includes('noreply') && !addr.email.includes('no-reply')) {
                  seen.add(addr.email);
                  contacts.push({ name: addr.name, email: addr.email, photo: null, org: '' });
                }
              }
            }
          }
        } catch(e) { console.log('[Contacts] Sent scan error:', e.message); }

        // Scan recent received messages for sender addresses
        try {
          const inboxList = await gm.users.messages.list({ userId: 'me', q: 'in:inbox', maxResults: 500 });
          if (inboxList.data.messages) {
            const batched = await Promise.allSettled(
              inboxList.data.messages.map(m =>
                gm.users.messages.get({ userId: 'me', id: m.id, format: 'METADATA', metadataHeaders: ['From'] })
              )
            );
            for (const r of batched) {
              if (r.status !== 'fulfilled') continue;
              const fromH = (r.value.data.payload?.headers || []).find(h => h.name === 'From')?.value || '';
              for (const addr of parseAddresses(fromH)) {
                if (!seen.has(addr.email) && !addr.email.includes('noreply') && !addr.email.includes('no-reply')) {
                  seen.add(addr.email);
                  contacts.push({ name: addr.name, email: addr.email, photo: null, org: '' });
                }
              }
            }
          }
        } catch(e) { console.log('[Contacts] Inbox scan error:', e.message); }

        // Scan starred, important, and primary category emails for broader coverage
        const broaderQueries = ['is:starred', 'is:important', 'category:primary'];
        for (const q of broaderQueries) {
          try {
            const list = await gm.users.messages.list({ userId: 'me', q, maxResults: 200 });
            if (list.data.messages) {
              const batched = await Promise.allSettled(
                list.data.messages.map(m =>
                  gm.users.messages.get({ userId: 'me', id: m.id, format: 'METADATA', metadataHeaders: ['From', 'To', 'Cc'] })
                )
              );
              for (const r of batched) {
                if (r.status !== 'fulfilled') continue;
                const hdrs = r.value.data.payload?.headers || [];
                const fromH = hdrs.find(h => h.name === 'From')?.value || '';
                const toH = hdrs.find(h => h.name === 'To')?.value || '';
                const ccH = hdrs.find(h => h.name === 'Cc')?.value || '';
                for (const addr of [...parseAddresses(fromH), ...parseAddresses(toH), ...parseAddresses(ccH)]) {
                  if (!seen.has(addr.email) && !addr.email.includes('noreply') && !addr.email.includes('no-reply')) {
                    seen.add(addr.email);
                    contacts.push({ name: addr.name, email: addr.email, photo: null, org: '' });
                  }
                }
              }
            }
          } catch(e) { console.log('[Contacts] Broader scan (' + q + ') error:', e.message); }
        }

        // Also include contacts from CareCoord tickets
        const db = getDb();
        const ticketContacts = db.prepare("SELECT DISTINCT from_email, external_participants FROM tickets WHERE from_email IS NOT NULL").all();
        for (const tc of ticketContacts) {
          const fe = toStr(tc.from_email);
          if (fe && !seen.has(fe.toLowerCase())) {
            const match = fe.match(/^"?(.+?)"?\s*<(.+@.+)>$/);
            const email = match ? match[2].toLowerCase() : fe.toLowerCase().replace(/[<>]/g, '');
            const name = match ? match[1] : '';
            if (email.includes('@') && !seen.has(email)) {
              seen.add(email);
              contacts.push({ name, email, photo: null, org: '' });
            }
          }
          try {
            const extP = JSON.parse(toStr(tc.external_participants) || '[]');
            for (const ep of extP) {
              const parsed = parseAddresses(ep);
              for (const addr of parsed) {
                if (!seen.has(addr.email)) { seen.add(addr.email); contacts.push({ name: addr.name, email: addr.email, photo: null, org: '' }); }
              }
            }
          } catch(e) {}
        }

        console.log('[Contacts] Extracted', contacts.length, 'contacts from Gmail history + tickets');
      }
    }

    // Deduplicate by email
    const seen = new Set();
    const deduped = contacts.filter(c => {
      if (!c.email || seen.has(c.email)) return false;
      seen.add(c.email);
      return true;
    }).sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));

    contactsCache[userId] = { data: deduped, ts: Date.now() };
    res.json({ contacts: deduped });
  } catch(e) {
    console.error('[Contacts]', e.message);
    res.json({ contacts: [] });
  }
});

// ── Gmail Labels ──
router.get('/labels', requireAuth, async (req, res) => {
  try {
    const userAuth = getAuthForUser(req.user.id);
    const t = getTokens(req.user.id);
    if (!userAuth && !t) return res.json({ labels: [] });
    const gm = google.gmail({version:'v1', auth: userAuth ? userAuth.auth : authClient(t)});
    const r = await gm.users.labels.list({ userId: 'me' });
    const labels = (r.data.labels || []).map(l => ({ id: l.id, name: l.name, type: l.type }));
    // Get counts and colors for ALL labels in batches of 15 to avoid rate limits
    const withCounts = [];
    for (let i = 0; i < labels.length; i += 15) {
      const batch = labels.slice(i, i + 15);
      const results = await Promise.all(batch.map(async l => {
        try {
          const detail = await gm.users.labels.get({ userId: 'me', id: l.id });
          return {
            ...l,
            unread: detail.data.messagesUnread || 0,
            total: detail.data.messagesTotal || 0,
            color: detail.data.color || null,
          };
        } catch(e) { return { ...l, unread: 0, total: 0, color: null }; }
      }));
      withCounts.push(...results);
    }
    res.json({ labels: withCounts });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Attachment download ──
router.get('/attachment/:msgId/:attId', requireAuth, async (req, res) => {
  try {
    const userAuth = getAuthForUser(req.user.id);
    const t = getTokens(req.user.id);
    if (!userAuth && !t) return res.status(400).json({ error: 'Not connected' });
    const gm = google.gmail({version:'v1', auth: userAuth ? userAuth.auth : authClient(t)});
    const att = await gm.users.messages.attachments.get({ userId: 'me', messageId: req.params.msgId, id: decodeURIComponent(req.params.attId) });
    const buf = Buffer.from(att.data.data, 'base64');
    res.set('Content-Type', 'application/octet-stream');
    res.set('Content-Disposition', 'attachment');
    res.send(buf);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Push email to queue (supervisor + admin) ──
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
  const userAuth = getAuthForUser(req.user.id);
  if (!userAuth) return res.status(400).json({ error: 'Not connected' });
  const userEmail = userAuth.email;
  try {
    const gm = google.gmail({ version: 'v1', auth: userAuth.auth });
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
        .run(msgId, ticketId, 'inbound', 'email', from, JSON.stringify([userEmail]), from, subj, bd || subj, ts, gmailMessageId, null, '[]', gmailMessageId, thId, req.user.id, ts);
      db.prepare('UPDATE tickets SET last_activity_at=?, has_unread=1, status=? WHERE id=?').run(ts, 'OPEN', ticketId);
    } else {
      ticketId = generateTicketId(db, rid);
      db.prepare('INSERT OR IGNORE INTO tickets (id,subject,from_email,region_id,status,created_at,last_activity_at,external_participants,has_unread) VALUES (?,?,?,?,?,?,?,?,1)')
        .run(ticketId, subj, from, rid, 'OPEN', ts, ts, JSON.stringify([from]));
      const msgId = 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
      db.prepare('INSERT OR IGNORE INTO messages (id,ticket_id,direction,channel,from_address,to_addresses,sender,subject,body_text,sent_at,provider_message_id,in_reply_to,reference_ids,gmail_message_id,gmail_thread_id,gmail_user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(msgId, ticketId, 'inbound', 'email', from, JSON.stringify([userEmail]), from, subj, bd || subj, ts, gmailMessageId, null, '[]', gmailMessageId, thId, req.user.id, ts);
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
      const fwd = ['From: ' + userEmail, 'To: ' + archiveAddr, 'Subject: Fwd: ' + subj,
        'Content-Type: text/plain; charset=utf-8', 'MIME-Version: 1.0', '',
        '---------- Forwarded message ----------', 'From: ' + from,
        'Date: ' + hdr(h, 'Date'), 'Subject: ' + subj, '', bd || subj];
      const raw = Buffer.from(fwd.join(String.fromCharCode(13,10))).toString('base64url');
      await gm.users.messages.send({ userId: 'me', requestBody: { raw } });
    } catch(e) { console.log('[Push] Forward failed:', e.message); }
    try {
      const hiddenLabelId = await getOrCreateLabel(gm, 'CareCoord/Archived');
      const modReq = { removeLabelIds: ['INBOX', 'UNREAD', 'CATEGORY_PERSONAL', 'CATEGORY_SOCIAL', 'CATEGORY_UPDATES', 'CATEGORY_FORUMS', 'CATEGORY_PROMOTIONS'] };
      if (hiddenLabelId) modReq.addLabelIds = [hiddenLabelId];
      await gm.users.messages.modify({ userId: 'me', id: gmailMessageId, requestBody: modReq });
    } catch(e) {}
    saveDb();
    console.log('[Queue] Pushed:', ticketId, '-', subj);
    res.json({ ticketId, subject: subj });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// destination: 'original' = back to original coordinator's inbox, 'me' = to current user's inbox
router.post('/pull-from-queue', requireAuth, async (req, res) => {
  if (req.user.role !== 'supervisor' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Supervisor or admin access required' });
  }
  const db = getDb();
  const { ticketId, destination } = req.body;
  if (!ticketId) return res.status(400).json({ error: 'ticketId required' });
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

  const msgs = db.prepare('SELECT gmail_message_id, gmail_user_id, from_address, subject, body_text FROM messages WHERE ticket_id = ? AND gmail_message_id IS NOT NULL').all(ticketId);

  if (destination === 'me') {
    // Forward the email content to the current user's inbox
    const myAuth = getAuthForUser(req.user.id);
    if (myAuth) {
      const gm = google.gmail({ version: 'v1', auth: myAuth.auth });
      for (const m of msgs) {
        try {
          // Get full message from the original user's Gmail, then forward to current user
          const origUserId = toStr(m.gmail_user_id);
          const origAuth = origUserId ? getAuthForUser(origUserId) : null;
          if (origAuth) {
            const origGm = google.gmail({ version: 'v1', auth: origAuth.auth });
            const fullMsg = await origGm.users.messages.get({ userId: 'me', id: toStr(m.gmail_message_id), format: 'raw' });
            // Insert the raw message into current user's inbox
            await gm.users.messages.insert({ userId: 'me', requestBody: { raw: fullMsg.data.raw, labelIds: ['INBOX', 'UNREAD'] } });
          }
        } catch(e) { console.log('[Pull] Forward to me failed:', e.message); }
      }
    }
    // Also remove the archived label from original user's Gmail so it's not orphaned
    for (const m of msgs) {
      const gmailUserId = toStr(m.gmail_user_id);
      const userAuth = gmailUserId ? getAuthForUser(gmailUserId) : null;
      if (userAuth) {
        try {
          const gm = google.gmail({ version: 'v1', auth: userAuth.auth });
          const hiddenLabelId = await getOrCreateLabel(gm, 'CareCoord/Archived');
          if (hiddenLabelId) await gm.users.messages.modify({ userId: 'me', id: toStr(m.gmail_message_id), requestBody: { removeLabelIds: [hiddenLabelId] } });
        } catch(e) {}
      }
    }
  } else {
    // Default: restore to original coordinator's inbox as unread
    for (const m of msgs) {
      const gmailUserId = toStr(m.gmail_user_id);
      const userAuth = gmailUserId ? getAuthForUser(gmailUserId) : null;
      if (userAuth) {
        try {
          const gm = google.gmail({ version: 'v1', auth: userAuth.auth });
          const hiddenLabelId = await getOrCreateLabel(gm, 'CareCoord/Archived');
          const modReq = { addLabelIds: ['INBOX', 'UNREAD'] };
          if (hiddenLabelId) modReq.removeLabelIds = [hiddenLabelId];
          await gm.users.messages.modify({ userId: 'me', id: toStr(m.gmail_message_id), requestBody: modReq });
        } catch(e) { console.log('[Pull] Gmail restore failed:', e.message); }
      }
    }
  }

  // Remove ticket and related data from CareCoord
  db.prepare('DELETE FROM attachments WHERE ticket_id = ?').run(ticketId);
  db.prepare('DELETE FROM notes WHERE ticket_id = ?').run(ticketId);
  db.prepare('DELETE FROM messages WHERE ticket_id = ?').run(ticketId);
  db.prepare('DELETE FROM ticket_tags WHERE ticket_id = ?').run(ticketId);
  db.prepare('DELETE FROM tickets WHERE id = ?').run(ticketId);
  saveDb();
  console.log('[Queue] Pulled (' + (destination || 'original') + '):', ticketId);
  res.json({ ok: true, ticketId, destination: destination || 'original' });
});

// ── Bulk pull from queue (supervisor + admin) ──
router.post('/bulk-pull', requireAuth, async (req, res) => {
  if (req.user.role !== 'supervisor' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Supervisor or admin access required' });
  }
  const db = getDb();
  const { ticketIds, destination } = req.body;
  if (!ticketIds || !ticketIds.length) return res.status(400).json({ error: 'ticketIds required' });

  let pulled = 0;
  for (const ticketId of ticketIds) {
    const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
    if (!ticket) continue;

    const msgs = db.prepare('SELECT gmail_message_id, gmail_user_id FROM messages WHERE ticket_id = ? AND gmail_message_id IS NOT NULL').all(ticketId);

    if (destination === 'me') {
      // Forward to current user's inbox
      const myAuth = getAuthForUser(req.user.id);
      if (myAuth) {
        const gm = google.gmail({ version: 'v1', auth: myAuth.auth });
        for (const m of msgs) {
          try {
            const origUserId = toStr(m.gmail_user_id);
            const origAuth = origUserId ? getAuthForUser(origUserId) : null;
            if (origAuth) {
              const origGm = google.gmail({ version: 'v1', auth: origAuth.auth });
              const fullMsg = await origGm.users.messages.get({ userId: 'me', id: toStr(m.gmail_message_id), format: 'raw' });
              await gm.users.messages.insert({ userId: 'me', requestBody: { raw: fullMsg.data.raw, labelIds: ['INBOX', 'UNREAD'] } });
            }
          } catch(e) {}
        }
      }
      // Clean up archived label from original
      for (const m of msgs) {
        const gmailUserId = toStr(m.gmail_user_id);
        const userAuth = gmailUserId ? getAuthForUser(gmailUserId) : null;
        if (userAuth) {
          try {
            const gm2 = google.gmail({ version: 'v1', auth: userAuth.auth });
            const hiddenLabelId = await getOrCreateLabel(gm2, 'CareCoord/Archived');
            if (hiddenLabelId) await gm2.users.messages.modify({ userId: 'me', id: toStr(m.gmail_message_id), requestBody: { removeLabelIds: [hiddenLabelId] } });
          } catch(e) {}
        }
      }
    } else {
      // Default: restore to original coordinator's inbox as unread
      for (const m of msgs) {
        const gmailUserId = toStr(m.gmail_user_id);
        const userAuth = gmailUserId ? getAuthForUser(gmailUserId) : null;
        if (userAuth) {
          try {
            const gm = google.gmail({ version: 'v1', auth: userAuth.auth });
            const hiddenLabelId = await getOrCreateLabel(gm, 'CareCoord/Archived');
            const modReq = { addLabelIds: ['INBOX', 'UNREAD'] };
            if (hiddenLabelId) modReq.removeLabelIds = [hiddenLabelId];
            await gm.users.messages.modify({ userId: 'me', id: toStr(m.gmail_message_id), requestBody: modReq });
          } catch(e) {}
        }
      }
    }

    // Remove ticket and related data from CareCoord
    db.prepare('DELETE FROM attachments WHERE ticket_id = ?').run(ticketId);
    db.prepare('DELETE FROM notes WHERE ticket_id = ?').run(ticketId);
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

  const userAuth = getAuthForUser(req.user.id);
  if (!userAuth) return res.status(400).json({ error: 'Not connected' });
  const gm = google.gmail({ version: 'v1', auth: userAuth.auth });
  const userEmail = userAuth.email;
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
          .run(msgId, ticketId, 'inbound', 'email', from, JSON.stringify([userEmail]), from, subj, bd || subj, ts, gmailMessageId, null, '[]', gmailMessageId, thId, req.user.id, ts);
        db.prepare('UPDATE tickets SET last_activity_at=?, has_unread=1, status=? WHERE id=?').run(ts, 'OPEN', ticketId);
      } else {
        ticketId = generateTicketId(db, rid);
        db.prepare('INSERT OR IGNORE INTO tickets (id,subject,from_email,region_id,status,created_at,last_activity_at,external_participants,has_unread) VALUES (?,?,?,?,?,?,?,?,1)')
          .run(ticketId, subj, from, rid, 'OPEN', ts, ts, JSON.stringify([from]));
        const msgId = 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
        db.prepare('INSERT OR IGNORE INTO messages (id,ticket_id,direction,channel,from_address,to_addresses,sender,subject,body_text,sent_at,provider_message_id,in_reply_to,reference_ids,gmail_message_id,gmail_thread_id,gmail_user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(msgId, ticketId, 'inbound', 'email', from, JSON.stringify([userEmail]), from, subj, bd || subj, ts, gmailMessageId, null, '[]', gmailMessageId, thId, req.user.id, ts);
      }

      // Forward to archive
      try {
        const fwd = ['From: ' + userEmail, 'To: ' + archiveAddr, 'Subject: Fwd: ' + subj,
          'Content-Type: text/plain; charset=utf-8', 'MIME-Version: 1.0', '',
          '---------- Forwarded message ----------', 'From: ' + from,
          'Date: ' + hdr(h, 'Date'), 'Subject: ' + subj, '', bd || subj];
        const raw = Buffer.from(fwd.join(String.fromCharCode(13,10))).toString('base64url');
        await gm.users.messages.send({ userId: 'me', requestBody: { raw } });
      } catch(e) {}

      // Hide from Gmail
      try {
        const hiddenLabelId = typeof getOrCreateLabel === 'function' ? await getOrCreateLabel(gm, 'CareCoord/Archived') : null;
        const modReq = { removeLabelIds: ['INBOX', 'UNREAD', 'CATEGORY_PERSONAL', 'CATEGORY_SOCIAL', 'CATEGORY_UPDATES', 'CATEGORY_FORUMS', 'CATEGORY_PROMOTIONS'] };
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

// ── Modify / Trash / Untrash ──
router.post('/personal/modify', requireAuth, async (req, res) => {
  try {
    const userAuth = getAuthForUser(req.user.id);
    const t = getTokens(req.user.id);
    if (!userAuth && !t) return res.status(400).json({ error: 'Not connected' });
    const gm = google.gmail({version:'v1', auth: userAuth ? userAuth.auth : authClient(t)});
    const { messageId, addLabelIds, removeLabelIds } = req.body;
    if (!messageId) return res.status(400).json({ error: 'messageId required' });
    await gm.users.messages.modify({ userId: 'me', id: messageId, requestBody: { addLabelIds: addLabelIds || [], removeLabelIds: removeLabelIds || [] } });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/personal/trash', requireAuth, async (req, res) => {
  try {
    const userAuth = getAuthForUser(req.user.id);
    const t = getTokens(req.user.id);
    if (!userAuth && !t) return res.status(400).json({ error: 'Not connected' });
    const gm = google.gmail({version:'v1', auth: userAuth ? userAuth.auth : authClient(t)});
    const { messageId } = req.body;
    await gm.users.messages.trash({ userId: 'me', id: messageId });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/personal/untrash', requireAuth, async (req, res) => {
  try {
    const userAuth = getAuthForUser(req.user.id);
    const t = getTokens(req.user.id);
    if (!userAuth && !t) return res.status(400).json({ error: 'Not connected' });
    const gm = google.gmail({version:'v1', auth: userAuth ? userAuth.auth : authClient(t)});
    const { messageId } = req.body;
    await gm.users.messages.untrash({ userId: 'me', id: messageId });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Label management ──
router.post('/labels/create', requireAuth, async (req, res) => {
  try {
    const userAuth = getAuthForUser(req.user.id);
    const t = getTokens(req.user.id);
    if (!userAuth && !t) return res.status(400).json({ error: 'Not connected' });
    const gm = google.gmail({version:'v1', auth: userAuth ? userAuth.auth : authClient(t)});
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Label name required' });
    const r = await gm.users.labels.create({ userId: 'me', requestBody: { name: name.trim(), labelListVisibility: 'labelShow', messageListVisibility: 'show' } });
    res.json({ label: { id: r.data.id, name: r.data.name, type: r.data.type } });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete('/labels/:labelId', requireAuth, async (req, res) => {
  try {
    const userAuth = getAuthForUser(req.user.id);
    const t = getTokens(req.user.id);
    if (!userAuth && !t) return res.status(400).json({ error: 'Not connected' });
    const gm = google.gmail({version:'v1', auth: userAuth ? userAuth.auth : authClient(t)});
    await gm.users.labels.delete({ userId: 'me', id: req.params.labelId });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.patch('/labels/:labelId', requireAuth, async (req, res) => {
  try {
    const userAuth = getAuthForUser(req.user.id);
    const t = getTokens(req.user.id);
    if (!userAuth && !t) return res.status(400).json({ error: 'Not connected' });
    const gm = google.gmail({version:'v1', auth: userAuth ? userAuth.auth : authClient(t)});
    const { name, color } = req.body;
    const requestBody = {};
    if (name?.trim()) requestBody.name = name.trim();
    if (color) requestBody.color = color;
    const r = await gm.users.labels.patch({ userId: 'me', id: req.params.labelId, requestBody });
    res.json({ label: { id: r.data.id, name: r.data.name, type: r.data.type, color: r.data.color || null } });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Filters ──
router.get('/filters', requireAuth, (req, res) => {
  const f = getDb().prepare('SELECT * FROM email_filters ORDER BY created_at DESC').all();
  res.json({ filters: f.map(x=>({id:toStr(x.id),domain:toStr(x.domain),sender:toStr(x.sender),subject_contains:toStr(x.subject_contains),action:toStr(x.action)})) });
});
router.post('/filters', requireAuth, (req, res) => {
  const {domain,sender,subject_contains,action}=req.body;
  if(!domain&&!sender&&!subject_contains) return res.status(400).json({error:'Need criterion'});
  const id='ef-'+Date.now();
  getDb().prepare('INSERT INTO email_filters (id,domain,sender,subject_contains,action,created_by,created_at) VALUES (?,?,?,?,?,?,?)').run(id,domain||null,sender||null,subject_contains||null,action||'personal',req.user.id,Date.now());
  saveDb(); res.json({id});
});
router.delete('/filters/:id', requireAuth, (req, res) => { getDb().prepare('DELETE FROM email_filters WHERE id=?').run(req.params.id); saveDb(); res.json({ok:true}); });

// ── Accounts ──
router.get('/accounts', requireAuth, (req, res) => {
  const a = getDb().prepare('SELECT gt.user_id,gt.email,u.name,es.last_sync_at FROM gmail_tokens gt JOIN users u ON u.id=gt.user_id LEFT JOIN email_sync_state es ON es.user_id=gt.user_id WHERE gt.access_token IS NOT NULL').all();
  res.json({ accounts: a.map(x=>({userId:toStr(x.user_id),email:toStr(x.email),name:toStr(x.name),lastSync:x.last_sync_at})) });
});

// ── Calendar ──
router.get('/calendar/events', requireAuth, async (req, res) => {
  try {
    const t = getTokens(req.user.id); if (!t) return res.json({ events: [] });
    const r = await google.calendar({version:'v3',auth:authClient(t)}).events.list({ calendarId:'primary', timeMin:req.query.timeMin||new Date().toISOString(), timeMax:req.query.timeMax||new Date(Date.now()+7*86400000).toISOString(), maxResults:50, singleEvents:true, orderBy:'startTime' });
    res.json({ events: (r.data.items||[]).map(e=>({ id:e.id, summary:e.summary||'(No title)', start:e.start.dateTime||e.start.date, end:e.end.dateTime||e.end.date, allDay:!e.start.dateTime, location:e.location||'', meetLink:e.hangoutLink||null, attendees:(e.attendees||[]).map(a=>({email:a.email,name:a.displayName})), htmlLink:e.htmlLink })) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
router.post('/calendar/events', requireAuth, async (req, res) => {
  try {
    const t = getTokens(req.user.id); if (!t) return res.status(400).json({error:'Not connected'});
    const {summary,description,startTime,endTime,attendees,addMeet}=req.body;
    const ev = {summary, description:description||'', start:{dateTime:startTime,timeZone:'America/New_York'}, end:{dateTime:endTime,timeZone:'America/New_York'}};
    if(attendees&&attendees.length) ev.attendees=attendees.map(e=>({email:e}));
    if(addMeet) ev.conferenceData={createRequest:{requestId:'cc-'+Date.now(),conferenceSolutionKey:{type:'hangoutsMeet'}}};
    const r = await google.calendar({version:'v3',auth:authClient(t)}).events.insert({calendarId:'primary',requestBody:ev,conferenceDataVersion:addMeet?1:0});
    res.json({id:r.data.id, meetLink:r.data.hangoutLink||null, htmlLink:r.data.htmlLink});
  } catch(e) { res.status(500).json({error:e.message}); }
});
router.delete('/calendar/events/:id', requireAuth, async (req, res) => {
  try { const t=getTokens(req.user.id); await google.calendar({version:'v3',auth:authClient(t)}).events.delete({calendarId:'primary',eventId:req.params.id}); res.json({ok:true}); }
  catch(e) { res.status(500).json({error:e.message}); }
});

// ── Drive ──
router.get('/drive/files', requireAuth, async (req, res) => {
  try {
    const t = getTokens(req.user.id); if (!t) return res.json({ files: [] });
    let q='trashed=false'; const fid=req.query.folderId, sq=req.query.q;
    if(fid) q+=" and '"+fid+"' in parents"; else if(sq) q+=" and name contains '"+sq.replace(/'/g,"\\'")+"'"; else q+=" and 'root' in parents";
    const r = await google.drive({version:'v3',auth:authClient(t)}).files.list({q, pageSize:30, fields:'files(id,name,mimeType,modifiedTime,size,webViewLink,shared)', orderBy:'folder,modifiedTime desc'});
    res.json({ files: (r.data.files||[]).map(f=>({id:f.id,name:f.name,mimeType:f.mimeType,isFolder:f.mimeType==='application/vnd.google-apps.folder',modifiedTime:f.modifiedTime,size:f.size?parseInt(f.size):null,webViewLink:f.webViewLink,shared:f.shared})) });
  } catch(e) { res.status(500).json({error:e.message}); }
});
router.get('/drive/shared', requireAuth, async (req, res) => {
  try {
    const t = getTokens(req.user.id); if (!t) return res.json({ files: [] });
    const r = await google.drive({version:'v3',auth:authClient(t)}).files.list({q:'sharedWithMe=true and trashed=false', pageSize:30, fields:'files(id,name,mimeType,modifiedTime,size,webViewLink,shared)'});
    res.json({ files: r.data.files||[] });
  } catch(e) { res.status(500).json({error:e.message}); }
});

module.exports = router;
