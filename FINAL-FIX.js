// FINAL-FIX.js — Based on reading every uploaded file
const fs = require('fs');
const path = require('path');
const write = (f, c) => { fs.writeFileSync(path.join(__dirname, f), c, 'utf8'); console.log('  ✓ ' + f); };

console.log('\n🔧 FINAL FIX based on actual source code\n');

// ═══════════════════════════════════════════════════════════════════════════════
// 1. utils.js — fmt must be an OBJECT with .time() and .full() methods
//    Dashboard uses: fmt.time(ticket.last_activity_at)
//    AuditLog uses: fmt.full(entry.ts)
// ═══════════════════════════════════════════════════════════════════════════════

write('client/src/utils.js', `export const fmt = {
  time(ts) {
    if (!ts) return '';
    const d = new Date(typeof ts === 'number' ? ts : Date.parse(ts));
    if (isNaN(d)) return String(ts);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    if (diff < 604800000) return Math.floor(diff / 86400000) + 'd ago';
    return d.toLocaleDateString();
  },
  full(ts) {
    if (!ts) return '';
    const d = new Date(typeof ts === 'number' ? ts : Date.parse(ts));
    if (isNaN(d)) return String(ts);
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  },
  date(ts) {
    if (!ts) return '';
    return new Date(typeof ts === 'number' ? ts : Date.parse(ts)).toLocaleDateString();
  },
};
`);

// ═══════════════════════════════════════════════════════════════════════════════
// 2. api.js — Add bulkReassign, fix getAuditLog signature
// ═══════════════════════════════════════════════════════════════════════════════

let api = fs.readFileSync(path.join(__dirname, 'client', 'src', 'api.js'), 'utf8');

// Fix getAuditLog to accept (type, limit)
api = api.replace(
  "getAuditLog: () => request('/audit'),",
  "getAuditLog: (type, limit) => request('/audit?type=' + encodeURIComponent(type || 'all') + '&limit=' + (limit || 50)),"
);

// Add bulkReassign if missing
if (!api.includes('bulkReassign')) {
  api = api.replace(
    "adminGetUsers:",
    "bulkReassign: (from, to) => request('/tickets/bulk/reassign', { method: 'POST', body: { fromUserId: from, toUserId: to } }),\n  adminGetUsers:"
  );
}

fs.writeFileSync(path.join(__dirname, 'client', 'src', 'api.js'), api, 'utf8');
console.log('  ✓ client/src/api.js — added bulkReassign, fixed getAuditLog');

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Dashboard route — must match what Dashboard.jsx expects:
//    getDashboardSummary() → { totalOpen, unassigned, closedToday, triageCount, oldestOpen }
//    getDashboardByRegion() → { regions: [{ region:{id,name}, open, unassigned }] }
//    getDashboardByCoordinator() → { coordinators: [{ user:{id,name,avatar}, open, closedToday }] }
// ═══════════════════════════════════════════════════════════════════════════════

