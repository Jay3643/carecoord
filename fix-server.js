// fix-server.js
// Run this from the carecoord folder: node fix-server.js
// It rewrites the server files to use sql.js instead of better-sqlite3

const fs = require('fs');
const path = require('path');

function writeFile(relativePath, content) {
  const fullPath = path.join(__dirname, relativePath);
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');
  console.log('  ✓ ' + relativePath);
}

console.log('\n🔧 Fixing CareCoord server for sql.js...\n');

// Delete old database if exists
const dbPath = path.join(__dirname, 'server', 'carecoord.db');
if (fs.existsSync(dbPath)) {
  fs.unlinkSync(dbPath);
  console.log('  ✓ Deleted old carecoord.db');
}

// ─── database.js ─────────────────────────────────────────────────────────────

writeFile('server/database.js', `const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'carecoord.db');

let db = null;

function wrapStatement(stmt, rawDb) {
  return {
    run(...params) {
      rawDb.run(stmt, params);
      return { changes: rawDb.getRowsModified() };
    },
    get(...params) {
      let result = null;
      const s = rawDb.prepare(stmt);
      if (params.length > 0) s.bind(params);
      if (s.step()) result = s.getAsObject();
      s.free();
      return result;
    },
    all(...params) {
      const results = [];
      const s = rawDb.prepare(stmt);
      if (params.length > 0) s.bind(params);
      while (s.step()) results.push(s.getAsObject());
      s.free();
      return results;
    }
  };
}

function wrapDb(rawDb) {
  return {
    prepare(sql) { return wrapStatement(sql, rawDb); },
    exec(sql) { rawDb.exec(sql); },
    _raw: rawDb,
  };
}

async function initDb() {
  if (db) return db;
  const SQL = await initSqlJs();
  let rawDb;
  if (fs.existsSync(DB_PATH)) {
    rawDb = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    rawDb = new SQL.Database();
  }
  rawDb.exec('PRAGMA foreign_keys = ON;');
  db = wrapDb(rawDb);
  initSchema();
  return db;
}

function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}

function saveDb() {
  if (db && db._raw) {
    fs.writeFileSync(DB_PATH, Buffer.from(db._raw.export()));
  }
}

function initSchema() {
  db.exec(\`
    CREATE TABLE IF NOT EXISTS regions (
      id TEXT PRIMARY KEY, name TEXT NOT NULL,
      routing_aliases TEXT DEFAULT '[]', is_active INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL CHECK(role IN ('coordinator','supervisor','admin')),
      avatar TEXT, is_active INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS user_regions (
      user_id TEXT NOT NULL REFERENCES users(id),
      region_id TEXT NOT NULL REFERENCES regions(id),
      PRIMARY KEY (user_id, region_id)
    );
    CREATE TABLE IF NOT EXISTS close_reasons (
      id TEXT PRIMARY KEY, label TEXT NOT NULL,
      scope TEXT DEFAULT 'global', requires_comment INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY, name TEXT NOT NULL,
      color TEXT DEFAULT '#6366f1', scope TEXT DEFAULT 'global'
    );
    CREATE TABLE IF NOT EXISTS tickets (
      id TEXT PRIMARY KEY,
      region_id TEXT NOT NULL REFERENCES regions(id),
      status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','WAITING_ON_EXTERNAL','CLOSED')),
      assignee_user_id TEXT REFERENCES users(id),
      subject TEXT NOT NULL,
      external_participants TEXT DEFAULT '[]',
      last_activity_at INTEGER NOT NULL, created_at INTEGER NOT NULL,
      closed_at INTEGER, close_reason_id TEXT REFERENCES close_reasons(id),
      locked_closed INTEGER DEFAULT 0, has_unread INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS ticket_tags (
      ticket_id TEXT NOT NULL REFERENCES tickets(id),
      tag_id TEXT NOT NULL REFERENCES tags(id),
      PRIMARY KEY (ticket_id, tag_id)
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL REFERENCES tickets(id),
      direction TEXT NOT NULL CHECK(direction IN ('inbound','outbound')),
      channel TEXT DEFAULT 'email', from_address TEXT,
      to_addresses TEXT DEFAULT '[]', cc_addresses TEXT DEFAULT '[]',
      subject TEXT, body_text TEXT, body_html TEXT, sent_at INTEGER,
      provider_message_id TEXT, in_reply_to TEXT,
      reference_ids TEXT DEFAULT '[]', raw_source_uri TEXT,
      created_by_user_id TEXT REFERENCES users(id),
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES messages(id),
      filename TEXT NOT NULL, mime_type TEXT, size_bytes INTEGER,
      storage_uri TEXT, checksum TEXT
    );
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL REFERENCES tickets(id),
      author_user_id TEXT NOT NULL REFERENCES users(id),
      body TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY, actor_user_id TEXT,
      action_type TEXT NOT NULL, entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL, ts INTEGER NOT NULL,
      detail TEXT, before_json TEXT, after_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tickets_region ON tickets(region_id);
    CREATE INDEX IF NOT EXISTS idx_tickets_assignee ON tickets(assignee_user_id);
    CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
    CREATE INDEX IF NOT EXISTS idx_tickets_last_activity ON tickets(last_activity_at DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_ticket ON messages(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_messages_sent ON messages(sent_at);
    CREATE INDEX IF NOT EXISTS idx_notes_ticket ON notes(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);
  \`);
  saveDb();
}

function closeDb() {
  if (db && db._raw) { saveDb(); db._raw.close(); db = null; }
}

module.exports = { initDb, getDb, closeDb, saveDb, DB_PATH };
`);

