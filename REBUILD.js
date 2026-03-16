// REBUILD.js — Complete CareCoord rebuild
// Rewrites: database, middleware, auth, gmail, api, index, and all workspace components
// Fixes: infinite loops, Uint8Array issues, missing routes, persistence
//
// Usage:
//   node REBUILD.js
//   del server\carecoord.db
//   npm run seed
//   npm run dev

const fs = require('fs');
const path = require('path');
const write = (f, c) => { fs.writeFileSync(path.join(__dirname, f), c, 'utf8'); console.log('  ✓ ' + f); };

console.log('\n🔧 REBUILDING CareCoord...\n');

// ═══════════════════════════════════════════════════════════════════════════════
// SERVER: database.js
// ═══════════════════════════════════════════════════════════════════════════════

write('server/database.js', `const initSqlJs = require('sql.js');
const fs = require('fs');
const p = require('path');
const DB_PATH = p.join(__dirname, 'carecoord.db');
let rawDb = null;

async function initDb() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    rawDb = new SQL.Database(fs.readFileSync(DB_PATH));
    console.log('[DB] Loaded from disk');
  } else {
    rawDb = new SQL.Database();
    console.log('[DB] New database');
  }
  const r = s => rawDb.run(s);
  r('CREATE TABLE IF NOT EXISTS regions (id TEXT PRIMARY KEY, name TEXT, description TEXT, routing_aliases TEXT, is_active INTEGER DEFAULT 1)');
  r('CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT, email TEXT UNIQUE, role TEXT, avatar TEXT, is_active INTEGER DEFAULT 1, password_hash TEXT, totp_secret TEXT, totp_enabled INTEGER DEFAULT 0)');
  r('CREATE TABLE IF NOT EXISTS user_regions (user_id TEXT, region_id TEXT, PRIMARY KEY(user_id, region_id))');
  r('CREATE TABLE IF NOT EXISTS tickets (id TEXT PRIMARY KEY, subject TEXT, from_email TEXT, to_email TEXT, region_id TEXT, status TEXT DEFAULT \\'OPEN\\', priority TEXT DEFAULT \\'NORMAL\\', category TEXT, assignee_user_id TEXT, created_at INTEGER, last_activity_at INTEGER, closed_at INTEGER, closed_reason TEXT)');
  r('CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, ticket_id TEXT, direction TEXT, channel TEXT, from_address TEXT, to_addresses TEXT, sender TEXT, subject TEXT, body TEXT, body_text TEXT, sent_at INTEGER, timestamp INTEGER, provider_message_id TEXT, in_reply_to TEXT, reference_ids TEXT, created_by_user_id TEXT, created_at INTEGER, gmail_message_id TEXT, gmail_thread_id TEXT, gmail_user_id TEXT)');
  r('CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, ticket_id TEXT, user_id TEXT, author_user_id TEXT, body TEXT, timestamp INTEGER, created_at INTEGER)');
  r('CREATE TABLE IF NOT EXISTS audit_log (id TEXT PRIMARY KEY, user_id TEXT, actor_user_id TEXT, action TEXT, action_type TEXT, target_type TEXT, entity_type TEXT, target_id TEXT, entity_id TEXT, detail TEXT, ts TEXT, timestamp INTEGER, before_json TEXT, after_json TEXT)');
  r('CREATE TABLE IF NOT EXISTS close_reasons (id TEXT PRIMARY KEY, label TEXT, requires_comment INTEGER DEFAULT 0)');
  r('CREATE TABLE IF NOT EXISTS tags (id TEXT PRIMARY KEY, label TEXT, color TEXT)');
  r('CREATE TABLE IF NOT EXISTS ticket_tags (ticket_id TEXT, tag_id TEXT, PRIMARY KEY(ticket_id, tag_id))');
  r('CREATE TABLE IF NOT EXISTS attachments (id TEXT PRIMARY KEY, ticket_id TEXT, filename TEXT, data TEXT)');
  r('CREATE TABLE IF NOT EXISTS gmail_tokens (id TEXT PRIMARY KEY, user_id TEXT, access_token TEXT, refresh_token TEXT, expiry_date INTEGER, email TEXT)');
  r('CREATE TABLE IF NOT EXISTS email_filters (id TEXT PRIMARY KEY, domain TEXT, sender TEXT, subject_contains TEXT, action TEXT DEFAULT \\'personal\\', created_by TEXT, created_at INTEGER)');
  r('CREATE TABLE IF NOT EXISTS email_sync_state (user_id TEXT PRIMARY KEY, last_history_id TEXT, last_sync_at INTEGER)');
  saveDb();
  return { exec: s => rawDb.exec(s), prepare: s => wrap(s), run: (s,p) => rawDb.run(s,p||[]) };
}

function wrap(sql) {
  return {
    run: function() { var a=Array.from(arguments); rawDb.run(sql, a); return { changes: rawDb.getRowsModified() }; },
    all: function() { try { var a=Array.from(arguments); var st=rawDb.prepare(sql); if(a.length)st.bind(a); var r=[]; while(st.step())r.push(st.getAsObject()); st.free(); return r; } catch(e){ return []; } },
    get: function() { try { var a=Array.from(arguments); var st=rawDb.prepare(sql); if(a.length)st.bind(a); var r=st.step()?st.getAsObject():undefined; st.free(); return r; } catch(e){ return undefined; } },
  };
}

function getDb() {
  if (!rawDb) throw new Error('DB not initialized');
  return { prepare: wrap, exec: s => rawDb.exec(s), run: (s,p) => rawDb.run(s,p||[]) };
}

function saveDb() { if(rawDb) fs.writeFileSync(DB_PATH, Buffer.from(rawDb.export())); }
function closeDb() { saveDb(); }

module.exports = { initDb, getDb, saveDb, closeDb };
`);

// ═══════════════════════════════════════════════════════════════════════════════
// SERVER: middleware.js
// ═══════════════════════════════════════════════════════════════════════════════

write('server/middleware.js', `const { getDb, saveDb } = require('./database');

function toStr(v) {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (v instanceof Uint8Array || Buffer.isBuffer(v)) return Buffer.from(v).toString('utf8');
  return String(v);
}

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!user) return res.status(401).json({ error: 'User not found' });
  req.user = { id: toStr(user.id), name: toStr(user.name), email: toStr(user.email), role: toStr(user.role) };
  next();
}

function addAudit(db, userId, action, entityType, entityId, detail) {
  try {
    db.prepare('INSERT INTO audit_log (id, actor_user_id, action_type, entity_type, entity_id, ts, detail) VALUES (?,?,?,?,?,?,?)')
      .run('au-'+Date.now()+'-'+Math.random().toString(36).slice(2,5), userId, action, entityType, entityId, new Date().toISOString(), detail||'');
    saveDb();
  } catch(e) {}
}

module.exports = { requireAuth, addAudit, toStr };
`);

// ═══════════════════════════════════════════════════════════════════════════════
// SERVER: routes/auth.js
// ═══════════════════════════════════════════════════════════════════════════════