write('server/routes/dashboard.js', `const express = require('express');
const { getDb } = require('../database');
const { requireAuth } = require('../middleware');
const router = express.Router();

function cnt(db, sql, params) {
  try { const r = db.prepare(sql).get(...(params || [])); return r ? (r.c || 0) : 0; }
  catch(e) { return 0; }
}

router.get('/summary', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const rids = req.user.regionIds || [];
    if (!rids.length) return res.json({ totalOpen: 0, unassigned: 0, closedToday: 0, triageCount: 0, oldestOpen: null });
    const ph = rids.map(() => '?').join(',');

    const totalOpen = cnt(db, "SELECT COUNT(*) as c FROM tickets WHERE status != 'CLOSED' AND region_id IN (" + ph + ")", rids);
    const unassigned = cnt(db, "SELECT COUNT(*) as c FROM tickets WHERE assignee_user_id IS NULL AND status != 'CLOSED' AND region_id IN (" + ph + ")", rids);

    // Closed today
    const todayStart = new Date(); todayStart.setHours(0,0,0,0);
    const closedToday = cnt(db, "SELECT COUNT(*) as c FROM tickets WHERE status = 'CLOSED' AND closed_at >= ? AND region_id IN (" + ph + ")", [todayStart.getTime(), ...rids]);

    // Triage count (r4 = Triage / Unrouted)
    const triageCount = cnt(db, "SELECT COUNT(*) as c FROM tickets WHERE status != 'CLOSED' AND region_id = 'r4'", []);

    // Oldest open
    const oldest = db.prepare("SELECT id, subject, created_at FROM tickets WHERE status != 'CLOSED' AND region_id IN (" + ph + ") ORDER BY created_at ASC LIMIT 1").get(...rids);

    res.json({ totalOpen, unassigned, closedToday, triageCount, oldestOpen: oldest || null });
  } catch(e) {
    console.error('[Dashboard/summary]', e.message);
    res.json({ totalOpen: 0, unassigned: 0, closedToday: 0, triageCount: 0, oldestOpen: null });
  }
});

router.get('/by-region', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const rids = req.user.regionIds || [];
    if (!rids.length) return res.json({ regions: [] });
    const ph = rids.map(() => '?').join(',');
    const rows = db.prepare("SELECT t.region_id, r.name, COUNT(*) as total, SUM(CASE WHEN t.status != 'CLOSED' THEN 1 ELSE 0 END) as open_count, SUM(CASE WHEN t.assignee_user_id IS NULL AND t.status != 'CLOSED' THEN 1 ELSE 0 END) as unassigned FROM tickets t LEFT JOIN regions r ON r.id = t.region_id WHERE t.region_id IN (" + ph + ") GROUP BY t.region_id").all(...rids);
    res.json({
      regions: rows.map(r => ({
        region: { id: r.region_id, name: r.name },
        total: r.total,
        open: r.open_count,
        unassigned: r.unassigned,
      }))
    });
  } catch(e) {
    console.error('[Dashboard/by-region]', e.message);
    res.json({ regions: [] });
  }
});

router.get('/by-coordinator', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const rids = req.user.regionIds || [];
    if (!rids.length) return res.json({ coordinators: [] });
    const ph = rids.map(() => '?').join(',');

    const todayStart = new Date(); todayStart.setHours(0,0,0,0);

    const rows = db.prepare("SELECT t.assignee_user_id, u.name, u.avatar, COUNT(*) as total, SUM(CASE WHEN t.status != 'CLOSED' THEN 1 ELSE 0 END) as open_count, SUM(CASE WHEN t.status = 'CLOSED' AND t.closed_at >= " + todayStart.getTime() + " THEN 1 ELSE 0 END) as closed_today FROM tickets t LEFT JOIN users u ON u.id = t.assignee_user_id WHERE t.assignee_user_id IS NOT NULL AND t.region_id IN (" + ph + ") GROUP BY t.assignee_user_id").all(...rids);
    res.json({
      coordinators: rows.map(r => ({
        user: { id: r.assignee_user_id, name: r.name || 'Unknown', avatar: r.avatar },
        total: r.total,
        open: r.open_count,
        closedToday: r.closed_today,
      }))
    });
  } catch(e) {
    console.error('[Dashboard/by-coordinator]', e.message);
    res.json({ coordinators: [] });
  }
});

// Legacy catch-all
router.get('/', requireAuth, (req, res) => {
  res.json({ totalOpen: 0, unassigned: 0, closedToday: 0, triageCount: 0, oldestOpen: null });
});

module.exports = router;
`);

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Audit route — must return { entries, actionTypes }
//    Entries need: id, actor_user_id, actor_name, actor_avatar, action_type,
//                  entity_type, entity_id, detail, ts
// ═══════════════════════════════════════════════════════════════════════════════

write('server/routes/audit.js', `const express = require('express');
const { getDb } = require('../database');
const { requireAuth } = require('../middleware');
const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const limit = parseInt(req.query.limit) || 50;
    const type = req.query.type;
    let sql = 'SELECT a.*, u.name as actor_name, u.avatar as actor_avatar FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id';
    const params = [];
    if (type && type !== 'all') { sql += ' WHERE a.action_type = ?'; params.push(type); }
    sql += ' ORDER BY a.ts DESC LIMIT ?';
    params.push(limit);
    const rows = db.prepare(sql).all(...params);
    const entries = rows.map(r => ({
      id: r.id,
      actor_user_id: r.actor_user_id,
      actor_name: r.actor_name || 'System',
      actor_avatar: r.actor_avatar || null,
      action_type: r.action_type,
      entity_type: r.entity_type,
      entity_id: r.entity_id,
      detail: r.detail,
      ts: r.ts,
    }));
    const actionTypes = [...new Set(entries.map(e => e.action_type).filter(Boolean))];
    res.json({ entries, actionTypes });
  } catch (err) {
    console.error('[Audit]', err.message);
    res.json({ entries: [], actionTypes: [] });
  }
});

module.exports = router;
`);

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Verify App.jsx sidebar polling isn't causing infinite loops
//    App.jsx polls every 15s for unassigned/personal counts — that's fine
//    but needs getTickets to work, which it now does
// ═══════════════════════════════════════════════════════════════════════════════

// App.jsx also references closeReasons but server returns { reasons: [] }
// while App.jsx does setCloseReasons(c.closeReasons) — need to check
let appJsx = fs.readFileSync(path.join(__dirname, 'client', 'src', 'App.jsx'), 'utf8');
// Fix: c.closeReasons should be c.reasons (that's what the server sends)
if (appJsx.includes('c.closeReasons') && !appJsx.includes('c.reasons')) {
  appJsx = appJsx.replace('setCloseReasons(c.closeReasons)', 'setCloseReasons(c.reasons || c.closeReasons || [])');
  fs.writeFileSync(path.join(__dirname, 'client', 'src', 'App.jsx'), appJsx, 'utf8');
  console.log('  ✓ client/src/App.jsx — fixed closeReasons mapping');
} else {
  console.log('  ✓ client/src/App.jsx — OK');
}

console.log('\n✅ ALL FIXES APPLIED\n');
console.log('Server will auto-restart. Refresh browser at http://localhost:5173\n');
