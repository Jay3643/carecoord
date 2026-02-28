const express = require('express');
const { getDb } = require('../database');
const { requireAuth, requireSupervisor } = require('../middleware');

const router = express.Router();

// GET /api/dashboard/summary
router.get('/summary', requireAuth, requireSupervisor, (req, res) => {
  const db = getDb();
  const now = Date.now();
  const dayAgo = now - 86400000;

  const totalOpen = db.prepare("SELECT COUNT(*) as count FROM tickets WHERE status != 'CLOSED'").get().count;
  const unassigned = db.prepare("SELECT COUNT(*) as count FROM tickets WHERE status != 'CLOSED' AND assignee_user_id IS NULL").get().count;
  const closedToday = db.prepare("SELECT COUNT(*) as count FROM tickets WHERE status = 'CLOSED' AND closed_at > ?").get(dayAgo).count;
  const triageCount = db.prepare("SELECT COUNT(*) as count FROM tickets WHERE status != 'CLOSED' AND region_id = 'r4'").get().count;

  const oldestOpen = db.prepare("SELECT * FROM tickets WHERE status != 'CLOSED' ORDER BY created_at ASC LIMIT 1").get();
  if (oldestOpen) oldestOpen.external_participants = JSON.parse(oldestOpen.external_participants || '[]');

  res.json({ totalOpen, unassigned, closedToday, triageCount, oldestOpen });
});

// GET /api/dashboard/by-region
router.get('/by-region', requireAuth, requireSupervisor, (req, res) => {
  const db = getDb();
  const regions = db.prepare("SELECT * FROM regions WHERE id != 'r4' AND is_active = 1").all();

  const result = regions.map(r => {
    const open = db.prepare("SELECT COUNT(*) as count FROM tickets WHERE region_id = ? AND status != 'CLOSED'").get(r.id).count;
    const unassigned = db.prepare("SELECT COUNT(*) as count FROM tickets WHERE region_id = ? AND status != 'CLOSED' AND assignee_user_id IS NULL").get(r.id).count;
    return { region: r, open, unassigned };
  });

  res.json({ regions: result });
});

// GET /api/dashboard/by-coordinator
router.get('/by-coordinator', requireAuth, requireSupervisor, (req, res) => {
  const db = getDb();
  const dayAgo = Date.now() - 86400000;
  const coordinators = db.prepare("SELECT * FROM users WHERE role = 'coordinator' AND is_active = 1").all();

  const result = coordinators.map(u => {
    const open = db.prepare("SELECT COUNT(*) as count FROM tickets WHERE assignee_user_id = ? AND status != 'CLOSED'").get(u.id).count;
    const closedToday = db.prepare("SELECT COUNT(*) as count FROM tickets WHERE assignee_user_id = ? AND status = 'CLOSED' AND closed_at > ?").get(u.id, dayAgo).count;
    return { user: u, open, closedToday };
  });

  res.json({ coordinators: result });
});

module.exports = router;