write('server/routes/auth.js', `const express = require('express');
const bcrypt = require('bcryptjs');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const { getDb, saveDb } = require('../database');
const { requireAuth, addAudit, toStr } = require('../middleware');
const router = express.Router();

router.post('/login', async (req, res) => {
  try {
    const db = getDb();
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });
    const hash = toStr(user.password_hash);
    if (!hash) return res.status(401).json({ error: 'Invalid email or password' });
    const valid = await bcrypt.compare(password, hash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });
    const userId = toStr(user.id);
    const totpEnabled = Number(user.totp_enabled);
    const totpSecret = toStr(user.totp_secret);
    if (totpEnabled && totpSecret) {
      req.session.pendingUserId = userId;
      req.session.pending2FA = true;
      return res.json({ step: '2fa' });
    }
    if (!totpSecret) {
      req.session.pendingUserId = userId;
      req.session.requireSetup2FA = true;
      return res.json({ step: 'setup_2fa' });
    }
    completeLogin(req, res, user);
  } catch (err) { console.error('[Auth]', err); res.status(500).json({ error: 'Server error' }); }
});

router.post('/verify-2fa', (req, res) => {
  try {
    const db = getDb();
    if (!req.session.pendingUserId) return res.status(400).json({ error: 'No pending verification' });
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.pendingUserId);
    if (!user) return res.status(401).json({ error: 'User not found' });
    const verified = speakeasy.totp.verify({ secret: toStr(user.totp_secret), encoding: 'base32', token: String(req.body.code).trim(), window: 30 });
    if (!verified) return res.status(401).json({ error: 'Invalid code' });
    delete req.session.pending2FA;
    completeLogin(req, res, user);
  } catch (err) { console.error('[Auth]', err); res.status(500).json({ error: 'Server error' }); }
});

router.post('/setup-2fa', async (req, res) => {
  try {
    const db = getDb();
    const userId = req.session.pendingUserId || req.session.userId;
    if (!userId) return res.status(400).json({ error: 'Not authenticated' });
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    const secret = speakeasy.generateSecret({ name: 'CareCoord (' + toStr(user.email) + ')', issuer: 'Seniority Healthcare' });
    db.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').run(secret.base32, userId);
    saveDb();
    req.session.setup2faSecret = secret.base32;
    const qrUrl = await QRCode.toDataURL(secret.otpauth_url);
    res.json({ qrCode: qrUrl, secret: secret.base32 });
  } catch (err) { console.error('[Auth]', err); res.status(500).json({ error: 'Server error' }); }
});

router.post('/confirm-2fa', (req, res) => {
  try {
    const db = getDb();
    const userId = req.session.pendingUserId || req.session.userId;
    const secret = req.session.setup2faSecret;
    if (!userId || !secret) return res.status(400).json({ error: 'No 2FA setup in progress' });
    const verified = speakeasy.totp.verify({ secret, encoding: 'base32', token: String(req.body.code).trim(), window: 30 });
    if (!verified) return res.status(401).json({ error: 'Invalid code' });
    db.prepare('UPDATE users SET totp_enabled = 1, totp_secret = ? WHERE id = ?').run(secret, userId);
    saveDb();
    delete req.session.setup2faSecret;
    delete req.session.requireSetup2FA;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    completeLogin(req, res, user);
  } catch (err) { console.error('[Auth]', err); res.status(500).json({ error: 'Server error' }); }
});

router.post('/change-password', async (req, res) => {
  try {
    const db = getDb();
    const userId = req.session.pendingUserId || req.session.userId;
    if (!userId) return res.status(400).json({ error: 'Not authenticated' });
    const hash = await bcrypt.hash(req.body.newPassword, 12);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId);
    saveDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!toStr(user.totp_secret)) { req.session.requireSetup2FA = true; return res.json({ step: 'setup_2fa' }); }
    req.session.pending2FA = true;
    return res.json({ step: '2fa' });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

function completeLogin(req, res, user) {
  const db = getDb();
  const userId = toStr(user.id);
  const regions = db.prepare('SELECT region_id FROM user_regions WHERE user_id = ?').all(userId);
  req.session.pendingUserId = null;
  req.session.pending2FA = null;
  req.session.requireSetup2FA = null;
  req.session.userId = userId;
  addAudit(db, userId, 'login', 'user', userId, 'User logged in');
  res.json({ step: 'done', user: { id: userId, name: toStr(user.name), email: toStr(user.email), role: toStr(user.role), avatar: toStr(user.avatar), regionIds: regions.map(r => toStr(r.region_id)) } });
}

router.post('/logout', (req, res) => { req.session.destroy(() => res.json({ ok: true })); });

router.get('/me', requireAuth, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(401).json({ error: 'Not found' });
  const regions = db.prepare('SELECT region_id FROM user_regions WHERE user_id = ?').all(req.user.id);
  res.json({ id: toStr(user.id), name: toStr(user.name), email: toStr(user.email), role: toStr(user.role), avatar: toStr(user.avatar), regionIds: regions.map(r => toStr(r.region_id)) });
});

module.exports = router;
`);

// ═══════════════════════════════════════════════════════════════════════════════
// SERVER: routes/gmail.js (complete workspace)
// ═══════════════════════════════════════════════════════════════════════════════

