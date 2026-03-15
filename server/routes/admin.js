const express = require('express');
const { v4: uuid } = require('uuid');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getDb, saveDb } = require('../database');
const { requireAuth, addAudit, toStr } = require('../middleware');
const router = express.Router();

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// ── Users ────────────────────────────────────────────────────────────────────

router.get('/users', requireAuth, requireAdmin, (req, res) => {
  const db = getDb();
  const users = db.prepare('SELECT id, name, email, role, avatar, is_active FROM users ORDER BY name').all();
  users.forEach(u => {
    const regions = db.prepare('SELECT r.id, r.name FROM regions r JOIN user_regions ur ON ur.region_id = r.id WHERE ur.user_id = ?').all(u.id);
    u.regions = regions;
    u.regionIds = regions.map(r => r.id);
    const pw = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(u.id);
    u.hasPassword = !!(pw && pw.password_hash);
  });
  res.json({ users });
});

router.post('/users', requireAuth, requireAdmin, async (req, res) => {
  const db = getDb();
  const { name, email, role, regionIds } = req.body;
  if (!name?.trim() || !email?.trim() || !role) {
    return res.status(400).json({ error: 'name, email, and role are required' });
  }
  if (!['coordinator', 'supervisor', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.trim());
  if (existing) return res.status(409).json({ error: 'Email already exists' });

  const id = 'u-' + uuid().split('-')[0];
  const initials = name.trim().split(' ').map(w => w[0]).join('').toUpperCase().substring(0, 2);
  const tempPassword = crypto.randomBytes(6).toString('hex');
  const tempHash = tempPassword; // Store unhashed so first login triggers password change

  db.prepare('INSERT INTO users (id, name, email, role, avatar, is_active, password_hash) VALUES (?, ?, ?, ?, ?, 1, ?)')
    .run(id, name.trim(), email.trim(), role, initials, tempPassword);

  if (regionIds && regionIds.length > 0) {
    const ins = db.prepare('INSERT INTO user_regions (user_id, region_id) VALUES (?, ?)');
    regionIds.forEach(rId => ins.run(id, rId));
  }
  saveDb();

  addAudit(db, req.user.id, 'user_created', 'user', id, 'Created user: ' + name.trim());
  res.json({ user: { id, name: name.trim(), email: email.trim(), role, avatar: initials, is_active: 1, regionIds: regionIds || [] }, tempPassword });
});

router.put('/users/:id', requireAuth, requireAdmin, (req, res) => {
  const db = getDb();
  const { name, email, role } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const newName = name?.trim() || user.name;
  const newEmail = email?.trim() || user.email;
  const newRole = role || user.role;
  const initials = newName.split(' ').map(w => w[0]).join('').toUpperCase().substring(0, 2);

  if (newEmail !== user.email) {
    const dup = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(newEmail, req.params.id);
    if (dup) return res.status(409).json({ error: 'Email already exists' });
  }

  db.prepare('UPDATE users SET name = ?, email = ?, role = ?, avatar = ? WHERE id = ?')
    .run(newName, newEmail, newRole, initials, req.params.id);
  saveDb();

  addAudit(db, req.user.id, 'user_updated', 'user', req.params.id, 'Updated user: ' + newName);
  res.json({ success: true });
});

router.delete('/users/:id', requireAuth, requireAdmin, (req, res) => {
  const db = getDb();
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: 'Cannot deactivate yourself' });
  }
  const user = db.prepare('SELECT name FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(req.params.id);
  // Unassign their tickets back to queue
  db.prepare("UPDATE tickets SET assignee_user_id = NULL, last_activity_at = ? WHERE assignee_user_id = ? AND status != 'CLOSED'")
    .run(Date.now(), req.params.id);
  saveDb();

  addAudit(db, req.user.id, 'user_deactivated', 'user', req.params.id, 'Deactivated user: ' + user.name);
  res.json({ success: true });
});

router.post('/users/:id/reactivate', requireAuth, requireAdmin, (req, res) => {
  const db = getDb();
  db.prepare('UPDATE users SET is_active = 1 WHERE id = ?').run(req.params.id);
  saveDb();
  addAudit(db, req.user.id, 'user_reactivated', 'user', req.params.id, 'Reactivated user');
  res.json({ success: true });
});

router.post('/users/:id/reset-password', requireAuth, requireAdmin, async (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT name FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const tempPassword = crypto.randomBytes(6).toString('hex');
  db.prepare('UPDATE users SET password_hash = ?, totp_enabled = 0, totp_secret = NULL WHERE id = ?').run(tempPassword, req.params.id);
  saveDb();

  addAudit(db, req.user.id, 'password_reset', 'user', req.params.id, 'Password reset for: ' + user.name);
  res.json({ tempPassword });
});