// ─── middleware.js ────────────────────────────────────────────────────────────

writeFile('server/middleware.js', `const { getDb, saveDb } = require('./database');

function requireAuth(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'Not authenticated' });
  const db = getDb();
  const user = db.prepare(
    'SELECT u.*, GROUP_CONCAT(ur.region_id) as region_ids FROM users u LEFT JOIN user_regions ur ON ur.user_id = u.id WHERE u.id = ? AND u.is_active = 1 GROUP BY u.id'
  ).get(req.session.userId);
  if (!user) return res.status(401).json({ error: 'User not found' });
  user.regionIds = user.region_ids ? user.region_ids.split(',') : [];
  delete user.region_ids;
  req.user = user;
  next();
}

function requireSupervisor(req, res, next) {
  if (!req.user || (req.user.role !== 'supervisor' && req.user.role !== 'admin'))
    return res.status(403).json({ error: 'Supervisor access required' });
  next();
}

function addAudit(db, actorUserId, actionType, entityType, entityId, detail, beforeJson, afterJson) {
  const { v4: uuid } = require('uuid');
  db.prepare('INSERT INTO audit_log (id, actor_user_id, action_type, entity_type, entity_id, ts, detail, before_json, after_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(uuid(), actorUserId, actionType, entityType, entityId, Date.now(), detail, beforeJson || null, afterJson || null);
  saveDb();
}

module.exports = { requireAuth, requireSupervisor, addAudit };
`);

// ─── index.js ────────────────────────────────────────────────────────────────

writeFile('server/index.js', `const express = require('express');
const session = require('express-session');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const { initDb, closeDb } = require('./database');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'],
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(morgan('dev'));
app.use(session({
  secret: process.env.SESSION_SECRET || 'carecoord-dev-secret-change-in-production',
  resave: false, saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, maxAge: 24*60*60*1000, sameSite: 'lax' },
}));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/tickets', require('./routes/tickets'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/ref', require('./routes/ref'));
app.use('/api/audit', require('./routes/audit'));
app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: Date.now() }));

const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) res.sendFile(path.join(clientDist, 'index.html'));
});

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

initDb().then(() => {
  app.listen(PORT, () => {
    console.log('\\n🏥 CareCoord server running on http://localhost:' + PORT);
    console.log('   API: http://localhost:' + PORT + '/api/health\\n');
  });
}).catch(err => { console.error('Failed to init DB:', err); process.exit(1); });

process.on('SIGINT', () => { closeDb(); process.exit(0); });
`);

// ─── routes/tickets.js ───────────────────────────────────────────────────────