write('server/routes/gmail.js', `const express = require('express');
const { google } = require('googleapis');
const { getDb, saveDb } = require('../database');
const { requireAuth, toStr } = require('../middleware');
const router = express.Router();

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
function hdr(h, n) { const x = (h||[]).find(x => x.name.toLowerCase() === n.toLowerCase()); return x ? x.value : ''; }
function body(payload) { let t='',h=''; (function w(p){ if(p.body&&p.body.data){ const d=Buffer.from(p.body.data,'base64').toString(); if(p.mimeType==='text/plain'&&!t)t=d; if(p.mimeType==='text/html')h=d; } if(p.parts)p.parts.forEach(w); })(payload); return h||t; }

// ── OAuth ──
router.get('/auth', requireAuth, (req, res) => {
  res.json({ authUrl: oauth2().generateAuthUrl({ access_type:'offline', prompt:'consent', state:req.user.id,
    scope:['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.send','https://www.googleapis.com/auth/gmail.modify','https://www.googleapis.com/auth/userinfo.email','https://www.googleapis.com/auth/calendar','https://www.googleapis.com/auth/drive.readonly'] }) });
});
router.get('/callback', async (req, res) => {
  try {
    const c = oauth2(); const { tokens: t } = await c.getToken(req.query.code); c.setCredentials(t);
    const email = (await google.oauth2({version:'v2',auth:c}).userinfo.get()).data.email;
    putTokens(req.query.state, t, email);
    console.log('[Workspace] Connected:', email);
    res.send('<html><body><h2>Google Workspace Connected!</h2><script>window.close()</script></body></html>');
  } catch(e) { res.status(500).send('<h2>Failed</h2><p>'+e.message+'</p>'); }
});
router.get('/status', requireAuth, (req, res) => {
  const t = getTokens(req.user.id);
  res.json({ connected: !!(t&&t.access_token), email: t ? toStr(t.email) : null });
});
router.post('/disconnect', requireAuth, (req, res) => {
  getDb().prepare('DELETE FROM gmail_tokens WHERE user_id=?').run(req.user.id); saveDb(); res.json({ ok: true });
});

// ── Sync into regional queue ──
router.post('/sync', requireAuth, async (req, res) => {
  try {
    const db = getDb(); let total = 0;
    for (const a of db.prepare('SELECT * FROM gmail_tokens WHERE access_token IS NOT NULL').all()) {
      try { total += await syncUser(db, a); } catch(e) { console.error('[Sync]', toStr(a.email), e.message); }
    }
    res.json({ synced: total });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
router.get('/auto-sync', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const st = db.prepare('SELECT last_sync_at FROM email_sync_state WHERE user_id=?').get(req.user.id);
    if (st && st.last_sync_at && (Date.now() - st.last_sync_at) < 60000) return res.json({ synced: 0 });
    let total = 0;
    for (const a of db.prepare('SELECT * FROM gmail_tokens WHERE access_token IS NOT NULL').all()) {
      try { total += await syncUser(db, a); } catch(e) {}
    }
    res.json({ synced: total });
  } catch(e) { res.json({ synced: 0 }); }
});

async function syncUser(db, row) {
  const auth = authClient(row), gmail = google.gmail({version:'v1',auth}), uid = toStr(row.user_id);
  const regions = db.prepare('SELECT region_id FROM user_regions WHERE user_id=?').all(uid);
  if (!regions.length) return 0;
  const yesterday = new Date(Date.now()-86400000).toISOString().split('T')[0];
  const list = await gmail.users.messages.list({userId:'me', q:'in:inbox after:'+yesterday, maxResults:20});
  if (!list.data.messages) return 0;
  const filters = db.prepare("SELECT * FROM email_filters WHERE action='personal'").all();
  let n = 0;
  for (const m of list.data.messages) {
    if (db.prepare('SELECT id FROM messages WHERE gmail_message_id=?').get(m.id)) continue;
    const msg = await gmail.users.messages.get({userId:'me',id:m.id,format:'full'});
    const h = msg.data.payload.headers;
    const from=hdr(h,'From'), subj=hdr(h,'Subject')||'(no subject)', bd=body(msg.data.payload), dt=hdr(h,'Date'), thId=msg.data.threadId;
    let personal = false;
    for (const f of filters) {
      if (toStr(f.domain) && from.toLowerCase().includes(toStr(f.domain).toLowerCase())) { personal=true; break; }
      if (toStr(f.sender) && from.toLowerCase().includes(toStr(f.sender).toLowerCase())) { personal=true; break; }
      if (toStr(f.subject_contains) && subj.toLowerCase().includes(toStr(f.subject_contains).toLowerCase())) { personal=true; break; }
    }
    if (personal) continue;
    const rid=toStr(regions[0].region_id), ts=new Date(dt).getTime()||Date.now();
    const tid='tk-'+Date.now()+'-'+Math.random().toString(36).slice(2,6);
    db.prepare('INSERT INTO tickets (id,subject,from_email,region_id,status,created_at,last_activity_at) VALUES (?,?,?,?,?,?,?)').run(tid,subj,from,rid,'OPEN',ts,ts);
    db.prepare('INSERT INTO messages (id,ticket_id,direction,sender,body_text,sent_at,gmail_message_id,gmail_thread_id,gmail_user_id) VALUES (?,?,?,?,?,?,?,?,?)').run('msg-'+Date.now()+'-'+Math.random().toString(36).slice(2,6),tid,'inbound',from,bd||subj,ts,m.id,thId,uid);
    n++;
  }
  db.prepare('INSERT OR REPLACE INTO email_sync_state (user_id,last_sync_at) VALUES (?,?)').run(uid, Date.now());
  saveDb();
  if (n) console.log('[Sync]', toStr(row.email), n, 'new');
  return n;
}

// ── Personal inbox (full Gmail mirror) ──
router.get('/personal', requireAuth, async (req, res) => {
  try {
    const t = getTokens(req.user.id); if (!t) return res.json({ messages: [] });
    const gmail = google.gmail({version:'v1',auth:authClient(t)});
    const map = {INBOX:'in:inbox',SENT:'in:sent',DRAFT:'in:drafts',STARRED:'is:starred',SPAM:'in:spam',TRASH:'in:trash',ALL:''};
    const q = req.query.q || map[req.query.folder||'INBOX'] || 'in:inbox';
    const list = await gmail.users.messages.list({userId:'me', q, maxResults:parseInt(req.query.max)||20});
    if (!list.data.messages) return res.json({ messages: [] });
    const msgs = await Promise.all(list.data.messages.map(async m => {
      const msg = await gmail.users.messages.get({userId:'me',id:m.id,format:'metadata',metadataHeaders:['From','To','Subject','Date']});
      const h = msg.data.payload.headers;
      return { id:msg.data.id, threadId:msg.data.threadId, snippet:msg.data.snippet, from:hdr(h,'From'), to:hdr(h,'To'), subject:hdr(h,'Subject')||'(no subject)', date:hdr(h,'Date'), labels:msg.data.labelIds||[], isUnread:(msg.data.labelIds||[]).includes('UNREAD') };
    }));
    res.json({ messages: msgs });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
router.get('/personal/:id', requireAuth, async (req, res) => {
  try {
    const t = getTokens(req.user.id); if (!t) return res.status(400).json({ error: 'Not connected' });
    const gmail = google.gmail({version:'v1',auth:authClient(t)});
    const msg = await gmail.users.messages.get({userId:'me',id:req.params.id,format:'full'});
    const h = msg.data.payload.headers;
    if ((msg.data.labelIds||[]).includes('UNREAD')) await gmail.users.messages.modify({userId:'me',id:req.params.id,requestBody:{removeLabelIds:['UNREAD']}});
    res.json({ id:msg.data.id, threadId:msg.data.threadId, from:hdr(h,'From'), to:hdr(h,'To'), cc:hdr(h,'Cc'), subject:hdr(h,'Subject'), date:hdr(h,'Date'), body:body(msg.data.payload), labels:msg.data.labelIds||[] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
router.post('/personal/send', requireAuth, async (req, res) => {
  try {
    const t = getTokens(req.user.id); if (!t) return res.status(400).json({ error: 'Not connected' });
    const gmail = google.gmail({version:'v1',auth:authClient(t)});
    const { to, cc, subject, body: b, threadId } = req.body;
    let raw = ['From: '+toStr(t.email),'To: '+to]; if(cc)raw.push('Cc: '+cc);
    raw.push('Subject: '+(subject||''),'MIME-Version: 1.0','Content-Type: text/html; charset=utf-8','',b);
    const enc = Buffer.from(raw.join('\\r\\n')).toString('base64url');
    const p = { userId:'me', requestBody:{ raw: enc } }; if(threadId)p.requestBody.threadId=threadId;
    const r = await gmail.users.messages.send(p);
    res.json({ id: r.data.id, threadId: r.data.threadId });
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
    if(fid) q+=" and '"+fid+"' in parents"; else if(sq) q+=" and name contains '"+sq.replace(/'/g,"\\\\'")+"'"; else q+=" and 'root' in parents";
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
`);

// ═══════════════════════════════════════════════════════════════════════════════
// SERVER: index.js — add /tags and /close-reasons
// ═══════════════════════════════════════════════════════════════════════════════