router.post('/users/:id/regions', requireAuth, requireAdmin, (req, res) => {
  const db = getDb();
  const { regionIds } = req.body;
  if (!Array.isArray(regionIds)) return res.status(400).json({ error: 'regionIds must be an array' });

  db.prepare('DELETE FROM user_regions WHERE user_id = ?').run(req.params.id);
  const ins = db.prepare('INSERT INTO user_regions (user_id, region_id) VALUES (?, ?)');
  regionIds.forEach(rId => ins.run(req.params.id, rId));
  saveDb();

  addAudit(db, req.user.id, 'regions_updated', 'user', req.params.id, 'Regions set to: ' + regionIds.join(', '));
  res.json({ success: true, regionIds });
});

// ── Regions ──────────────────────────────────────────────────────────────────

router.get('/regions', requireAuth, requireAdmin, (req, res) => {
  const db = getDb();
  const regions = db.prepare('SELECT * FROM regions ORDER BY name').all();
  regions.forEach(r => {
    r.routing_aliases = JSON.parse(r.routing_aliases || '[]');
    const users = db.prepare('SELECT u.id, u.name, u.role FROM users u JOIN user_regions ur ON ur.user_id = u.id WHERE ur.region_id = ? AND u.is_active = 1').all(r.id);
    r.users = users;
  });
  res.json({ regions });
});

router.post('/regions', requireAuth, requireAdmin, (req, res) => {
  const db = getDb();
  const { name, routingAliases } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });

  const id = 'r-' + uuid().split('-')[0];
  const aliases = routingAliases || [];
  db.prepare('INSERT INTO regions (id, name, routing_aliases, is_active) VALUES (?, ?, ?, 1)')
    .run(id, name.trim(), JSON.stringify(aliases));
  saveDb();

  addAudit(db, req.user.id, 'region_created', 'region', id, 'Created region: ' + name.trim());
  res.json({ region: { id, name: name.trim(), routing_aliases: aliases, is_active: 1, users: [] } });
});

router.put('/regions/:id', requireAuth, requireAdmin, (req, res) => {
  const db = getDb();
  const { name, routingAliases } = req.body;
  const region = db.prepare('SELECT * FROM regions WHERE id = ?').get(req.params.id);
  if (!region) return res.status(404).json({ error: 'Region not found' });

  db.prepare('UPDATE regions SET name = ?, routing_aliases = ? WHERE id = ?')
    .run(name?.trim() || region.name, JSON.stringify(routingAliases || JSON.parse(region.routing_aliases || '[]')), req.params.id);
  saveDb();

  addAudit(db, req.user.id, 'region_updated', 'region', req.params.id, 'Updated region: ' + (name?.trim() || region.name));
  res.json({ success: true });
});

router.delete('/regions/:id', requireAuth, requireAdmin, (req, res) => {
  const db = getDb();
  const region = db.prepare('SELECT name FROM regions WHERE id = ?').get(req.params.id);
  if (!region) return res.status(404).json({ error: 'Region not found' });

  const openTickets = db.prepare("SELECT COUNT(*) as cnt FROM tickets WHERE region_id = ? AND status != 'CLOSED'").get(req.params.id);
  if (openTickets.cnt > 0) {
    return res.status(400).json({ error: 'Cannot deactivate region with ' + openTickets.cnt + ' open tickets. Reassign or close them first.' });
  }

  db.prepare('UPDATE regions SET is_active = 0 WHERE id = ?').run(req.params.id);
  saveDb();

  addAudit(db, req.user.id, 'region_deactivated', 'region', req.params.id, 'Deactivated region: ' + region.name);
  res.json({ success: true });
});


// ── Tag Management (admin/supervisor) ──
router.get('/tags', requireAuth, (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'supervisor') return res.status(403).json({ error: 'Not authorized' });
  const tags = getDb().prepare('SELECT * FROM tags ORDER BY name').all();
  res.json({ tags: tags.map(t => ({ id: toStr(t.id), name: toStr(t.name), color: toStr(t.color) })) });
});

router.post('/tags', requireAuth, (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'supervisor') return res.status(403).json({ error: 'Not authorized' });
  const { name, color } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const id = 't' + Date.now();
  getDb().prepare('INSERT INTO tags (id, name, color) VALUES (?, ?, ?)').run(id, name, color || '#6b7280');
  saveDb();
  res.json({ id, name, color: color || '#6b7280' });
});

router.put('/tags/:id', requireAuth, (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'supervisor') return res.status(403).json({ error: 'Not authorized' });
  const { name, color } = req.body;
  getDb().prepare('UPDATE tags SET name = COALESCE(?, name), color = COALESCE(?, color) WHERE id = ?').run(name || null, color || null, req.params.id);
  saveDb();
  res.json({ ok: true });
});

router.delete('/tags/:id', requireAuth, (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'supervisor') return res.status(403).json({ error: 'Not authorized' });
  const db = getDb();
  db.prepare('DELETE FROM ticket_tags WHERE tag_id = ?').run(req.params.id);
  db.prepare('DELETE FROM tags WHERE id = ?').run(req.params.id);
  saveDb();
  res.json({ ok: true });
});

module.exports = router;
