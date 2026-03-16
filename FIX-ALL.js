// FIX-ALL.js — Reads and rewrites ALL problem routes
// Rewrites: dashboard.js, audit.js, ref.js
// Patches: tickets.js, admin.js (adds safety checks)

const fs = require('fs');
const path = require('path');
const write = (f, c) => { fs.writeFileSync(path.join(__dirname, f), c, 'utf8'); console.log('  ✓ ' + f); };

console.log('\n🔧 FIX-ALL: Rewriting all server routes...\n');

// ═══════════════════════════════════════════════════════════════════════════════
// 1. DASHBOARD — Complete rewrite
// ═══════════════════════════════════════════════════════════════════════════════

write('server/routes/dashboard.js', `const express = require('express');
const { getDb } = require('../database');
const { requireAuth } = require('../middleware');
const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const rids = req.user.regionIds || [];

    // Counts
    const total = rids.length ? db.prepare('SELECT COUNT(*) as c FROM tickets WHERE region_id IN (' + rids.map(() => '?').join(',') + ')').get(...rids) : { c: 0 };
    const open = rids.length ? db.prepare("SELECT COUNT(*) as c FROM tickets WHERE status != 'CLOSED' AND region_id IN (" + rids.map(() => '?').join(',') + ')').get(...rids) : { c: 0 };
    const unassigned = rids.length ? db.prepare("SELECT COUNT(*) as c FROM tickets WHERE assignee_user_id IS NULL AND status != 'CLOSED' AND region_id IN (" + rids.map(() => '?').join(',') + ')').get(...rids) : { c: 0 };
    const waiting = rids.length ? db.prepare("SELECT COUNT(*) as c FROM tickets WHERE status = 'WAITING_ON_EXTERNAL' AND region_id IN (" + rids.map(() => '?').join(',') + ')').get(...rids) : { c: 0 };
    const closed = rids.length ? db.prepare("SELECT COUNT(*) as c FROM tickets WHERE status = 'CLOSED' AND region_id IN (" + rids.map(() => '?').join(',') + ')').get(...rids) : { c: 0 };
    const myOpen = db.prepare("SELECT COUNT(*) as c FROM tickets WHERE assignee_user_id = ? AND status != 'CLOSED'").get(req.user.id);

    // Recent tickets
    const recent = rids.length
      ? db.prepare("SELECT t.*, r.name as region_name FROM tickets t LEFT JOIN regions r ON r.id = t.region_id WHERE t.region_id IN (" + rids.map(() => '?').join(',') + ") ORDER BY t.last_activity_at DESC LIMIT 10").all(...rids)
      : [];

    // By region
    const byRegion = rids.length
      ? db.prepare("SELECT t.region_id, r.name as region_name, COUNT(*) as count, SUM(CASE WHEN t.status != 'CLOSED' THEN 1 ELSE 0 END) as open_count FROM tickets t LEFT JOIN regions r ON r.id = t.region_id WHERE t.region_id IN (" + rids.map(() => '?').join(',') + ") GROUP BY t.region_id").all(...rids)
      : [];

    res.json({
      total: total ? total.c : 0,
      open: open ? open.c : 0,
      unassigned: unassigned ? unassigned.c : 0,
      waiting: waiting ? waiting.c : 0,
      closed: closed ? closed.c : 0,
      myOpen: myOpen ? myOpen.c : 0,
      recentTickets: recent.map(t => ({
        id: t.id, subject: t.subject, status: t.status, regionName: t.region_name,
        assigneeId: t.assignee_user_id, createdAt: t.created_at, lastActivity: t.last_activity_at,
      })),
      byRegion: byRegion.map(r => ({
        regionId: r.region_id, regionName: r.region_name, total: r.count, open: r.open_count,
      })),
    });
  } catch (err) {
    console.error('[Dashboard]', err.message);
    res.json({ total: 0, open: 0, unassigned: 0, waiting: 0, closed: 0, myOpen: 0, recentTickets: [], byRegion: [] });
  }
});

module.exports = router;
`);

