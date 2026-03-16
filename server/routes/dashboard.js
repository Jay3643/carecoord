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

// ── Activity Dashboard Endpoints ──

// Daily ticket volume trends (last N days)
router.get('/activity/trends', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const days = Math.min(parseInt(req.query.days) || 30, 90);
    const startTs = Date.now() - days * 86400000;
    const rids = req.user.regionIds || [];
    if (!rids.length) return res.json({ trends: [] });
    const ph = rids.map(() => '?').join(',');

    // Get all tickets in date range for the user's regions
    const tickets = db.prepare(
      "SELECT created_at, closed_at, status FROM tickets WHERE region_id IN (" + ph + ") AND (created_at >= ? OR (closed_at IS NOT NULL AND closed_at >= ?))"
    ).all(...rids, startTs, startTs);

    // Build daily buckets
    const buckets = {};
    for (let i = 0; i < days; i++) {
      const d = new Date(Date.now() - (days - 1 - i) * 86400000);
      const key = d.toISOString().slice(0, 10);
      buckets[key] = { date: key, created: 0, closed: 0 };
    }
    for (const t of tickets) {
      if (t.created_at) {
        const k = new Date(t.created_at).toISOString().slice(0, 10);
        if (buckets[k]) buckets[k].created++;
      }
      if (t.closed_at) {
        const k = new Date(t.closed_at).toISOString().slice(0, 10);
        if (buckets[k]) buckets[k].closed++;
      }
    }
    res.json({ trends: Object.values(buckets) });
  } catch(e) { console.error('[Activity/trends]', e.message); res.json({ trends: [] }); }
});

// Coordinator performance metrics
router.get('/activity/performance', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const days = Math.min(parseInt(req.query.days) || 30, 90);
    const startTs = Date.now() - days * 86400000;
    const rids = req.user.regionIds || [];
    if (!rids.length) return res.json({ coordinators: [] });
    const ph = rids.map(() => '?').join(',');

    const users = db.prepare("SELECT DISTINCT u.id, u.name, u.email, u.role, u.avatar, u.work_status FROM users u JOIN user_regions ur ON ur.user_id = u.id WHERE ur.region_id IN (" + ph + ") AND u.is_active = 1").all(...rids);

    const results = users.map(u => {
      // Tickets closed in period
      const closed = cnt(db, "SELECT COUNT(*) as c FROM tickets WHERE assignee_user_id = ? AND closed_at >= ? AND region_id IN (" + ph + ")", [u.id, startTs, ...rids]);
      // Currently open
      const open = cnt(db, "SELECT COUNT(*) as c FROM tickets WHERE assignee_user_id = ? AND status != 'CLOSED' AND region_id IN (" + ph + ")", [u.id, ...rids]);
      // Avg resolution time (ms) for tickets closed in period
      const avgRow = db.prepare("SELECT AVG(closed_at - created_at) as avg_time FROM tickets WHERE assignee_user_id = ? AND closed_at >= ? AND closed_at IS NOT NULL AND created_at IS NOT NULL AND region_id IN (" + ph + ")").get(u.id, startTs, ...rids);
      const avgResolutionMs = avgRow?.avg_time || 0;
      // Outbound emails sent in period
      const emailsSent = cnt(db, "SELECT COUNT(*) as c FROM audit_log WHERE actor_user_id = ? AND action_type = 'outbound_sent' AND ts >= ?", [u.id, startTs]);
      // Notes added in period
      const notesAdded = cnt(db, "SELECT COUNT(*) as c FROM audit_log WHERE actor_user_id = ? AND action_type = 'note_added' AND ts >= ?", [u.id, startTs]);
      // Total actions in period
      const totalActions = cnt(db, "SELECT COUNT(*) as c FROM audit_log WHERE actor_user_id = ? AND ts >= ?", [u.id, startTs]);

      return {
        user: { id: u.id, name: u.name, email: u.email, role: u.role, avatar: u.avatar, workStatus: u.work_status },
        closed, open, emailsSent, notesAdded, totalActions,
        avgResolutionHours: avgResolutionMs ? Math.round(avgResolutionMs / 3600000 * 10) / 10 : null,
      };
    });

    res.json({ coordinators: results.sort((a, b) => b.totalActions - a.totalActions) });
  } catch(e) { console.error('[Activity/performance]', e.message); res.json({ coordinators: [] }); }
});