writeFile('server/routes/tickets.js', `const express = require('express');
const { v4: uuid } = require('uuid');
const { getDb, saveDb } = require('../database');
const { requireAuth, requireSupervisor, addAudit } = require('../middleware');
const router = express.Router();

function enrichTicket(db, ticket) {
  if (!ticket) return null;
  ticket.external_participants = JSON.parse(ticket.external_participants || '[]');
  const tags = db.prepare('SELECT t.* FROM tags t JOIN ticket_tags tt ON tt.tag_id = t.id WHERE tt.ticket_id = ?').all(ticket.id);
  ticket.tags = tags;
  ticket.tagIds = tags.map(t => t.id);
  if (ticket.assignee_user_id)
    ticket.assignee = db.prepare('SELECT id, name, email, role, avatar FROM users WHERE id = ?').get(ticket.assignee_user_id);
  ticket.region = db.prepare('SELECT id, name FROM regions WHERE id = ?').get(ticket.region_id);
  return ticket;
}

router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const { queue, region, status, search } = req.query;
  let where = [], params = [];
  if (queue === 'personal') { where.push('t.assignee_user_id = ?'); params.push(req.user.id); }
  else { const ph = req.user.regionIds.map(() => '?').join(','); where.push('t.region_id IN (' + ph + ')'); params.push(...req.user.regionIds); }
  if (region && region !== 'all') { where.push('t.region_id = ?'); params.push(region); }
  if (status === 'unassigned') { where.push("t.assignee_user_id IS NULL AND t.status != ?"); params.push('CLOSED'); }
  else if (status === 'open') where.push("t.status = 'OPEN'");
  else if (status === 'waiting') where.push("t.status = 'WAITING_ON_EXTERNAL'");
  else if (status === 'closed') where.push("t.status = 'CLOSED'");
  else where.push("t.status != 'CLOSED'");
  if (search) { where.push('(t.subject LIKE ? OR t.external_participants LIKE ? OR t.id LIKE ?)'); const q = '%' + search + '%'; params.push(q, q, q); }
  const wc = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const tickets = db.prepare('SELECT t.* FROM tickets t ' + wc + ' ORDER BY t.last_activity_at DESC').all(...params);
  res.json({ tickets: tickets.map(t => enrichTicket(db, t)) });
});

router.get('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Not found' });
  res.json({ ticket: enrichTicket(db, ticket) });
});

router.get('/:id/messages', requireAuth, (req, res) => {
  const db = getDb();
  const messages = db.prepare('SELECT * FROM messages WHERE ticket_id = ? ORDER BY sent_at ASC').all(req.params.id);
  messages.forEach(m => {
    m.to_addresses = JSON.parse(m.to_addresses || '[]');
    m.cc_addresses = JSON.parse(m.cc_addresses || '[]');
    m.reference_ids = JSON.parse(m.reference_ids || '[]');
    if (m.created_by_user_id) m.sender = db.prepare('SELECT id, name, email, avatar FROM users WHERE id = ?').get(m.created_by_user_id);
  });
  res.json({ messages });
});

router.get('/:id/notes', requireAuth, (req, res) => {
  const db = getDb();
  const notes = db.prepare('SELECT n.*, u.name as author_name, u.avatar as author_avatar FROM notes n JOIN users u ON u.id = n.author_user_id WHERE n.ticket_id = ? ORDER BY n.created_at ASC').all(req.params.id);
  res.json({ notes });
});

router.post('/:id/assign', requireAuth, (req, res) => {
  const db = getDb();
  const { userId } = req.body;
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Not found' });
  if (req.user.role === 'coordinator' && userId && userId !== req.user.id)
    return res.status(403).json({ error: 'Coordinators can only assign to themselves' });
  db.prepare('UPDATE tickets SET assignee_user_id = ?, last_activity_at = ? WHERE id = ?').run(userId || null, Date.now(), req.params.id);
  saveDb();
  const assignee = userId ? db.prepare('SELECT name FROM users WHERE id = ?').get(userId) : null;
  addAudit(db, req.user.id, 'assignee_changed', 'ticket', req.params.id, userId ? 'Assigned to ' + assignee.name : 'Unassigned / returned to queue');
  res.json({ ticket: enrichTicket(db, db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id)) });
});

router.post('/:id/status', requireAuth, (req, res) => {
  const db = getDb();
  const { status, closeReasonId } = req.body;
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Not found' });
  if (!['OPEN', 'WAITING_ON_EXTERNAL', 'CLOSED'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  if (ticket.status === 'CLOSED' && status !== 'CLOSED' && req.user.role === 'coordinator')
    return res.status(403).json({ error: 'Supervisor override required to reopen' });
  db.prepare('UPDATE tickets SET status = ?, last_activity_at = ?, closed_at = ?, close_reason_id = ?, locked_closed = ? WHERE id = ?')
    .run(status, Date.now(), status === 'CLOSED' ? Date.now() : null, closeReasonId || null, status === 'CLOSED' ? 1 : 0, req.params.id);
  saveDb();
  addAudit(db, req.user.id, 'status_changed', 'ticket', req.params.id, 'Status -> ' + status);
  res.json({ ticket: enrichTicket(db, db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id)) });
});

router.post('/:id/reply', requireAuth, (req, res) => {
  const db = getDb();
  const { body } = req.body;
  if (!body?.trim()) return res.status(400).json({ error: 'Body required' });
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Not found' });
  const region = db.prepare('SELECT * FROM regions WHERE id = ?').get(ticket.region_id);
  const aliases = JSON.parse(region.routing_aliases || '[]');
  const fromAddr = aliases[0] || 'intake@carecoord.org';
  const extP = JSON.parse(ticket.external_participants || '[]');
  const lastIn = db.prepare("SELECT * FROM messages WHERE ticket_id = ? AND direction = 'inbound' ORDER BY sent_at DESC LIMIT 1").get(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const fullBody = body + '\\n\\n—\\n' + user.name + '\\nCare Coordinator — ' + region.name + '\\n' + user.email;
  const msgId = uuid();
  const refs = lastIn ? JSON.parse(lastIn.reference_ids || '[]').concat(lastIn.provider_message_id) : [];
  db.prepare('INSERT INTO messages (id, ticket_id, direction, channel, from_address, to_addresses, subject, body_text, sent_at, provider_message_id, in_reply_to, reference_ids, created_by_user_id, created_at) VALUES (?, ?, \\'outbound\\', \\'email\\', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(msgId, req.params.id, fromAddr, JSON.stringify(extP), 'Re: ' + ticket.subject, fullBody, Date.now(), 'msg-int-' + Date.now(), lastIn?.provider_message_id || null, JSON.stringify(refs), req.user.id, Date.now());
  db.prepare("UPDATE tickets SET status = 'WAITING_ON_EXTERNAL', last_activity_at = ?, has_unread = 0 WHERE id = ?").run(Date.now(), req.params.id);
  saveDb();
  addAudit(db, req.user.id, 'outbound_sent', 'message', msgId, 'Reply sent to ' + extP[0]);
  const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(msgId);
  message.to_addresses = JSON.parse(message.to_addresses);
  message.reference_ids = JSON.parse(message.reference_ids);
  res.json({ message });
});

router.post('/:id/notes', requireAuth, (req, res) => {
  const db = getDb();
  const { body } = req.body;
  if (!body?.trim()) return res.status(400).json({ error: 'Body required' });
  const noteId = uuid();
  db.prepare('INSERT INTO notes (id, ticket_id, author_user_id, body, created_at) VALUES (?, ?, ?, ?, ?)').run(noteId, req.params.id, req.user.id, body, Date.now());
  db.prepare('UPDATE tickets SET last_activity_at = ? WHERE id = ?').run(Date.now(), req.params.id);
  saveDb();
  addAudit(db, req.user.id, 'note_added', 'note', noteId, 'Internal note added');
  res.json({ note: db.prepare('SELECT n.*, u.name as author_name, u.avatar as author_avatar FROM notes n JOIN users u ON u.id = n.author_user_id WHERE n.id = ?').get(noteId) });
});

router.post('/:id/tags', requireAuth, (req, res) => {
  const db = getDb();
  try { db.prepare('INSERT OR IGNORE INTO ticket_tags (ticket_id, tag_id) VALUES (?, ?)').run(req.params.id, req.body.tagId); saveDb(); } catch(e) {}
  res.json({ ticket: enrichTicket(db, db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id)) });
});

router.delete('/:id/tags/:tagId', requireAuth, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM ticket_tags WHERE ticket_id = ? AND tag_id = ?').run(req.params.id, req.params.tagId);
  saveDb();
  res.json({ ticket: enrichTicket(db, db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id)) });
});

router.post('/:id/region', requireAuth, (req, res) => {
  const db = getDb();
  const region = db.prepare('SELECT * FROM regions WHERE id = ?').get(req.body.regionId);
  if (!region) return res.status(404).json({ error: 'Region not found' });
  db.prepare('UPDATE tickets SET region_id = ?, assignee_user_id = NULL, last_activity_at = ? WHERE id = ?').run(req.body.regionId, Date.now(), req.params.id);
  saveDb();
  addAudit(db, req.user.id, 'region_changed', 'ticket', req.params.id, 'Region -> ' + region.name);
  res.json({ ticket: enrichTicket(db, db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id)) });
});

router.post('/bulk/reassign', requireAuth, requireSupervisor, (req, res) => {
  const db = getDb();
  const { fromUserId, toUserId } = req.body;
  const affected = db.prepare("SELECT id FROM tickets WHERE assignee_user_id = ? AND status != 'CLOSED'").all(fromUserId);
  db.prepare("UPDATE tickets SET assignee_user_id = ?, last_activity_at = ? WHERE assignee_user_id = ? AND status != 'CLOSED'").run(toUserId || null, Date.now(), fromUserId);
  saveDb();
  const fromUser = db.prepare('SELECT name FROM users WHERE id = ?').get(fromUserId);
  const toUser = toUserId ? db.prepare('SELECT name FROM users WHERE id = ?').get(toUserId) : null;
  addAudit(db, req.user.id, 'bulk_reassign', 'user', fromUserId, affected.length + ' tickets from ' + fromUser.name + ' -> ' + (toUser ? toUser.name : 'region queue'));
  res.json({ reassigned: affected.length });
});

module.exports = router;
`);