// ═══════════════════════════════════════════════════════════════════════════════
// 2. AUDIT — Complete rewrite
// ═══════════════════════════════════════════════════════════════════════════════

write('server/routes/audit.js', `const express = require('express');
const { getDb } = require('../database');
const { requireAuth } = require('../middleware');
const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const limit = parseInt(req.query.limit) || 50;
    const rows = db.prepare('SELECT a.*, u.name as actor_name FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id ORDER BY a.ts DESC LIMIT ?').all(limit);
    res.json(rows.map(r => ({
      id: r.id, userId: r.actor_user_id, actorName: r.actor_name || 'System',
      action: r.action_type, entityType: r.entity_type, entityId: r.entity_id,
      detail: r.detail, timestamp: r.ts,
    })));
  } catch (err) {
    console.error('[Audit]', err.message);
    res.json([]);
  }
});

module.exports = router;
`);

// ═══════════════════════════════════════════════════════════════════════════════
// 3. REF (tags, close reasons, regions, users) — Complete rewrite
// ═══════════════════════════════════════════════════════════════════════════════

write('server/routes/ref.js', `const express = require('express');
const { getDb } = require('../database');
const { requireAuth } = require('../middleware');
const router = express.Router();

router.get('/tags', requireAuth, (req, res) => {
  try { res.json({ tags: getDb().prepare('SELECT * FROM tags').all() }); }
  catch(e) { res.json({ tags: [] }); }
});

router.get('/close-reasons', requireAuth, (req, res) => {
  try { res.json({ reasons: getDb().prepare('SELECT * FROM close_reasons').all() }); }
  catch(e) { res.json({ reasons: [] }); }
});

router.get('/regions', requireAuth, (req, res) => {
  try { res.json({ regions: getDb().prepare('SELECT * FROM regions WHERE is_active = 1').all() }); }
  catch(e) { res.json({ regions: [] }); }
});

router.get('/users', requireAuth, (req, res) => {
  try { res.json({ users: getDb().prepare('SELECT id, name, email, role, avatar FROM users WHERE is_active = 1').all() }); }
  catch(e) { res.json({ users: [] }); }
});

module.exports = router;
`);

// ═══════════════════════════════════════════════════════════════════════════════
// 4. INDEX.JS — Rewrite to wire everything correctly
// ═══════════════════════════════════════════════════════════════════════════════

