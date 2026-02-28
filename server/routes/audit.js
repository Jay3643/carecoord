const express = require('express');
const { getDb } = require('../database');
const { requireAuth, requireSupervisor } = require('../middleware');

const router = express.Router();

// GET /api/audit
router.get('/', requireAuth, requireSupervisor, (req, res) => {
  const db = getDb();
  const { filter, limit = 200 } = req.query;

  let sql = `
    SELECT a.*, u.name as actor_name, u.avatar as actor_avatar
    FROM audit_log a
    LEFT JOIN users u ON u.id = a.actor_user_id
  `;
  const params = [];

  if (filter && filter !== 'all') {
    sql += ' WHERE a.action_type = ?';
    params.push(filter);
  }

  sql += ' ORDER BY a.ts DESC LIMIT ?';
  params.push(parseInt(limit));

  const entries = db.prepare(sql).all(...params);

  // Get unique action types for filter dropdown
  const actionTypes = db.prepare('SELECT DISTINCT action_type FROM audit_log ORDER BY action_type').all()
    .map(r => r.action_type);

  res.json({ entries, actionTypes });
});

module.exports = router;
