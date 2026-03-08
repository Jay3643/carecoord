const express = require('express');
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