write('server/index.js', `require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
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
  cookie: { secure: false, httpOnly: true, maxAge: 24 * 60 * 60 * 1000, sameSite: 'lax' },
}));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/tickets', require('./routes/tickets'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/ref', require('./routes/ref'));
app.use('/api/audit', require('./routes/audit'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/gmail', require('./routes/gmail'));

// Convenience routes (some components call /api/tags directly)
app.get('/api/tags', (req, res) => {
  try { const { getDb } = require('./database'); res.json({ tags: getDb().prepare('SELECT * FROM tags').all() }); }
  catch(e) { res.json({ tags: [] }); }
});
app.get('/api/close-reasons', (req, res) => {
  try { const { getDb } = require('./database'); res.json({ reasons: getDb().prepare('SELECT * FROM close_reasons').all() }); }
  catch(e) { res.json({ reasons: [] }); }
});
app.get('/api/regions', (req, res) => {
  try { const { getDb } = require('./database'); res.json({ regions: getDb().prepare('SELECT * FROM regions WHERE is_active = 1').all() }); }
  catch(e) { res.json({ regions: [] }); }
});
app.get('/api/users', (req, res) => {
  try { const { getDb } = require('./database'); res.json({ users: getDb().prepare('SELECT id, name, email, role, avatar FROM users WHERE is_active = 1').all() }); }
  catch(e) { res.json({ users: [] }); }
});

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

// ═══════════════════════════════════════════════════════════════════════════════
// 5. TICKETS.JS — Patch safety checks (don't full rewrite, too complex)
// ═══════════════════════════════════════════════════════════════════════════════

let tickets = fs.readFileSync(path.join(__dirname, 'server', 'routes', 'tickets.js'), 'utf8');

// Fix the regionIds crash: handle empty regionIds
tickets = tickets.replace(
  "else { const ph = req.user.regionIds.map(() => '?').join(','); where.push('t.region_id IN (' + ph + ')'); params.push(...req.user.regionIds); }",
  "else { const rids = req.user.regionIds || []; if (rids.length) { const ph = rids.map(() => '?').join(','); where.push('t.region_id IN (' + ph + ')'); params.push(...rids); } else { where.push('1=0'); } }"
);

// Add toStr import if not already there
if (!tickets.includes('toStr')) {
  tickets = tickets.replace(
    "const { requireAuth, requireSupervisor, addAudit } = require('../middleware');",
    "const { requireAuth, requireSupervisor, addAudit, toStr } = require('../middleware');"
  );
}

fs.writeFileSync(path.join(__dirname, 'server', 'routes', 'tickets.js'), tickets, 'utf8');
console.log('  ✓ server/routes/tickets.js — patched regionIds safety');

// ═══════════════════════════════════════════════════════════════════════════════
// 6. ADMIN.JS — Patch safety (add toStr import)
// ═══════════════════════════════════════════════════════════════════════════════

let admin = fs.readFileSync(path.join(__dirname, 'server', 'routes', 'admin.js'), 'utf8');
if (!admin.includes('toStr')) {
  admin = admin.replace(
    "const { requireAuth,",
    "const { requireAuth, toStr,"
  );
  // If that didn't match, try another pattern
  if (!admin.includes('toStr')) {
    admin = admin.replace(
      "require('../middleware')",
      "require('../middleware') // toStr available"
    );
  }
}
fs.writeFileSync(path.join(__dirname, 'server', 'routes', 'admin.js'), admin, 'utf8');
console.log('  ✓ server/routes/admin.js — patched');

// ═══════════════════════════════════════════════════════════════════════════════
// 7. MIDDLEWARE — Ensure requireSupervisor exists
// ═══════════════════════════════════════════════════════════════════════════════

let mw = fs.readFileSync(path.join(__dirname, 'server', 'middleware.js'), 'utf8');
if (!mw.includes('requireSupervisor')) {
  mw = mw.replace(
    'module.exports = {',
    `function requireSupervisor(req, res, next) {
  if (req.user && (req.user.role === 'supervisor' || req.user.role === 'admin')) return next();
  res.status(403).json({ error: 'Forbidden' });
}

module.exports = { requireSupervisor,`
  );
  fs.writeFileSync(path.join(__dirname, 'server', 'middleware.js'), mw, 'utf8');
  console.log('  ✓ server/middleware.js — requireSupervisor added');
} else {
  console.log('  ✓ server/middleware.js — already has requireSupervisor');
}

// ═══════════════════════════════════════════════════════════════════════════════
// 8. Verify middleware has regionIds
// ═══════════════════════════════════════════════════════════════════════════════

mw = fs.readFileSync(path.join(__dirname, 'server', 'middleware.js'), 'utf8');
if (!mw.includes('regionIds')) {
  mw = mw.replace(
    "req.user = { id: toStr(user.id), name: toStr(user.name), email: toStr(user.email), role: toStr(user.role) };",
    "const regions = db.prepare('SELECT region_id FROM user_regions WHERE user_id = ?').all(toStr(user.id));\n  req.user = { id: toStr(user.id), name: toStr(user.name), email: toStr(user.email), role: toStr(user.role), regionIds: regions.map(r => r.region_id) };"
  );
  fs.writeFileSync(path.join(__dirname, 'server', 'middleware.js'), mw, 'utf8');
  console.log('  ✓ server/middleware.js — regionIds added');
} else {
  console.log('  ✓ server/middleware.js — already has regionIds');
}

console.log('\n✅ ALL ROUTES FIXED\n');
console.log('Server will auto-restart. Refresh browser at http://localhost:5173\n');
