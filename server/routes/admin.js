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
  const users = db.prepare('SELECT id, name, email, role, avatar, is_active, profile_photo_url as photoUrl FROM users ORDER BY name').all();
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
  const tempHash = bcrypt.hashSync(tempPassword, 10);

  db.prepare('INSERT INTO users (id, name, email, role, avatar, is_active, password_hash) VALUES (?, ?, ?, ?, ?, 1, ?)')
    .run(id, name.trim(), email.trim(), role, initials, tempHash);

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
  // Invalidate all sessions for the deactivated user
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(req.params.id);
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
  const resetHash = bcrypt.hashSync(tempPassword, 10);
  db.prepare('UPDATE users SET password_hash = ?, totp_enabled = 0, totp_secret = NULL WHERE id = ?').run(resetHash, req.params.id);
  saveDb();

  addAudit(db, req.user.id, 'password_reset', 'user', req.params.id, 'Password reset for: ' + user.name);
  res.json({ tempPassword });
});

router.post('/users/:id/regions', requireAuth, requireAdmin, (req, res) => {
  const db = getDb();
  const { regionIds } = req.body;
  if (!Array.isArray(regionIds)) return res.status(400).json({ error: 'regionIds must be an array' });

  // Find which regions the user is being removed from
  const oldRegions = db.prepare('SELECT region_id FROM user_regions WHERE user_id = ?').all(req.params.id).map(r => r.region_id);
  const removedRegions = oldRegions.filter(r => !regionIds.includes(r));

  db.prepare('DELETE FROM user_regions WHERE user_id = ?').run(req.params.id);
  const ins = db.prepare('INSERT INTO user_regions (user_id, region_id) VALUES (?, ?)');
  regionIds.forEach(rId => ins.run(req.params.id, rId));

  // Unassign tickets in removed regions so they return to the queue
  if (removedRegions.length > 0) {
    for (const rid of removedRegions) {
      db.prepare("UPDATE tickets SET assignee_user_id = NULL, assigned_at = NULL WHERE assignee_user_id = ? AND region_id = ? AND status != 'CLOSED'")
        .run(req.params.id, rid);
    }
  }

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
    r.closure = {
      enabled: !!r.closure_enabled,
      start: r.closure_start || null,
      end: r.closure_end || null,
      subject: r.closure_subject || '',
      message: r.closure_message || '',
    };
  });
  res.json({ regions });
});

// Save the holiday/closure auto-responder settings for a region. While
// enabled (and within [start,end] if set), any external sender whose mail
// routes to this region gets a one-time auto-reply.
router.put('/regions/:id/closure', requireAuth, requireAdmin, (req, res) => {
  const db = getDb();
  const region = db.prepare('SELECT id FROM regions WHERE id = ?').get(req.params.id);
  if (!region) return res.status(404).json({ error: 'Region not found' });
  const b = req.body || {};
  const enabled = b.enabled ? 1 : 0;
  const start = Number.isFinite(b.start) ? Math.floor(b.start) : null;
  const end = Number.isFinite(b.end) ? Math.floor(b.end) : null;
  const subject = typeof b.subject === 'string' ? b.subject.slice(0, 200) : '';
  const message = typeof b.message === 'string' ? b.message.replace(/\r\n/g, '\n').slice(0, 3000) : '';
  db.prepare('UPDATE regions SET closure_enabled=?, closure_start=?, closure_end=?, closure_subject=?, closure_message=? WHERE id=?')
    .run(enabled, start, end, subject || null, message || null, req.params.id);
  saveDb();
  addAudit(db, req.user.id, 'region_closure_updated', 'region', req.params.id, enabled ? 'Closure enabled' : 'Closure cleared');
  res.json({ closure: { enabled: !!enabled, start, end, subject, message } });
});

// Normalize aliases on save: lowercase, trim, drop empties + duplicates.
// Sync-side matching lowercases recipients before comparing, so any stored
// alias with stray whitespace or mixed case would silently fail to match.
function sanitizeAliases(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const a = raw.trim().toLowerCase();
    if (!a || seen.has(a)) continue;
    seen.add(a);
    out.push(a);
  }
  return out;
}

router.post('/regions', requireAuth, requireAdmin, (req, res) => {
  const db = getDb();
  const { name, routingAliases } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });

  const id = 'r-' + uuid().split('-')[0];
  const aliases = sanitizeAliases(routingAliases);
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

  const nextAliases = routingAliases !== undefined
    ? sanitizeAliases(routingAliases)
    : JSON.parse(region.routing_aliases || '[]');
  db.prepare('UPDATE regions SET name = ?, routing_aliases = ? WHERE id = ?')
    .run(name?.trim() || region.name, JSON.stringify(nextAliases), req.params.id);
  saveDb();

  addAudit(db, req.user.id, 'region_updated', 'region', req.params.id, 'Updated region: ' + (name?.trim() || region.name));
  res.json({ success: true });
});