// ─── seed.js ─────────────────────────────────────────────────────────────────

writeFile('server/seed.js', `const { initDb, closeDb, saveDb } = require('./database');

const now = Date.now();
const h = (hrs) => now - hrs * 3600000;
const d = (days) => now - days * 86400000;

async function seed() {
  const db = await initDb();

  db.exec('DELETE FROM audit_log; DELETE FROM ticket_tags; DELETE FROM attachments; DELETE FROM notes; DELETE FROM messages; DELETE FROM tickets; DELETE FROM user_regions; DELETE FROM users; DELETE FROM tags; DELETE FROM close_reasons; DELETE FROM regions;');

  const ins = (sql) => db.prepare(sql);

  // Regions
  const iR = ins('INSERT INTO regions (id, name, routing_aliases, is_active) VALUES (?, ?, ?, ?)');
  [['r1','Central PA','["centralpa@carecoord.org"]',1],['r2','Western PA','["westernpa@carecoord.org"]',1],['r3','Eastern PA','["easternpa@carecoord.org"]',1],['r4','Triage / Unrouted','[]',1]]
    .forEach(r => iR.run(...r));

  // Users
  const iU = ins('INSERT INTO users (id, name, email, role, avatar, is_active) VALUES (?, ?, ?, ?, ?, 1)');
  const iUR = ins('INSERT INTO user_regions (user_id, region_id) VALUES (?, ?)');
  [
    {id:'u1',name:'Sarah Mitchell',email:'smitchell@carecoord.org',role:'coordinator',avatar:'SM',rg:['r1','r4']},
    {id:'u2',name:'James Rivera',email:'jrivera@carecoord.org',role:'coordinator',avatar:'JR',rg:['r1']},
    {id:'u3',name:'Angela Chen',email:'achen@carecoord.org',role:'coordinator',avatar:'AC',rg:['r2']},
    {id:'u4',name:'Marcus Brown',email:'mbrown@carecoord.org',role:'coordinator',avatar:'MB',rg:['r2','r4']},
    {id:'u5',name:'Lisa Nowak',email:'lnowak@carecoord.org',role:'coordinator',avatar:'LN',rg:['r3']},
    {id:'u6',name:'Dr. Patricia Hayes',email:'phayes@carecoord.org',role:'supervisor',avatar:'PH',rg:['r1','r2','r3','r4']},
    {id:'u7',name:'Tom Adkins',email:'tadkins@carecoord.org',role:'admin',avatar:'TA',rg:['r1','r2','r3','r4']},
  ].forEach(u => { iU.run(u.id,u.name,u.email,u.role,u.avatar); u.rg.forEach(r => iUR.run(u.id,r)); });

  // Close Reasons
  const iCR = ins('INSERT INTO close_reasons (id, label, requires_comment) VALUES (?, ?, ?)');
  [['cr1','Resolved — information provided',0],['cr2','Resolved — referral completed',0],['cr3','Resolved — appointment scheduled',0],['cr4','No response after follow-up',1],['cr5','Duplicate / merged',1],['cr6','Out of scope — redirected',1]]
    .forEach(r => iCR.run(...r));

  // Tags
  const iT = ins('INSERT INTO tags (id, name, color) VALUES (?, ?, ?)');
  [['t1','Urgent','#ef4444'],['t2','Prior Auth','#f59e0b'],['t3','Referral','#3b82f6'],['t4','Benefits','#8b5cf6'],['t5','DME','#10b981'],['t6','Follow-Up','#ec4899']]
    .forEach(t => iT.run(...t));

  // Tickets
  const iTk = ins('INSERT INTO tickets (id, region_id, status, assignee_user_id, subject, external_participants, last_activity_at, created_at, closed_at, close_reason_id, locked_closed, has_unread) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const iTT = ins('INSERT INTO ticket_tags (ticket_id, tag_id) VALUES (?, ?)');
  [
    {id:'tk1',r:'r1',s:'OPEN',a:'u1',subj:'Patient John Smith — Prior Auth for MRI',ep:['jdoe@mercyhealth.org'],la:h(18),ca:d(2),tags:['t2']},
    {id:'tk2',r:'r1',s:'OPEN',a:null,subj:'DME Request — Wheelchair for Maria Garcia',ep:['kpatel@geisinger.edu'],la:d(1),ca:d(1),tags:['t5']},
    {id:'tk3',r:'r2',s:'OPEN',a:null,subj:'Coordination Needed — Benefits Verification for R. Thompson',ep:['billing@upmc.edu'],la:h(6),ca:h(6),tags:['t1','t4']},
    {id:'tk4',r:'r3',s:'WAITING_ON_EXTERNAL',a:'u5',subj:'Urgent: Discharge Planning — Patient Davis',ep:['nurse.kelly@lvhn.org'],la:h(2),ca:h(3),tags:['t1','t3']},
    {id:'tk5',r:'r4',s:'OPEN',a:null,subj:"Need help with my mom's care",ep:['unknown.sender@gmail.com'],la:h(1),ca:h(1),tags:[]},
    {id:'tk6',r:'r2',s:'CLOSED',a:'u3',subj:'Referral — Cardiology Consult for Patient Williams',ep:['referrals@wpahs.org'],la:d(2),ca:d(3),clAt:d(1.5),crId:'cr3',lc:1,tags:['t3']},
    {id:'tk7',r:'r1',s:'OPEN',a:'u2',subj:'Auth Extension Request — PT for Patient Lee',ep:['admin@pinnaclerehab.com'],la:h(8),ca:h(8),tags:['t2','t6']},
    {id:'tk8',r:'r3',s:'WAITING_ON_EXTERNAL',a:'u5',subj:'Complex Case — Behavioral Health + Housing',ep:['social.work@reading-hospital.org'],la:d(3.5),ca:d(4),tags:['t1']},
    {id:'tk9',r:'r1',s:'OPEN',a:'u1',subj:'Follow-up: Auth for Patient Adams',ep:['jdoe@mercyhealth.org'],la:h(30),ca:h(30),tags:['t2','t6']},
    {id:'tk10',r:'r4',s:'OPEN',a:null,subj:'New Provider Registration Inquiry',ep:['newprovider@healthfirst.net'],la:h(4),ca:h(4),tags:[]},
  ].forEach(t => {
    iTk.run(t.id,t.r,t.s,t.a,t.subj,JSON.stringify(t.ep),t.la,t.ca,t.clAt||null,t.crId||null,t.lc||0,t.s!=='CLOSED'&&!t.a?1:0);
    t.tags.forEach(tag => iTT.run(t.id, tag));
  });

  // Messages
  const iM = ins('INSERT INTO messages (id, ticket_id, direction, channel, from_address, to_addresses, subject, body_text, sent_at, provider_message_id, in_reply_to, reference_ids, created_by_user_id, created_at) VALUES (?, ?, ?, \\'email\\', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  [
    {id:'m1',tk:'tk1',dir:'inbound',from:'jdoe@mercyhealth.org',to:['intake@carecoord.org'],subj:'Patient John Smith — Prior Auth for MRI',body:"Hello,\\n\\nI'm writing regarding patient John Smith (DOB 03/15/1962). We need a prior authorization for an MRI of the lumbar spine ordered by Dr. Williams at Mercy Health.\\n\\nPlease let us know what documentation is needed to proceed.\\n\\nThank you,\\nJane Doe\\nMercy Health Referral Coordinator\\n(717) 555-0142",at:d(2),pid:'msg-ext-001',irt:null,refs:[],uid:null},
    {id:'m2',tk:'tk1',dir:'outbound',from:'centralpa@carecoord.org',to:['jdoe@mercyhealth.org'],subj:'Re: Patient John Smith — Prior Auth for MRI',body:"Hi Jane,\\n\\nThank you for reaching out. I've started the prior authorization process for the lumbar MRI for Mr. Smith.\\n\\nCould you please send over the following:\\n1. Recent clinical notes from Dr. Williams\\n2. Any relevant imaging history\\n3. The CPT code for the ordered procedure\\n\\nBest regards,\\nSarah Mitchell\\nCare Coordinator — Central PA Region",at:d(1.5),pid:'msg-int-001',irt:'msg-ext-001',refs:['msg-ext-001'],uid:'u1'},
    {id:'m3',tk:'tk1',dir:'inbound',from:'jdoe@mercyhealth.org',to:['centralpa@carecoord.org'],subj:'Re: Patient John Smith — Prior Auth for MRI',body:"Sarah,\\n\\nAttached are the clinical notes and imaging history. The CPT code is 72148.\\n\\nThanks,\\nJane",at:h(18),pid:'msg-ext-002',irt:'msg-int-001',refs:['msg-ext-001','msg-int-001'],uid:null},
    {id:'m4',tk:'tk2',dir:'inbound',from:'kpatel@geisinger.edu',to:['intake@carecoord.org'],subj:'DME Request — Wheelchair for Maria Garcia',body:"Good morning,\\n\\nWe have a patient, Maria Garcia, who requires a power wheelchair following her recent stroke.\\n\\nRegards,\\nDr. K. Patel\\nGeisinger Rehabilitation",at:d(1),pid:'msg-ext-003',irt:null,refs:[],uid:null},
    {id:'m5',tk:'tk3',dir:'inbound',from:'billing@upmc.edu',to:['westernpa@carecoord.org'],subj:'Coordination Needed — Benefits Verification for R. Thompson',body:"Hi team,\\n\\nWe need assistance verifying benefits for patient Robert Thompson (Member ID: XK-4829173).\\n\\nThank you,\\nUPMC Billing Department",at:h(6),pid:'msg-ext-004',irt:null,refs:[],uid:null},
    {id:'m6',tk:'tk4',dir:'inbound',from:'nurse.kelly@lvhn.org',to:['easternpa@carecoord.org'],subj:'Urgent: Discharge Planning — Patient Davis',body:"URGENT\\n\\nPatient Emily Davis is being discharged tomorrow and needs home health services arranged.\\n\\nNurse Kelly Raymond\\nLVHN Discharge Planning",at:h(3),pid:'msg-ext-005',irt:null,refs:[],uid:null},
    {id:'m7',tk:'tk4',dir:'outbound',from:'easternpa@carecoord.org',to:['nurse.kelly@lvhn.org'],subj:'Re: Urgent: Discharge Planning — Patient Davis',body:"Nurse Raymond,\\n\\nI'm on it. I've contacted Aetna and initiated the authorization for home health services.\\n\\nLisa Nowak\\nCare Coordinator — Eastern PA Region",at:h(2),pid:'msg-int-002',irt:'msg-ext-005',refs:['msg-ext-005'],uid:'u5'},
    {id:'m8',tk:'tk5',dir:'inbound',from:'unknown.sender@gmail.com',to:['intake@carecoord.org'],subj:"Need help with my mom's care",body:"Hi, my mother recently moved to Pennsylvania and needs to find new doctors. She's in the Scranton area.\\n\\nThank you,\\nMichael Torres",at:h(1),pid:'msg-ext-006',irt:null,refs:[],uid:null},
    {id:'m9',tk:'tk6',dir:'inbound',from:'referrals@wpahs.org',to:['westernpa@carecoord.org'],subj:'Referral — Cardiology Consult for Patient Williams',body:"Please coordinate a cardiology consultation for patient David Williams.\\n\\nWPAHS Referral Desk",at:d(3),pid:'msg-ext-007',irt:null,refs:[],uid:null},
    {id:'m10',tk:'tk6',dir:'outbound',from:'westernpa@carecoord.org',to:['referrals@wpahs.org'],subj:'Re: Referral — Cardiology Consult for Patient Williams',body:"I've contacted three in-network cardiologists. Dr. Mehta has availability this Thursday at 2pm.\\n\\nAngela Chen\\nCare Coordinator — Western PA Region",at:d(2.5),pid:'msg-int-003',irt:'msg-ext-007',refs:['msg-ext-007'],uid:'u3'},
    {id:'m11',tk:'tk6',dir:'inbound',from:'referrals@wpahs.org',to:['westernpa@carecoord.org'],subj:'Re: Referral — Cardiology Consult for Patient Williams',body:"That works. Patient has been notified. Thank you for the quick turnaround.",at:d(2),pid:'msg-ext-008',irt:'msg-int-003',refs:['msg-ext-007','msg-int-003'],uid:null},
    {id:'m12',tk:'tk7',dir:'inbound',from:'admin@pinnaclerehab.com',to:['centralpa@carecoord.org'],subj:'Auth Extension Request — PT for Patient Lee',body:"We need an extension on the PT authorization for patient Susan Lee. Current auth expires in 3 days.\\n\\nPinnacle Rehab Admin",at:h(8),pid:'msg-ext-009',irt:null,refs:[],uid:null},
    {id:'m13',tk:'tk8',dir:'inbound',from:'social.work@reading-hospital.org',to:['easternpa@carecoord.org'],subj:'Complex Case — Behavioral Health + Housing',body:"We have a patient with significant behavioral health needs who is also facing housing instability.\\n\\nReading Hospital Social Work Dept",at:d(4),pid:'msg-ext-010',irt:null,refs:[],uid:null},
    {id:'m14',tk:'tk8',dir:'outbound',from:'easternpa@carecoord.org',to:['social.work@reading-hospital.org'],subj:'Re: Complex Case — Behavioral Health + Housing',body:"I called and left a voicemail at ext 4421. I have some resources that may help.\\n\\nLisa Nowak\\nCare Coordinator — Eastern PA",at:d(3.5),pid:'msg-int-004',irt:'msg-ext-010',refs:['msg-ext-010'],uid:'u5'},
    {id:'m15',tk:'tk9',dir:'inbound',from:'jdoe@mercyhealth.org',to:['centralpa@carecoord.org'],subj:'Follow-up: Auth for Patient Adams',body:"Hi, just checking in on the prior auth for patient Robert Adams. Any update?\\n\\nJane Doe\\nMercy Health",at:h(30),pid:'msg-ext-011',irt:null,refs:[],uid:null},
    {id:'m16',tk:'tk10',dir:'inbound',from:'newprovider@healthfirst.net',to:['intake@carecoord.org'],subj:'New Provider Registration Inquiry',body:"Hello, we are a new home health agency looking to partner with your coordination services.\\n\\nHealthFirst Home Health",at:h(4),pid:'msg-ext-012',irt:null,refs:[],uid:null},
  ].forEach(m => iM.run(m.id,m.tk,m.dir,m.from,JSON.stringify(m.to),m.subj,m.body,m.at,m.pid,m.irt,JSON.stringify(m.refs),m.uid,m.at));

  // Notes
  const iN = ins('INSERT INTO notes (id, ticket_id, author_user_id, body, created_at) VALUES (?, ?, ?, ?, ?)');
  [
    ['n1','tk1','u1','Called Aetna UM dept — confirmed CPT 72148 requires clinical notes + 6 months imaging history.',d(1.8)],
    ['n2','tk4','u5','Aetna rep (ref #A-29401) confirmed home health auth is in process. Expected 4-6 hours.',h(2.5)],
    ['n3','tk6','u3',"Dr. Mehta's office confirmed appt. Sent confirmation to patient's personal email.",d(1.8)],
    ['n4','tk8','u5','Spoke with social worker — dual diagnosis. Referred to PA 211 for housing resources.',d(3)],
  ].forEach(n => iN.run(...n));

  // Audit
  const iA = ins('INSERT INTO audit_log (id, actor_user_id, action_type, entity_type, entity_id, ts, detail) VALUES (?, ?, ?, ?, ?, ?, ?)');
  [
    ['a1',null,'ticket_created','ticket','tk1',d(2),'Inbound email ingested'],
    ['a2','u1','assignee_changed','ticket','tk1',d(1.9),'Assigned to Sarah Mitchell'],
    ['a3','u1','outbound_sent','message','m2',d(1.5),'Reply sent to jdoe@mercyhealth.org'],
    ['a4',null,'inbound_received','message','m3',h(18),'Reply from jdoe@mercyhealth.org'],
    ['a5','u3','status_changed','ticket','tk6',d(1.5),'Status -> CLOSED'],
  ].forEach(a => iA.run(...a));

  saveDb();
  console.log('\\n✅ Database seeded successfully');
  console.log('   4 regions, 7 users, 10 tickets, 16 messages, 4 notes, 5 audit entries\\n');
  closeDb();
}

seed().catch(err => { console.error('Seed failed:', err); process.exit(1); });
`);

console.log('\n✅ All server files updated for sql.js');
console.log('\nNext steps:');
console.log('  1. npm run seed');
console.log('  2. npm run dev');
console.log('  3. Open http://localhost:5173\n');
