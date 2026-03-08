const express = require('express');
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