// ── Diagnose-routing ─────────────────────────────────────────────────────────
// Given a test address, returns whether any region's alias list would catch it,
// plus the full alias inventory and a note on whether any active connected user
// has that mailbox (because an unmatched alias OR an unreached mailbox can both
// explain "I sent to Region1 and nothing showed up").
router.post('/diagnose-routing', requireAuth, requireAdmin, (req, res) => {
  const db = getDb();
  const raw = String(req.body?.testEmail || '').trim().toLowerCase();
  if (!raw) return res.status(400).json({ error: 'testEmail required' });
  // Extract the bare email if user pasted "Name <addr@x>" form
  const m = raw.match(/<([^>]+)>/);
  const testEmail = (m ? m[1] : raw).trim();

  const regions = db.prepare("SELECT id, name, routing_aliases, is_active FROM regions WHERE is_active = 1").all();
  const allAliases = [];
  let matchedRegion = null;
  for (const r of regions) {
    const aliases = JSON.parse(r.routing_aliases || '[]');
    for (const a of aliases) {
      const aLow = String(a).trim().toLowerCase();
      allAliases.push({ alias: aLow, regionId: r.id, regionName: r.name });
      // Mirror sync exactly: sync does recipientList.includes(alias) on a
      // lowercased recipient string. So the alias must be a substring of
      // testEmail. A misleading bidirectional check would falsely predict
      // matches that the real sync won't make.
      if (!matchedRegion && aLow && testEmail.includes(aLow)) {
        matchedRegion = { id: r.id, name: r.name, viaAlias: aLow };
      }
    }
  }

  // Is this address one of our connected users' actual mailboxes? If yes, the
  // sync will see it directly. If no, the email only routes if it's forwarded
  // into a connected user's inbox.
  const userMatch = db.prepare(
    'SELECT u.id, u.name, u.email FROM users u WHERE u.is_active = 1 AND LOWER(u.email) = ? LIMIT 1'
  ).get(testEmail);

  const connectedToken = userMatch
    ? db.prepare('SELECT 1 FROM gmail_tokens WHERE user_id = ? AND access_token IS NOT NULL').get(userMatch.id)
    : null;

  const notes = [];
  if (!matchedRegion) {
    notes.push('No region alias matches this address. Either add it to a region\'s "Routing Email Aliases", or send to a recipient whose address is already an alias.');
  }
  if (!userMatch) {
    notes.push('This address is not a CareCoord user mailbox. The sync only sees mail that lands in a connected user\'s Gmail inbox — confirm the address forwards into one.');
  } else if (!connectedToken) {
    const sa = !!(process.env.SA_CLIENT_EMAIL || require('fs').existsSync(require('path').join(__dirname, '..', 'service-account.json')));
    if (!sa) notes.push('User ' + userMatch.name + ' exists but has no OAuth tokens, and no service account is configured — their inbox cannot be synced.');
  }

  res.json({
    testEmail,
    matchedRegion,
    allAliases,
    userMailbox: userMatch ? { id: userMatch.id, name: userMatch.name, email: userMatch.email, hasOAuth: !!connectedToken } : null,
    notes,
  });
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
  const regionId = req.query.regionId;
  const filtered = regionId ? tags.filter(t => !t.region_id || toStr(t.region_id) === regionId) : tags;
  res.json({ tags: filtered.map(t => {
    const pid = t.parent_id != null ? toStr(t.parent_id) : null;
    const rid = t.region_id != null ? toStr(t.region_id) : null;
    return { id: toStr(t.id), name: toStr(t.name), color: toStr(t.color), parentId: pid || null, regionId: rid || null };
  }) });
});

router.post('/tags', requireAuth, (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'supervisor') return res.status(403).json({ error: 'Not authorized' });
  const { name, color, parentId, regionId } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const id = 't' + Date.now();
  const db = getDb();
  try {
    db.prepare('INSERT INTO tags (id, name, color, parent_id, region_id) VALUES (?, ?, ?, ?, ?)').run(id, name, color || '#6b7280', parentId || null, regionId || null);
  } catch(e) {
    // Fallback if parent_id/region_id columns don't exist yet
    db.prepare('INSERT INTO tags (id, name, color) VALUES (?, ?, ?)').run(id, name, color || '#6b7280');
    try { db.prepare('UPDATE tags SET parent_id = ?, region_id = ? WHERE id = ?').run(parentId || null, regionId || null, id); } catch(e2) {}
  }
  saveDb();
  res.json({ id, name, color: color || '#6b7280', parentId: parentId || null, regionId: regionId || null });
});

router.put('/tags/:id', requireAuth, (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'supervisor') return res.status(403).json({ error: 'Not authorized' });
  const { name, color, parentId, regionId } = req.body;
  const db = getDb();
  db.prepare('UPDATE tags SET name = COALESCE(?, name), color = COALESCE(?, color) WHERE id = ?').run(name || null, color || null, req.params.id);
  if (parentId !== undefined) db.prepare('UPDATE tags SET parent_id = ? WHERE id = ?').run(parentId || null, req.params.id);
  if (regionId !== undefined) db.prepare('UPDATE tags SET region_id = ? WHERE id = ?').run(regionId || null, req.params.id);
  saveDb();
  res.json({ ok: true });
});

router.delete('/tags/:id', requireAuth, (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'supervisor') return res.status(403).json({ error: 'Not authorized' });
  const db = getDb();
  // Recursively delete subtags (handles nested hierarchies)
  const deleteTagRecursive = (tagId) => {
    const children = db.prepare('SELECT id FROM tags WHERE parent_id = ?').all(tagId);
    for (const child of children) {
      deleteTagRecursive(toStr(child.id));
    }
    db.prepare('DELETE FROM ticket_tags WHERE tag_id = ?').run(tagId);
    db.prepare('DELETE FROM tags WHERE id = ?').run(tagId);
  };
  deleteTagRecursive(req.params.id);
  saveDb();
  res.json({ ok: true });
});

module.exports = router;
