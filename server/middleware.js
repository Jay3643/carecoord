const { getDb, saveDb } = require('./database');

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
