const { getDb, saveDb } = require('./database');

function toStr(v) { if (v instanceof Uint8Array) return Buffer.from(v).toString('utf8'); return v == null ? null : String(v); }

function requireAuth(req, res, next) {
  const sid = req.cookies?.sid;
  if (!sid) return res.status(401).json({ error: 'Not authenticated' });

  const db = getDb();
  const session = db.prepare('SELECT * FROM sessions WHERE sid = ? AND expires > ?').get(sid, Date.now());
  if (!session) return res.status(401).json({ error: 'Session expired' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id);
  if (!user) return res.status(401).json({ error: 'User not found' });

  // Touch last_active on every authenticated request
  try { db.prepare('UPDATE sessions SET last_active = ? WHERE sid = ?').run(Date.now(), sid); } catch(e) {}

  const regions = db.prepare('SELECT region_id FROM user_regions WHERE user_id = ?').all(session.user_id);
  req.user = {
    id: toStr(user.id), name: toStr(user.name), email: toStr(user.email),
    role: toStr(user.role), regionIds: regions.map(r => r.region_id),
  };
  next();
}

function requireSupervisor(req, res, next) {
  if (req.user && (req.user.role === 'supervisor' || req.user.role === 'admin')) return next();
  res.status(403).json({ error: 'Forbidden' });
}

function addAudit(db, userId, action, entityType, entityId, detail) {
  try {
    const { v4: uuid } = require('uuid');
    db.prepare('INSERT INTO audit_log (id, actor_user_id, action_type, entity_type, entity_id, ts, detail) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(uuid(), userId, action, entityType, entityId, Date.now(), detail);
    saveDb();
  } catch(e) { console.error('[Audit]', e.message); }
}

module.exports = { requireAuth, requireSupervisor, addAudit, toStr };