// Tag distribution analytics
router.get('/activity/tags', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const rids = req.user.regionIds || [];
    if (!rids.length) return res.json({ tags: [] });
    const ph = rids.map(() => '?').join(',');

    const rows = db.prepare(
      "SELECT tg.id, tg.name, tg.color, COUNT(tt.ticket_id) as ticket_count, " +
      "SUM(CASE WHEN t.status != 'CLOSED' THEN 1 ELSE 0 END) as open_count " +
      "FROM tags tg " +
      "LEFT JOIN ticket_tags tt ON tt.tag_id = tg.id " +
      "LEFT JOIN tickets t ON t.id = tt.ticket_id AND t.region_id IN (" + ph + ") " +
      "GROUP BY tg.id ORDER BY ticket_count DESC"
    ).all(...rids);

    res.json({ tags: rows.map(r => ({ id: r.id, name: r.name, color: r.color, total: r.ticket_count, open: r.open_count })) });
  } catch(e) { console.error('[Activity/tags]', e.message); res.json({ tags: [] }); }
});

// Recent activity feed (audit log with enrichment)
router.get('/activity/feed', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const userId = req.query.userId || null;
    const actionType = req.query.actionType || null;
    const days = Math.min(parseInt(req.query.days) || 7, 90);
    const startTs = Date.now() - days * 86400000;

    let sql = "SELECT a.*, u.name as actor_name, u.avatar as actor_avatar FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id WHERE a.ts >= ?";
    const params = [startTs];

    if (userId) { sql += " AND a.actor_user_id = ?"; params.push(userId); }
    if (actionType) { sql += " AND a.action_type = ?"; params.push(actionType); }

    sql += " ORDER BY a.ts DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    const rows = db.prepare(sql).all(...params);
    const total = db.prepare("SELECT COUNT(*) as c FROM audit_log WHERE ts >= ?" + (userId ? " AND actor_user_id = '" + userId + "'" : "") + (actionType ? " AND action_type = '" + actionType + "'" : "")).get(startTs);

    res.json({
      feed: rows.map(r => ({
        id: r.id,
        actor: { id: r.actor_user_id, name: r.actor_name, avatar: r.actor_avatar },
        actionType: r.action_type,
        entityType: r.entity_type,
        entityId: r.entity_id,
        detail: r.detail,
        ts: Number(r.ts),
      })),
      total: total?.c || 0,
    });
  } catch(e) { console.error('[Activity/feed]', e.message); res.json({ feed: [], total: 0 }); }
});

// Hourly activity heatmap data
router.get('/activity/heatmap', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const days = Math.min(parseInt(req.query.days) || 14, 90);
    const startTs = Date.now() - days * 86400000;

    const rows = db.prepare("SELECT ts FROM audit_log WHERE ts >= ?").all(startTs);
    // Build heatmap: day-of-week (0-6) x hour (0-23)
    const heatmap = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const r of rows) {
      const d = new Date(Number(r.ts));
      heatmap[d.getDay()][d.getHours()]++;
    }
    res.json({ heatmap, days });
  } catch(e) { console.error('[Activity/heatmap]', e.message); res.json({ heatmap: [], days: 0 }); }
});

// Legacy catch-all
router.get('/', requireAuth, (req, res) => {
  res.json({ totalOpen: 0, unassigned: 0, closedToday: 0, triageCount: 0, oldestOpen: null });
});

module.exports = router;
