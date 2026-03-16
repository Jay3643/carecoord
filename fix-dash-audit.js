// fix-dash-audit.js
const fs = require('fs');
const path = require('path');

// 1. Fix api.js — add missing dashboard + audit methods
let api = fs.readFileSync('client/src/api.js', 'utf8');

if (!api.includes('getDashboardSummary')) {
  api = api.replace(
    "getDashboard: () => request('/dashboard'),",
    `getDashboard: () => request('/dashboard'),
  getDashboardSummary: () => request('/dashboard/summary'),
  getDashboardByRegion: () => request('/dashboard/by-region'),
  getDashboardByCoordinator: () => request('/dashboard/by-coordinator'),`
  );
}

if (!api.includes('getAuditLog: (')) {
  api = api.replace(
    "getAuditLog: () => request('/audit'),",
    "getAuditLog: (type, limit) => request('/audit?type=' + (type || 'all') + '&limit=' + (limit || 50)),"
  );
}

fs.writeFileSync('client/src/api.js', api, 'utf8');
console.log('  ✓ api.js — added dashboard + audit methods');

// 2. Rewrite dashboard route with summary, by-region, by-coordinator
fs.writeFileSync('server/routes/dashboard.js', `const express = require('express');
const { getDb } = require('../database');
const { requireAuth } = require('../middleware');
const router = express.Router();

function safeCount(db, sql, params) {
  try { const r = db.prepare(sql).get(...params); return r ? (r.c || r.count || 0) : 0; }
  catch(e) { return 0; }
}

router.get('/summary', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const rids = req.user.regionIds || [];
    if (!rids.length) return res.json({ total: 0, open: 0, unassigned: 0, waiting: 0, closed: 0, myOpen: 0 });
    const ph = rids.map(() => '?').join(',');
    res.json({
      total: safeCount(db, 'SELECT COUNT(*) as c FROM tickets WHERE region_id IN (' + ph + ')', rids),
      open: safeCount(db, "SELECT COUNT(*) as c FROM tickets WHERE status != 'CLOSED' AND region_id IN (" + ph + ')', rids),
      unassigned: safeCount(db, "SELECT COUNT(*) as c FROM tickets WHERE assignee_user_id IS NULL AND status != 'CLOSED' AND region_id IN (" + ph + ')', rids),
      waiting: safeCount(db, "SELECT COUNT(*) as c FROM tickets WHERE status = 'WAITING_ON_EXTERNAL' AND region_id IN (" + ph + ')', rids),
      closed: safeCount(db, "SELECT COUNT(*) as c FROM tickets WHERE status = 'CLOSED' AND region_id IN (" + ph + ')', rids),
      myOpen: safeCount(db, "SELECT COUNT(*) as c FROM tickets WHERE assignee_user_id = ? AND status != 'CLOSED'", [req.user.id]),
    });
  } catch(e) { console.error('[Dashboard]', e.message); res.json({ total:0, open:0, unassigned:0, waiting:0, closed:0, myOpen:0 }); }
});

router.get('/by-region', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const rids = req.user.regionIds || [];
    if (!rids.length) return res.json({ regions: [] });
    const ph = rids.map(() => '?').join(',');
    const rows = db.prepare("SELECT t.region_id, r.name as region_name, COUNT(*) as total, SUM(CASE WHEN t.status != 'CLOSED' THEN 1 ELSE 0 END) as open, SUM(CASE WHEN t.assignee_user_id IS NULL AND t.status != 'CLOSED' THEN 1 ELSE 0 END) as unassigned FROM tickets t LEFT JOIN regions r ON r.id = t.region_id WHERE t.region_id IN (" + ph + ") GROUP BY t.region_id").all(...rids);
    res.json({ regions: rows.map(r => ({ regionId: r.region_id, regionName: r.region_name, total: r.total, open: r.open, unassigned: r.unassigned })) });
  } catch(e) { res.json({ regions: [] }); }
});

router.get('/by-coordinator', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const rids = req.user.regionIds || [];
    if (!rids.length) return res.json({ coordinators: [] });
    const ph = rids.map(() => '?').join(',');
    const rows = db.prepare("SELECT t.assignee_user_id, u.name, u.avatar, COUNT(*) as total, SUM(CASE WHEN t.status = 'OPEN' THEN 1 ELSE 0 END) as open, SUM(CASE WHEN t.status = 'WAITING_ON_EXTERNAL' THEN 1 ELSE 0 END) as waiting FROM tickets t LEFT JOIN users u ON u.id = t.assignee_user_id WHERE t.assignee_user_id IS NOT NULL AND t.status != 'CLOSED' AND t.region_id IN (" + ph + ") GROUP BY t.assignee_user_id").all(...rids);
    res.json({ coordinators: rows.map(r => ({ userId: r.assignee_user_id, name: r.name || 'Unknown', avatar: r.avatar, total: r.total, open: r.open, waiting: r.waiting })) });
  } catch(e) { res.json({ coordinators: [] }); }
});

// Legacy catch-all
router.get('/', requireAuth, (req, res) => { res.json({ total:0, open:0, unassigned:0, waiting:0, closed:0, myOpen:0, recentTickets:[], byRegion:[] }); });

module.exports = router;
`, 'utf8');
console.log('  ✓ dashboard.js — summary, by-region, by-coordinator');

// 3. Fix audit route to return entries + actionTypes
fs.writeFileSync('server/routes/audit.js', `const express = require('express');
const { getDb } = require('../database');
const { requireAuth } = require('../middleware');
const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const limit = parseInt(req.query.limit) || 50;
    const type = req.query.type;
    let sql = 'SELECT a.*, u.name as actor_name FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id';
    const params = [];
    if (type && type !== 'all') { sql += ' WHERE a.action_type = ?'; params.push(type); }
    sql += ' ORDER BY a.ts DESC LIMIT ?';
    params.push(limit);
    const rows = db.prepare(sql).all(...params);
    const entries = rows.map(r => ({
      id: r.id, userId: r.actor_user_id, actorName: r.actor_name || 'System',
      action: r.action_type, actionType: r.action_type, entityType: r.entity_type, entityId: r.entity_id,
      detail: r.detail, timestamp: r.ts, ts: r.ts,
    }));
    const actionTypes = [...new Set(entries.map(e => e.actionType).filter(Boolean))];
    res.json({ entries, actionTypes });
  } catch (err) {
    console.error('[Audit]', err.message);
    res.json({ entries: [], actionTypes: [] });
  }
});

module.exports = router;
`, 'utf8');
console.log('  ✓ audit.js — returns entries + actionTypes');

// 4. Ensure utils.js exists
const utilsPath = 'client/src/utils.js';
if (!fs.existsSync(utilsPath)) {
  fs.writeFileSync(utilsPath, `export function fmt(ts) {
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
}

export function fmtDate(ts) {
  if (!ts) return '';
  return new Date(typeof ts === 'number' ? ts : Date.parse(ts)).toLocaleString();
}
`, 'utf8');
  console.log('  ✓ client/src/utils.js — created');
} else {
  console.log('  ✓ client/src/utils.js — exists');
}

console.log('\nDone. Refresh browser.');