let indexJs = fs.readFileSync(path.join(__dirname, 'server', 'index.js'), 'utf8');
if (!indexJs.includes('/api/tags')) {
  indexJs = indexJs.replace(
    "app.use('/api/gmail'",
    `app.get('/api/tags', (req, res) => { try { const t = require('./database').getDb().prepare('SELECT * FROM tags').all(); res.json({ tags: t.map(x=>({id:x.id?Buffer.from(x.id).toString():x.id, label:x.label?Buffer.from(x.label).toString():'', color:x.color?Buffer.from(x.color).toString():''})) }); } catch(e) { res.json({ tags: [] }); } });
app.get('/api/close-reasons', (req, res) => { try { const r = require('./database').getDb().prepare('SELECT * FROM close_reasons').all(); res.json({ reasons: r.map(x=>({id:x.id?Buffer.from(x.id).toString():x.id, label:x.label?Buffer.from(x.label).toString():''})) }); } catch(e) { res.json({ reasons: [] }); } });
app.use('/api/gmail'`
  );
  fs.writeFileSync(path.join(__dirname, 'server', 'index.js'), indexJs, 'utf8');
  console.log('  ✓ server/index.js — added /tags and /close-reasons');
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLIENT: api.js
// ═══════════════════════════════════════════════════════════════════════════════

write('client/src/api.js', `const BASE = '/api';

async function request(path, options = {}) {
  const config = { method: options.method || 'GET', headers: {}, credentials: 'include' };
  if (options.body) { config.headers['Content-Type'] = 'application/json'; config.body = JSON.stringify(options.body); }
  const res = await fetch(BASE + path, config);
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch(e) { data = {}; }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export const api = {
  login: (email, pw) => request('/auth/login', { method: 'POST', body: { email, password: pw } }),
  verify2fa: (code) => request('/auth/verify-2fa', { method: 'POST', body: { code } }),
  setup2fa: () => request('/auth/setup-2fa', { method: 'POST' }),
  confirm2fa: (code) => request('/auth/confirm-2fa', { method: 'POST', body: { code } }),
  changePassword: (pw) => request('/auth/change-password', { method: 'POST', body: { newPassword: pw } }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  me: () => request('/auth/me'),
  getTickets: (p) => request('/tickets' + (p ? '?' + new URLSearchParams(p) : '')),
  getRegionTickets: (id) => request('/tickets/region/' + id),
  getMyTickets: () => request('/tickets/my'),
  getTicket: (id) => request('/tickets/' + id),
  claimTicket: (id) => request('/tickets/' + id + '/claim', { method: 'POST' }),
  updateTicket: (id, d) => request('/tickets/' + id, { method: 'PUT', body: d }),
  addMessage: (id, d) => request('/tickets/' + id + '/messages', { method: 'POST', body: d }),
  addNote: (id, d) => request('/tickets/' + id + '/notes', { method: 'POST', body: d }),
  createTicket: (d) => request('/tickets', { method: 'POST', body: d }),
  getRegions: () => request('/regions'),
  getUsers: () => request('/users'),
  getDashboard: () => request('/dashboard'),
  getAuditLog: () => request('/audit'),
  getTags: () => request('/tags').catch(() => ({ tags: [] })),
  getCloseReasons: () => request('/close-reasons').catch(() => ({ reasons: [] })),
  adminGetUsers: () => request('/admin/users'),
  adminCreateUser: (d) => request('/admin/users', { method: 'POST', body: d }),
  adminUpdateUser: (id, d) => request('/admin/users/' + id, { method: 'PUT', body: d }),
  adminDeleteUser: (id) => request('/admin/users/' + id, { method: 'DELETE' }),
  adminReactivateUser: (id) => request('/admin/users/' + id + '/reactivate', { method: 'POST' }),
  adminResetPassword: (id) => request('/admin/users/' + id + '/reset-password', { method: 'POST' }),
  adminSetUserRegions: (id, rids) => request('/admin/users/' + id + '/regions', { method: 'POST', body: { regionIds: rids } }),
  adminGetRegions: () => request('/admin/regions'),
  adminCreateRegion: (d) => request('/admin/regions', { method: 'POST', body: d }),
  adminUpdateRegion: (id, d) => request('/admin/regions/' + id, { method: 'PUT', body: d }),
  adminDeleteRegion: (id) => request('/admin/regions/' + id, { method: 'DELETE' }),
  gmailAuth: () => request('/gmail/auth'),
  gmailStatus: () => request('/gmail/status'),
  gmailDisconnect: () => request('/gmail/disconnect', { method: 'POST' }),
  gmailSync: () => request('/gmail/sync', { method: 'POST' }),
  gmailAutoSync: () => request('/gmail/auto-sync'),
  gmailFilters: () => request('/gmail/filters'),
  gmailAddFilter: (d) => request('/gmail/filters', { method: 'POST', body: d }),
  gmailDeleteFilter: (id) => request('/gmail/filters/' + id, { method: 'DELETE' }),
  gmailAccounts: () => request('/gmail/accounts'),
  gmailPersonal: (f, q, m) => request('/gmail/personal?folder='+(f||'INBOX')+'&q='+encodeURIComponent(q||'')+'&max='+(m||20)),
  gmailPersonalMsg: (id) => request('/gmail/personal/' + id),
  gmailPersonalSend: (d) => request('/gmail/personal/send', { method: 'POST', body: d }),
  calendarEvents: (min, max) => request('/gmail/calendar/events?timeMin='+(min||'')+'&timeMax='+(max||'')),
  calendarCreate: (d) => request('/gmail/calendar/events', { method: 'POST', body: d }),
  calendarDelete: (id) => request('/gmail/calendar/events/' + id, { method: 'DELETE' }),
  driveFiles: (q, fid, pt) => request('/gmail/drive/files?q='+encodeURIComponent(q||'')+(fid?'&folderId='+fid:'')+(pt?'&pageToken='+pt:'')),
  driveShared: () => request('/gmail/drive/shared'),
};
`);

// ═══════════════════════════════════════════════════════════════════════════════
// CLIENT: QueueScreen.jsx — fix infinite loop
// ═══════════════════════════════════════════════════════════════════════════════

const queuePath = path.join(__dirname, 'client', 'src', 'components', 'QueueScreen.jsx');
let queue = fs.readFileSync(queuePath, 'utf8');

// Replace the infinite-looping useCallback + two useEffects
queue = queue.replace(
  /const fetchTickets = useCallback\(async[\s\S]*?\[.*?\]\);/,
  `const fetchTickets = async () => {
    setLoading(true);
    try {
      const params = {};
      if (selectedRegion) params.regionId = selectedRegion;
      if (statusFilter) params.status = statusFilter;
      if (searchQuery) params.q = searchQuery;
      const data = await api.getTickets(params);
      setTickets(data.tickets || data || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  };`
);

// Remove useCallback import if present, remove the interval useEffect
queue = queue.replace(
  /useEffect\(\(\) => \{ fetchTickets\(\); \}, \[fetchTickets\]\);/,
  'useEffect(() => { fetchTickets(); }, []);'
);
queue = queue.replace(
  /\s*useEffect\(\(\) => \{\s*const interval = setInterval\(fetchTickets, \d+\);\s*return \(\) => clearInterval\(interval\);\s*\}, \[fetchTickets\]\);/,
  ''
);
// Remove useCallback from import
queue = queue.replace(', useCallback', '');

fs.writeFileSync(queuePath, queue, 'utf8');
console.log('  ✓ client/src/components/QueueScreen.jsx — fixed loop');

// ═══════════════════════════════════════════════════════════════════════════════
// CLIENT: GmailPanel.jsx — stable
// ═══════════════════════════════════════════════════════════════════════════════

write('client/src/components/GmailPanel.jsx', `import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api';
import Icon from './Icons';

export function GmailConnectButton({ showToast }) {
  const [status, setStatus] = useState({ connected: false, email: null });
  const [loading, setLoading] = useState(true);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; ran.current = true;
    api.gmailStatus().then(s => { setStatus(s); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const connect = async () => {
    const data = await api.gmailAuth();
    window.open(data.authUrl, '_blank', 'width=500,height=600');
    let n = 0;
    const poll = setInterval(async () => {
      if (++n > 60) return clearInterval(poll);
      const s = await api.gmailStatus().catch(() => null);
      if (s && s.connected) { clearInterval(poll); setStatus(s); showToast && showToast('Google Workspace connected!'); }
    }, 2000);
  };

  const disconnect = async () => {
    if (!confirm('Disconnect?')) return;
    await api.gmailDisconnect();
    setStatus({ connected: false, email: null });
    showToast && showToast('Disconnected');
  };

  if (loading) return null;
  if (status.connected) return (
    <div style={{ padding:'8px 12px', background:'#102f54', borderRadius:6, marginBottom:8 }}>
      <div style={{ fontSize:10, color:'#a8c8e8' }}>Google Workspace</div>
      <div style={{ fontSize:11, color:'#fff', fontWeight:500, marginBottom:4 }}>{status.email}</div>
      <button onClick={disconnect} style={{ fontSize:10, color:'#a8c8e8', background:'none', border:'none', cursor:'pointer', textDecoration:'underline', padding:0 }}>Disconnect</button>
    </div>
  );
  return (
    <button onClick={connect} style={{ width:'100%', padding:'8px 12px', background:'#1a5e9a', color:'#fff', border:'none', borderRadius:6, cursor:'pointer', fontSize:11, fontWeight:600, marginBottom:8, display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}>
      <Icon name="mail" size={12} /> Connect Google Workspace
    </button>
  );
}

export function EmailFilterManager({ showToast }) {
  const [filters, setFilters] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [show, setShow] = useState(false);
  const [domain, setDomain] = useState('');
  const [sender, setSender] = useState('');
  const [subj, setSubj] = useState('');
  const [syncing, setSyncing] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; ran.current = true;
    Promise.all([api.gmailFilters().catch(()=>({filters:[]})), api.gmailAccounts().catch(()=>({accounts:[]}))])
      .then(([f, a]) => { setFilters(f.filters||[]); setAccounts(a.accounts||[]); setLoading(false); });
  }, []);

  const syncNow = async () => { setSyncing(true); try { const r = await api.gmailSync(); showToast('Synced '+r.synced+' emails'); } catch(e) { showToast(e.message); } setSyncing(false); };
  const addFilter = async () => {
    if (!domain&&!sender&&!subj) return;
    await api.gmailAddFilter({ domain, sender, subject_contains: subj, action:'personal' });
    setDomain(''); setSender(''); setSubj(''); setShow(false);
    const f = await api.gmailFilters(); setFilters(f.filters||[]); showToast('Rule added');
  };
  const delFilter = async (id) => { await api.gmailDeleteFilter(id); const f = await api.gmailFilters(); setFilters(f.filters||[]); showToast('Rule removed'); };

  const inp = { width:'100%', padding:'8px', background:'#fff', border:'1px solid #c0d0e4', borderRadius:6, fontSize:12, outline:'none', boxSizing:'border-box' };
  const btn = (bg,fg) => ({ padding:'6px 14px', background:bg, color:fg, border:'none', borderRadius:6, cursor:'pointer', fontSize:11, fontWeight:600 });
  const card = { background:'#f0f4f9', border:'1px solid #c0d0e4', borderRadius:10, padding:14, marginBottom:8 };

  if (loading) return <div style={{padding:20,color:'#6b8299'}}>Loading...</div>;
  return (<div>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
      <h3 style={{fontSize:14,fontWeight:600,margin:0}}>Connected Accounts</h3>
      <button onClick={syncNow} disabled={syncing} style={btn('#1a5e9a','#fff')}>{syncing?'Syncing...':'Sync Now'}</button>
    </div>
    {accounts.length===0 && <div style={{...card,color:'#6b8299',fontSize:12}}>No accounts connected.</div>}
    {accounts.map(a => <div key={a.userId} style={{...card,display:'flex',justifyContent:'space-between'}}><div><div style={{fontSize:13,fontWeight:600}}>{a.name}</div><div style={{fontSize:11,color:'#6b8299'}}>{a.email}</div></div><div style={{fontSize:10,color:'#6b8299'}}>{a.lastSync?new Date(a.lastSync).toLocaleString():'Never'}</div></div>)}
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:24,marginBottom:12}}>
      <h3 style={{fontSize:14,fontWeight:600,margin:0}}>Routing Rules (Personal)</h3>
      <button onClick={()=>setShow(!show)} style={btn('#1a5e9a','#fff')}>+ Add Rule</button>
    </div>
    <div style={{fontSize:11,color:'#6b8299',marginBottom:12}}>Matching emails stay in Personal Email. Everything else goes to Regional Queue.</div>
    {show && <div style={{...card}}>
      <div style={{display:'flex',gap:8,marginBottom:8}}>
        <div style={{flex:1}}><div style={{fontSize:10,fontWeight:600,color:'#6b8299',marginBottom:4}}>DOMAIN</div><input value={domain} onChange={e=>setDomain(e.target.value)} style={inp} placeholder="hr.company.com" /></div>
        <div style={{flex:1}}><div style={{fontSize:10,fontWeight:600,color:'#6b8299',marginBottom:4}}>SENDER</div><input value={sender} onChange={e=>setSender(e.target.value)} style={inp} placeholder="noreply@" /></div>
        <div style={{flex:1}}><div style={{fontSize:10,fontWeight:600,color:'#6b8299',marginBottom:4}}>SUBJECT CONTAINS</div><input value={subj} onChange={e=>setSubj(e.target.value)} style={inp} placeholder="All Hands" /></div>
      </div>
      <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
        <button onClick={()=>setShow(false)} style={btn('#f0f4f9','#6b8299')}>Cancel</button>
        <button onClick={addFilter} style={btn('#1a5e9a','#fff')}>Add</button>
      </div>
    </div>}
    {filters.length===0&&!show && <div style={{...card,color:'#6b8299',fontSize:12}}>No rules. All emails route to Regional Queue.</div>}
    {filters.map(f => <div key={f.id} style={{...card,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
      <div style={{fontSize:12}}>{f.domain&&<span>Domain: <b>{f.domain}</b> </span>}{f.sender&&<span>Sender: <b>{f.sender}</b> </span>}{f.subject_contains&&<span>Subject: <b>{f.subject_contains}</b></span>}</div>
      <button onClick={()=>delFilter(f.id)} style={btn('#f0f4f9','#d94040')}>Remove</button>
    </div>)}
  </div>);
}

export default function GmailPanel() { return null; }
`);

// ═══════════════════════════════════════════════════════════════════════════════
// CLIENT: CalendarPanel.jsx — stable
// ═══════════════════════════════════════════════════════════════════════════════

write('client/src/components/CalendarPanel.jsx', `import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api';

export default function CalendarPanel({ showToast }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ summary:'', description:'', date:'', startTime:'09:00', endTime:'10:00', attendees:'', addMeet:false });
  const initRef = useRef(false);

  useEffect(() => {
    if (!initRef.current) {
      initRef.current = true;
      api.gmailStatus().then(s => { setConnected(s.connected); if (s.connected) loadEvents(0); else setLoading(false); }).catch(() => setLoading(false));
    } else if (connected) {
      loadEvents(weekOffset);
    }
  }, [weekOffset]);

  const loadEvents = (wo) => {
    setLoading(true);
    const s = new Date(); s.setDate(s.getDate() + wo * 7); s.setHours(0,0,0,0);
    const e = new Date(s); e.setDate(e.getDate() + 7);
    api.calendarEvents(s.toISOString(), e.toISOString())
      .then(d => setEvents(d.events || []))
      .catch(e => showToast && showToast(e.message))
      .finally(() => setLoading(false));
  };

  const create = async () => {
    if (!form.summary || !form.date) return;
    try {
      const att = form.attendees ? form.attendees.split(',').map(e=>e.trim()).filter(Boolean) : [];
      const r = await api.calendarCreate({ summary:form.summary, description:form.description, startTime:form.date+'T'+form.startTime+':00', endTime:form.date+'T'+form.endTime+':00', attendees:att, addMeet:form.addMeet });
      showToast && showToast('Event created!' + (r.meetLink ? ' Meet link added.' : ''));
      setShowCreate(false); setForm({ summary:'', description:'', date:'', startTime:'09:00', endTime:'10:00', attendees:'', addMeet:false });
      loadEvents(weekOffset);
    } catch(e) { showToast && showToast(e.message); }
  };

  const del = async (id) => { if (!confirm('Delete event?')) return; await api.calendarDelete(id); loadEvents(weekOffset); };

  const inp = { width:'100%', padding:'8px', background:'#f0f4f9', border:'1px solid #c0d0e4', borderRadius:6, fontSize:12, outline:'none', boxSizing:'border-box' };
  const btn = (bg,fg) => ({ padding:'8px 16px', background:bg, color:fg, border:'none', borderRadius:6, cursor:'pointer', fontSize:12, fontWeight:600 });
  const ws = new Date(); ws.setDate(ws.getDate() + weekOffset * 7);
  const wl = ws.toLocaleDateString([],{month:'short',day:'numeric'}) + ' — ' + new Date(ws.getTime()+6*86400000).toLocaleDateString([],{month:'short',day:'numeric'});

  if (!connected) return <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',flexDirection:'column',gap:12}}><h2 style={{fontSize:18,fontWeight:700}}>Calendar</h2><p style={{fontSize:13,color:'#6b8299'}}>Connect Google Workspace to view calendar.</p></div>;

  return (<div style={{display:'flex',flexDirection:'column',height:'100%'}}>
    <div style={{padding:'12px 24px',borderBottom:'1px solid #c0d0e4',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
      <div style={{display:'flex',alignItems:'center',gap:12}}>
        <button onClick={()=>setWeekOffset(w=>w-1)} style={btn('#dde8f2','#1e3a4f')}>◀</button>
        <h2 style={{fontSize:16,fontWeight:700,margin:0}}>{wl}</h2>
        <button onClick={()=>setWeekOffset(w=>w+1)} style={btn('#dde8f2','#1e3a4f')}>▶</button>
        {weekOffset!==0 && <button onClick={()=>setWeekOffset(0)} style={btn('#f0f4f9','#6b8299')}>Today</button>}
      </div>
      <button onClick={()=>setShowCreate(true)} style={btn('#1a5e9a','#fff')}>+ New Event</button>
    </div>
    <div style={{flex:1,overflow:'auto',padding:20}}>
      {loading && <div style={{color:'#6b8299',textAlign:'center',padding:20}}>Loading...</div>}
      {!loading && events.length===0 && <div style={{color:'#6b8299',textAlign:'center',padding:40}}>No events this week</div>}
      {events.map(e => <div key={e.id} style={{padding:14,background:'#f0f4f9',border:'1px solid #c0d0e4',borderRadius:10,marginBottom:8,borderLeft:'4px solid #1a5e9a'}}>
        <div style={{display:'flex',justifyContent:'space-between'}}>
          <div>
            <div style={{fontSize:14,fontWeight:600}}>{e.summary}</div>
            <div style={{fontSize:11,color:'#6b8299',marginTop:2}}>{e.allDay ? new Date(e.start).toLocaleDateString() : new Date(e.start).toLocaleString([],{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+' — '+new Date(e.end).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}</div>
            {e.location && <div style={{fontSize:11,color:'#6b8299',marginTop:2}}>📍 {e.location}</div>}
            {e.meetLink && <a href={e.meetLink} target="_blank" rel="noreferrer" style={{fontSize:11,color:'#1a5e9a',fontWeight:600,textDecoration:'none',display:'inline-block',marginTop:4}}>🎥 Join Meet</a>}
          </div>
          <button onClick={()=>del(e.id)} style={{background:'none',border:'none',color:'#c0d0e4',cursor:'pointer',fontSize:14}}>✕</button>
        </div>
      </div>)}
    </div>
    {showCreate && <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:100}} onClick={()=>setShowCreate(false)}>
      <div style={{background:'#fff',borderRadius:16,padding:24,width:440}} onClick={e=>e.stopPropagation()}>
        <h3 style={{fontSize:16,fontWeight:700,margin:'0 0 16px'}}>New Event</h3>
        <div style={{display:'flex',flexDirection:'column',gap:10}}>
          <input value={form.summary} onChange={e=>setForm({...form,summary:e.target.value})} style={inp} placeholder="Title *" />
          <input type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})} style={inp} />
          <div style={{display:'flex',gap:8}}><input type="time" value={form.startTime} onChange={e=>setForm({...form,startTime:e.target.value})} style={{...inp,flex:1}} /><input type="time" value={form.endTime} onChange={e=>setForm({...form,endTime:e.target.value})} style={{...inp,flex:1}} /></div>
          <textarea value={form.description} onChange={e=>setForm({...form,description:e.target.value})} rows={2} style={{...inp,resize:'vertical'}} placeholder="Description" />
          <input value={form.attendees} onChange={e=>setForm({...form,attendees:e.target.value})} style={inp} placeholder="Attendees (comma-separated emails)" />
          <label style={{display:'flex',alignItems:'center',gap:8,fontSize:12,cursor:'pointer'}}><input type="checkbox" checked={form.addMeet} onChange={e=>setForm({...form,addMeet:e.target.checked})} />Add Google Meet</label>
        </div>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:16}}>
          <button onClick={()=>setShowCreate(false)} style={btn('#f0f4f9','#6b8299')}>Cancel</button>
          <button onClick={create} style={btn('#1a5e9a','#fff')}>Create</button>
        </div>
      </div>
    </div>}
  </div>);
}
`);

// ═══════════════════════════════════════════════════════════════════════════════
// CLIENT: DrivePanel.jsx — stable
// ═══════════════════════════════════════════════════════════════════════════════

write('client/src/components/DrivePanel.jsx', `import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api';

export default function DrivePanel({ showToast }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [search, setSearch] = useState('');
  const [stack, setStack] = useState([{ id: null, name: 'My Drive' }]);
  const [view, setView] = useState('my');
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; ran.current = true;
    api.gmailStatus().then(s => { setConnected(s.connected); if (s.connected) load(); else setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const load = (fid, q) => { setLoading(true); api.driveFiles(q||'', fid||null).then(d => setFiles(d.files||[])).catch(() => {}).finally(() => setLoading(false)); };
  const loadShared = () => { setLoading(true); api.driveShared().then(d => setFiles(d.files||[])).catch(() => {}).finally(() => setLoading(false)); };
  const openFolder = f => { setStack(s => [...s, { id: f.id, name: f.name }]); load(f.id); };
  const goBack = i => { const ns = stack.slice(0, i+1); setStack(ns); load(ns[ns.length-1].id); };
  const switchView = v => { setView(v); if (v==='my') { setStack([{id:null,name:'My Drive'}]); load(); } else loadShared(); };
  const doSearch = e => { e.preventDefault(); if(search) { setView('search'); load(null,search); } };
  const icon = m => { if(m==='application/vnd.google-apps.folder') return '📁'; if(m?.includes('spreadsheet')) return '📊'; if(m?.includes('document')) return '📄'; if(m?.includes('pdf')) return '📕'; if(m?.includes('image')) return '🖼️'; return '📎'; };
  const fmt = b => { if(!b) return ''; if(b<1024) return b+' B'; if(b<1048576) return (b/1024).toFixed(1)+' KB'; return (b/1048576).toFixed(1)+' MB'; };
  const btn = (bg,fg) => ({ padding:'8px 16px', background:bg, color:fg, border:'none', borderRadius:6, cursor:'pointer', fontSize:12, fontWeight:600 });
  const tab = a => ({ padding:'8px 16px', background:a?'#1a5e9a':'transparent', color:a?'#fff':'#1e3a4f', border:'none', borderRadius:6, cursor:'pointer', fontSize:12, fontWeight:a?600:400 });
  const inp = { width:'100%', padding:'8px', background:'#f0f4f9', border:'1px solid #c0d0e4', borderRadius:6, fontSize:12, outline:'none', boxSizing:'border-box' };

  if (!connected) return <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',flexDirection:'column',gap:12}}><h2 style={{fontSize:18,fontWeight:700}}>Google Drive</h2><p style={{fontSize:13,color:'#6b8299'}}>Connect Google Workspace to browse files.</p></div>;

  return (<div style={{display:'flex',flexDirection:'column',height:'100%'}}>
    <div style={{padding:'12px 24px',borderBottom:'1px solid #c0d0e4'}}>
      <div style={{display:'flex',gap:4,marginBottom:8}}><button onClick={()=>switchView('my')} style={tab(view==='my')}>My Drive</button><button onClick={()=>switchView('shared')} style={tab(view==='shared')}>Shared</button></div>
      <form onSubmit={doSearch} style={{display:'flex',gap:8}}><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search files..." style={{...inp,flex:1}} /><button type="submit" style={btn('#dde8f2','#1e3a4f')}>Search</button></form>
    </div>
    {view==='my' && stack.length>1 && <div style={{padding:'6px 24px',background:'#f0f4f9',borderBottom:'1px solid #c0d0e4',display:'flex',gap:4,fontSize:12}}>
      {stack.map((f,i) => <span key={i}>{i>0&&<span style={{margin:'0 4px',color:'#c0d0e4'}}>/</span>}<button onClick={()=>goBack(i)} style={{background:'none',border:'none',cursor:'pointer',color:i===stack.length-1?'#1e3a4f':'#1a5e9a',fontWeight:i===stack.length-1?600:400,fontSize:12}}>{f.name}</button></span>)}
    </div>}
    <div style={{flex:1,overflow:'auto',padding:16}}>
      {loading && <div style={{color:'#6b8299',textAlign:'center',padding:20}}>Loading...</div>}
      {!loading && files.length===0 && <div style={{color:'#6b8299',textAlign:'center',padding:40}}>No files</div>}
      {files.map(f => <div key={f.id} onClick={()=>f.isFolder?openFolder(f):window.open(f.webViewLink,'_blank')} style={{display:'flex',alignItems:'center',gap:12,padding:'10px 14px',borderBottom:'1px solid #e8f0f8',cursor:'pointer',borderRadius:6}} onMouseEnter={e=>e.currentTarget.style.background='#f0f4f9'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
        <span style={{fontSize:20}}>{icon(f.mimeType)}</span>
        <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{f.name}</div><div style={{fontSize:10,color:'#6b8299'}}>{f.modifiedTime&&new Date(f.modifiedTime).toLocaleDateString()}{f.size?' · '+fmt(f.size):''}{f.shared?' · Shared':''}</div></div>
      </div>)}
    </div>
  </div>);
}
`);

// ═══════════════════════════════════════════════════════════════════════════════
// CLIENT: PersonalInbox.jsx — stable
// ═══════════════════════════════════════════════════════════════════════════════

write('client/src/components/PersonalInbox.jsx', `import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api';
import Icon from './Icons';

const FOLDERS = [
  { key:'INBOX', label:'Inbox', icon:'inbox' },
  { key:'STARRED', label:'Starred', icon:'star' },
  { key:'SENT', label:'Sent', icon:'send' },
  { key:'DRAFT', label:'Drafts', icon:'file' },
  { key:'ALL', label:'All Mail', icon:'mail' },
];

export default function PersonalInbox({ showToast }) {
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [folder, setFolder] = useState('INBOX');
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [search, setSearch] = useState('');
  const [showCompose, setShowCompose] = useState(false);
  const [compose, setCompose] = useState({ to:'', cc:'', subject:'', body:'' });
  const [sending, setSending] = useState(false);
  const [showReply, setShowReply] = useState(false);
  const [replyBody, setReplyBody] = useState('');
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; ran.current = true;
    api.gmailStatus().then(s => { setConnected(s.connected); if (s.connected) fetchMsgs('INBOX'); else setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const fetchMsgs = (f, q) => { setLoading(true); api.gmailPersonal(f||folder, q||'').then(d => setMessages(d.messages||[])).catch(e => showToast&&showToast(e.message)).finally(() => setLoading(false)); };
  const switchFolder = f => { setFolder(f.key); setSelected(null); setDetail(null); fetchMsgs(f.key); };
  const openMsg = async m => { setSelected(m); setShowReply(false); try { const d = await api.gmailPersonalMsg(m.id); setDetail(d); setMessages(prev=>prev.map(x=>x.id===m.id?{...x,isUnread:false}:x)); } catch(e) { showToast&&showToast(e.message); } };
  const sendReply = async () => { if(!replyBody.trim()||!detail) return; setSending(true); try { await api.gmailPersonalSend({to:detail.from,subject:'Re: '+(detail.subject||''),body:replyBody,threadId:detail.threadId}); showToast&&showToast('Sent!'); setShowReply(false); setReplyBody(''); } catch(e){showToast&&showToast(e.message);} setSending(false); };
  const sendCompose = async () => { if(!compose.to||!compose.body) return; setSending(true); try { await api.gmailPersonalSend(compose); showToast&&showToast('Sent!'); setShowCompose(false); setCompose({to:'',cc:'',subject:'',body:''}); } catch(e){showToast&&showToast(e.message);} setSending(false); };

  const inp = { width:'100%', padding:'8px', background:'#f0f4f9', border:'1px solid #c0d0e4', borderRadius:6, fontSize:12, outline:'none', boxSizing:'border-box' };
  const btn = (bg,fg) => ({ padding:'8px 14px', background:bg, color:fg, border:'none', borderRadius:6, cursor:'pointer', fontSize:12, fontWeight:600 });

  if (!connected) return <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',flexDirection:'column',gap:12}}><h2 style={{fontSize:18,fontWeight:700}}>Personal Email</h2><p style={{fontSize:13,color:'#6b8299'}}>Connect Google Workspace to view email.</p></div>;

  return (<div style={{display:'flex',height:'100%'}}>
    <div style={{width:170,background:'#f0f4f9',borderRight:'1px solid #c0d0e4',flexShrink:0,display:'flex',flexDirection:'column'}}>
      <div style={{padding:10}}><button onClick={()=>setShowCompose(true)} style={{...btn('#1a5e9a','#fff'),width:'100%'}}>Compose</button></div>
      {FOLDERS.map(f => <button key={f.key} onClick={()=>switchFolder(f)} style={{width:'100%',display:'flex',alignItems:'center',gap:8,padding:'8px 14px',background:folder===f.key?'#dde8f2':'transparent',border:'none',cursor:'pointer',color:folder===f.key?'#1a5e9a':'#1e3a4f',fontSize:12,fontWeight:folder===f.key?600:400,textAlign:'left'}}><Icon name={f.icon} size={14}/> {f.label}</button>)}
      <div style={{flex:1}} />
      <div style={{padding:10,borderTop:'1px solid #c0d0e4',fontSize:10,color:'#6b8299'}}>Full Gmail inbox. Care emails also appear in Regional Queue.</div>
    </div>
    <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
      <div style={{padding:'8px 14px',borderBottom:'1px solid #c0d0e4',display:'flex',gap:8}}>
        <form onSubmit={e=>{e.preventDefault();fetchMsgs(folder,search);}} style={{display:'flex',gap:8,flex:1}}><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search..." style={{...inp,flex:1}} /><button type="submit" style={btn('#dde8f2','#1e3a4f')}>Search</button></form>
        <button onClick={()=>fetchMsgs(folder)} style={btn('#dde8f2','#1e3a4f')}>Refresh</button>
      </div>
      <div style={{flex:1,display:'flex',overflow:'hidden'}}>
        <div style={{width:selected?'35%':'100%',overflow:'auto',borderRight:selected?'1px solid #c0d0e4':'none'}}>
          {loading && <div style={{padding:20,color:'#6b8299',textAlign:'center'}}>Loading...</div>}
          {!loading&&messages.length===0 && <div style={{padding:40,color:'#6b8299',textAlign:'center'}}>Empty</div>}
          {messages.map(m => <div key={m.id} onClick={()=>openMsg(m)} style={{padding:'10px 14px',borderBottom:'1px solid #e8f0f8',cursor:'pointer',background:selected?.id===m.id?'#dde8f2':m.isUnread?'#f0f4f9':'#fff'}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:1}}><span style={{fontSize:12,fontWeight:m.isUnread?700:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:'70%'}}>{m.from?.replace(/<.*>/,'').trim()}</span><span style={{fontSize:10,color:'#6b8299'}}>{new Date(m.date).toLocaleDateString()}</span></div>
            <div style={{fontSize:12,fontWeight:m.isUnread?600:400,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{m.subject}</div>
            <div style={{fontSize:11,color:'#6b8299',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{m.snippet}</div>
          </div>)}
        </div>
        {selected && detail && <div style={{flex:1,overflow:'auto',padding:20}}>
          <div style={{display:'flex',justifyContent:'space-between',marginBottom:12}}>
            <h3 style={{fontSize:15,fontWeight:700,margin:0}}>{detail.subject}</h3>
            <button onClick={()=>{setSelected(null);setDetail(null);}} style={{background:'none',border:'none',cursor:'pointer',color:'#6b8299',fontSize:16}}>✕</button>
          </div>
          <div style={{fontSize:12,color:'#6b8299',marginBottom:4}}>From: {detail.from}</div>
          <div style={{fontSize:12,color:'#6b8299',marginBottom:12}}>To: {detail.to} · {new Date(detail.date).toLocaleString()}</div>
          <div style={{fontSize:13,lineHeight:1.6,padding:14,background:'#f0f4f9',borderRadius:8,wordBreak:'break-word'}} dangerouslySetInnerHTML={{__html:detail.body}} />
          {!showReply ? <button onClick={()=>setShowReply(true)} style={{...btn('#1a5e9a','#fff'),marginTop:12}}>Reply</button> :
          <div style={{marginTop:12,padding:14,border:'1px solid #c0d0e4',borderRadius:8}}>
            <textarea value={replyBody} onChange={e=>setReplyBody(e.target.value)} rows={5} style={{...inp,resize:'vertical'}} placeholder="Type reply..." autoFocus />
            <div style={{display:'flex',gap:8,marginTop:8}}><button onClick={sendReply} disabled={sending} style={btn('#1a5e9a','#fff')}>{sending?'Sending...':'Send'}</button><button onClick={()=>{setShowReply(false);setReplyBody('');}} style={btn('#f0f4f9','#6b8299')}>Cancel</button></div>
          </div>}
        </div>}
      </div>
    </div>
    {showCompose && <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:100}} onClick={()=>setShowCompose(false)}>
      <div style={{background:'#fff',borderRadius:16,padding:24,width:480}} onClick={e=>e.stopPropagation()}>
        <h3 style={{fontSize:16,fontWeight:700,margin:'0 0 16px'}}>New Email</h3>
        <div style={{display:'flex',flexDirection:'column',gap:10}}>
          <input value={compose.to} onChange={e=>setCompose({...compose,to:e.target.value})} style={inp} placeholder="To *" />
          <input value={compose.cc} onChange={e=>setCompose({...compose,cc:e.target.value})} style={inp} placeholder="Cc" />
          <input value={compose.subject} onChange={e=>setCompose({...compose,subject:e.target.value})} style={inp} placeholder="Subject" />
          <textarea value={compose.body} onChange={e=>setCompose({...compose,body:e.target.value})} rows={6} style={{...inp,resize:'vertical'}} placeholder="Message *" />
        </div>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:16}}>
          <button onClick={()=>setShowCompose(false)} style={btn('#f0f4f9','#6b8299')}>Cancel</button>
          <button onClick={sendCompose} disabled={sending} style={btn('#1a5e9a','#fff')}>{sending?'Sending...':'Send'}</button>
        </div>
      </div>
    </div>}
  </div>);
}
`);

// ═══════════════════════════════════════════════════════════════════════════════
// CLIENT: App.jsx — add workspace nav items + connect button
// ═══════════════════════════════════════════════════════════════════════════════

const appPath = path.join(__dirname, 'client', 'src', 'App.jsx');
let app = fs.readFileSync(appPath, 'utf8');

// Add imports if missing
if (!app.includes('CalendarPanel')) app = app.replace("import ComposeModal from './components/ComposeModal';", "import ComposeModal from './components/ComposeModal';\nimport CalendarPanel from './components/CalendarPanel';\nimport DrivePanel from './components/DrivePanel';\nimport PersonalInbox from './components/PersonalInbox';");
if (!app.includes('GmailConnectButton')) app = app.replace("import PersonalInbox from './components/PersonalInbox';", "import PersonalInbox from './components/PersonalInbox';\nimport { GmailConnectButton } from './components/GmailPanel';");

// Add nav items if missing
if (!app.includes("'personalEmail'")) {
  app = app.replace(
    "...(currentUser.role === 'admin' ? [{ key: 'admin', icon: 'settings', label: 'Admin' }] : []),",
    "{ key: 'personalEmail', icon: 'mail', label: 'Email' },\n            { key: 'calendar', icon: 'clock', label: 'Calendar' },\n            { key: 'drive', icon: 'file', label: 'Drive' },\n            ...(currentUser.role === 'admin' ? [{ key: 'admin', icon: 'settings', label: 'Admin' }] : []),"
  );
}

// Add screen renders if missing
if (!app.includes("screen === 'personalEmail'")) {
  app = app.replace("{screen === 'admin'", `{screen === 'personalEmail' && <PersonalInbox currentUser={currentUser} showToast={showToast} />}
        {screen === 'calendar' && <CalendarPanel currentUser={currentUser} showToast={showToast} />}
        {screen === 'drive' && <DrivePanel currentUser={currentUser} showToast={showToast} />}
        {screen === 'admin'`);
}

// Add connect button if missing
if (!app.includes('<GmailConnectButton')) {
  app = app.replace(
    "<div style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#ffffff' }}>{currentUser.name}</div>",
    "{!sidebarCollapsed && <GmailConnectButton showToast={showToast} />}\n                <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#ffffff' }}>{currentUser.name}</div>"
  );
}

// Remove any leftover useEmailSync
app = app.replace(/\n\/\/ Background email sync\nfunction useEmailSync[\s\S]*?\n\}/, '');
app = app.replace('useEmailSync(!!currentUser);\n  ', '');

fs.writeFileSync(appPath, app, 'utf8');
console.log('  ✓ client/src/App.jsx — workspace tabs + connect button');

// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n✅ REBUILD COMPLETE!\n');
console.log('Now run:');
console.log('  del server\\carecoord.db');
console.log('  npm run seed');
console.log('  npm run dev\n');
console.log('Login: tadkins@carecoord.org / Seniority2024!\n');
