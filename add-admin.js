// add-admin.js
// Run from the carecoord folder: node add-admin.js
// Adds Admin Panel: manage users, regions, assignments, password resets

const fs = require('fs');
const path = require('path');

function patchFile(relPath, replacements) {
  const fullPath = path.join(__dirname, relPath);
  let content = fs.readFileSync(fullPath, 'utf8');
  for (const [find, replace] of replacements) {
    if (!content.includes(find)) {
      console.log('  ⚠ Could not find patch target in ' + relPath + ': ' + find.substring(0, 60) + '...');
      continue;
    }
    content = content.replace(find, replace);
  }
  fs.writeFileSync(fullPath, content, 'utf8');
}

console.log('\n🔧 Adding Admin Panel...\n');

// ─── 1. CREATE: server/routes/admin.js ───────────────────────────────────────

fs.writeFileSync(path.join(__dirname, 'server', 'routes', 'admin.js'), `const express = require('express');
const { v4: uuid } = require('uuid');
const crypto = require('crypto');
const { getDb, saveDb } = require('../database');
const { requireAuth, addAudit } = require('../middleware');
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

router.post('/users', requireAuth, requireAdmin, (req, res) => {
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

router.post('/users/:id/reset-password', requireAuth, requireAdmin, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT name FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const tempPassword = crypto.randomBytes(6).toString('hex');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(tempPassword, req.params.id);
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

module.exports = router;
`, 'utf8');
console.log('  ✓ server/routes/admin.js — created');

// ─── 2. Add password_hash column if missing ──────────────────────────────────

const dbPath = path.join(__dirname, 'server', 'database.js');
let dbJs = fs.readFileSync(dbPath, 'utf8');

if (!dbJs.includes('password_hash')) {
  dbJs = dbJs.replace(
    'avatar TEXT, is_active INTEGER DEFAULT 1',
    'avatar TEXT, is_active INTEGER DEFAULT 1, password_hash TEXT'
  );
  fs.writeFileSync(dbPath, dbJs, 'utf8');
  console.log('  ✓ server/database.js — added password_hash column');
} else {
  console.log('  ✓ server/database.js — password_hash already present');
}

// ─── 3. Register admin route in server/index.js ──────────────────────────────

const indexPath = path.join(__dirname, 'server', 'index.js');
let indexJs = fs.readFileSync(indexPath, 'utf8');

if (!indexJs.includes('/api/admin')) {
  indexJs = indexJs.replace(
    "app.use('/api/audit', require('./routes/audit'));",
    "app.use('/api/audit', require('./routes/audit'));\napp.use('/api/admin', require('./routes/admin'));"
  );
  fs.writeFileSync(indexPath, indexJs, 'utf8');
  console.log('  ✓ server/index.js — registered /api/admin route');
} else {
  console.log('  ✓ server/index.js — admin route already registered');
}

// ─── 4. Add API methods in client/src/api.js ─────────────────────────────────

const apiPath = path.join(__dirname, 'client', 'src', 'api.js');
let apiJs = fs.readFileSync(apiPath, 'utf8');

if (!apiJs.includes('adminGetUsers')) {
  apiJs = apiJs.replace(
    '};',
    `
  // Admin
  adminGetUsers: () => request('/admin/users'),
  adminCreateUser: (data) => request('/admin/users', { method: 'POST', body: data }),
  adminUpdateUser: (id, data) => request(\`/admin/users/\${id}\`, { method: 'PUT', body: data }),
  adminDeleteUser: (id) => request(\`/admin/users/\${id}\`, { method: 'DELETE' }),
  adminReactivateUser: (id) => request(\`/admin/users/\${id}/reactivate\`, { method: 'POST' }),
  adminResetPassword: (id) => request(\`/admin/users/\${id}/reset-password\`, { method: 'POST' }),
  adminSetUserRegions: (id, regionIds) => request(\`/admin/users/\${id}/regions\`, { method: 'POST', body: { regionIds } }),
  adminGetRegions: () => request('/admin/regions'),
  adminCreateRegion: (data) => request('/admin/regions', { method: 'POST', body: data }),
  adminUpdateRegion: (id, data) => request(\`/admin/regions/\${id}\`, { method: 'PUT', body: data }),
  adminDeleteRegion: (id) => request(\`/admin/regions/\${id}\`, { method: 'DELETE' }),
};`
  );
  fs.writeFileSync(apiPath, apiJs, 'utf8');
  console.log('  ✓ client/src/api.js — added admin methods');
} else {
  console.log('  ✓ client/src/api.js — admin methods already present');
}

// ─── 5. CREATE: client/src/components/AdminPanel.jsx ─────────────────────────

fs.writeFileSync(path.join(__dirname, 'client', 'src', 'components', 'AdminPanel.jsx'), `import React, { useState, useEffect } from 'react';
import { api } from '../api';
import Icon from './Icons';
import { Avatar } from './ui';

export default function AdminPanel({ currentUser, showToast }) {
  const [tab, setTab] = useState('users');
  const [users, setUsers] = useState([]);
  const [regions, setRegions] = useState([]);
  const [loading, setLoading] = useState(true);

  // Modals
  const [showUserModal, setShowUserModal] = useState(false);
  const [showRegionModal, setShowRegionModal] = useState(false);
  const [showRegionAssign, setShowRegionAssign] = useState(null);
  const [showPasswordResult, setShowPasswordResult] = useState(null);
  const [editingUser, setEditingUser] = useState(null);
  const [editingRegion, setEditingRegion] = useState(null);
  const [showInactive, setShowInactive] = useState(false);

  // User form
  const [uName, setUName] = useState('');
  const [uEmail, setUEmail] = useState('');
  const [uRole, setURole] = useState('coordinator');
  const [uRegionIds, setURegionIds] = useState([]);

  // Region form
  const [rName, setRName] = useState('');
  const [rAliases, setRAliases] = useState('');

  const fetchData = async () => {
    setLoading(true);
    try {
      const [uData, rData] = await Promise.all([api.adminGetUsers(), api.adminGetRegions()]);
      setUsers(uData.users);
      setRegions(rData.regions);
    } catch (e) { showToast(e.message); }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  // ── User actions ───────────────────────────────────────────────────────────

  const openNewUser = () => {
    setEditingUser(null); setUName(''); setUEmail(''); setURole('coordinator'); setURegionIds([]);
    setShowUserModal(true);
  };

  const openEditUser = (u) => {
    setEditingUser(u); setUName(u.name); setUEmail(u.email); setURole(u.role); setURegionIds(u.regionIds || []);
    setShowUserModal(true);
  };

  const saveUser = async () => {
    try {
      if (editingUser) {
        await api.adminUpdateUser(editingUser.id, { name: uName, email: uEmail, role: uRole });
        await api.adminSetUserRegions(editingUser.id, uRegionIds);
        showToast('User updated');
      } else {
        const data = await api.adminCreateUser({ name: uName, email: uEmail, role: uRole, regionIds: uRegionIds });
        setShowPasswordResult(data.tempPassword);
        showToast('User created');
      }
      setShowUserModal(false);
      fetchData();
    } catch (e) { showToast(e.message); }
  };

  const deleteUser = async (u) => {
    if (!confirm('Deactivate ' + u.name + '? Their open tickets will be returned to the queue.')) return;
    try {
      await api.adminDeleteUser(u.id);
      showToast(u.name + ' deactivated');
      fetchData();
    } catch (e) { showToast(e.message); }
  };

  const reactivateUser = async (u) => {
    try {
      await api.adminReactivateUser(u.id);
      showToast(u.name + ' reactivated');
      fetchData();
    } catch (e) { showToast(e.message); }
  };

  const resetPassword = async (u) => {
    try {
      const data = await api.adminResetPassword(u.id);
      setShowPasswordResult(data.tempPassword);
      showToast('Password reset for ' + u.name);
    } catch (e) { showToast(e.message); }
  };

  const saveRegionAssignment = async (userId, regionIds) => {
    try {
      await api.adminSetUserRegions(userId, regionIds);
      showToast('Regions updated');
      setShowRegionAssign(null);
      fetchData();
    } catch (e) { showToast(e.message); }
  };

  // ── Region actions ─────────────────────────────────────────────────────────

  const openNewRegion = () => {
    setEditingRegion(null); setRName(''); setRAliases('');
    setShowRegionModal(true);
  };

  const openEditRegion = (r) => {
    setEditingRegion(r); setRName(r.name); setRAliases((r.routing_aliases || []).join(', '));
    setShowRegionModal(true);
  };

  const saveRegion = async () => {
    const aliases = rAliases.split(',').map(s => s.trim()).filter(Boolean);
    try {
      if (editingRegion) {
        await api.adminUpdateRegion(editingRegion.id, { name: rName, routingAliases: aliases });
        showToast('Region updated');
      } else {
        await api.adminCreateRegion({ name: rName, routingAliases: aliases });
        showToast('Region created');
      }
      setShowRegionModal(false);
      fetchData();
    } catch (e) { showToast(e.message); }
  };

  const deleteRegion = async (r) => {
    if (!confirm('Deactivate ' + r.name + '? Only works if no open tickets remain.')) return;
    try {
      await api.adminDeleteRegion(r.id);
      showToast(r.name + ' deactivated');
      fetchData();
    } catch (e) { showToast(e.message); }
  };

  // ── Shared styles ──────────────────────────────────────────────────────────

  const s = {
    card: { background: '#161822', border: '1px solid #1e2030', borderRadius: 10, padding: 16, marginBottom: 8 },
    btn: (bg, fg) => ({ padding: '6px 14px', background: bg, color: fg, border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600 }),
    btnOutline: { padding: '6px 14px', background: '#1e2030', color: '#94a3b8', border: '1px solid #2a2d3e', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600 },
    input: { width: '100%', padding: '10px 14px', background: '#1e2030', border: '1px solid #2a2d3e', borderRadius: 8, color: '#e2e8f0', fontSize: 13, outline: 'none', boxSizing: 'border-box' },
    label: { fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: '#64748b', display: 'block', marginBottom: 6 },
    roleBadge: (role) => ({
      fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, padding: '2px 8px', borderRadius: 4,
      background: role === 'admin' ? '#ef444420' : role === 'supervisor' ? '#f59e0b20' : '#6366f120',
      color: role === 'admin' ? '#ef4444' : role === 'supervisor' ? '#f59e0b' : '#6366f1',
    }),
  };

  const filteredUsers = showInactive ? users : users.filter(u => u.is_active);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '16px 24px', borderBottom: '1px solid #1e2030', background: '#13151f' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, letterSpacing: -0.3 }}>Administration</h1>
        </div>
        <div style={{ display: 'flex', gap: 4, background: '#1e2030', borderRadius: 8, padding: 3, border: '1px solid #2a2d3e', width: 'fit-content' }}>
          {['users', 'regions'].map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{ padding: '6px 18px', borderRadius: 6, border: 'none', background: tab === t ? '#6366f1' : 'transparent', color: tab === t ? '#fff' : '#94a3b8', fontSize: 12, fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize' }}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
        {loading && <div style={{ color: '#475569', textAlign: 'center', marginTop: 40 }}>Loading...</div>}

        {/* ── USERS TAB ── */}
        {!loading && tab === 'users' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{filteredUsers.length} Users</span>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#64748b', cursor: 'pointer' }}>
                  <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
                  Show inactive
                </label>
              </div>
              <button onClick={openNewUser} style={s.btn('#6366f1', '#fff')}>
                + Add User
              </button>
            </div>

            {filteredUsers.map(u => (
              <div key={u.id} style={{ ...s.card, opacity: u.is_active ? 1 : 0.5, display: 'flex', alignItems: 'center', gap: 14 }}>
                <Avatar user={u} size={36} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{u.name}</span>
                    <span style={s.roleBadge(u.role)}>{u.role}</span>
                    {!u.is_active && <span style={{ fontSize: 10, color: '#ef4444', fontWeight: 600 }}>INACTIVE</span>}
                  </div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>{u.email}</div>
                  <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                    {(u.regions || []).map(r => (
                      <span key={r.id} style={{ fontSize: 10, padding: '1px 8px', background: '#1e2030', borderRadius: 4, color: '#94a3b8' }}>{r.name}</span>
                    ))}
                    {(!u.regions || u.regions.length === 0) && <span style={{ fontSize: 10, color: '#475569', fontStyle: 'italic' }}>No regions assigned</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  {u.is_active && (
                    <>
                      <button onClick={() => openEditUser(u)} style={s.btnOutline}>Edit</button>
                      <button onClick={() => setShowRegionAssign(u)} style={s.btnOutline}>Regions</button>
                      <button onClick={() => resetPassword(u)} style={{ ...s.btnOutline, color: '#f59e0b', borderColor: '#f59e0b40' }}>Reset PW</button>
                      {u.id !== currentUser.id && (
                        <button onClick={() => deleteUser(u)} style={{ ...s.btnOutline, color: '#ef4444', borderColor: '#ef444440' }}>Deactivate</button>
                      )}
                    </>
                  )}
                  {!u.is_active && (
                    <button onClick={() => reactivateUser(u)} style={s.btn('#10b981', '#fff')}>Reactivate</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── REGIONS TAB ── */}
        {!loading && tab === 'regions' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{regions.length} Regions</span>
              <button onClick={openNewRegion} style={s.btn('#6366f1', '#fff')}>
                + Add Region
              </button>
            </div>

            {regions.map(r => (
              <div key={r.id} style={{ ...s.card, opacity: r.is_active ? 1 : 0.5 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{r.name}</span>
                    {!r.is_active && <span style={{ fontSize: 10, color: '#ef4444', fontWeight: 600, marginLeft: 8 }}>INACTIVE</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {r.is_active && (
                      <>
                        <button onClick={() => openEditRegion(r)} style={s.btnOutline}>Edit</button>
                        <button onClick={() => deleteRegion(r)} style={{ ...s.btnOutline, color: '#ef4444', borderColor: '#ef444440' }}>Deactivate</button>
                      </>
                    )}
                  </div>
                </div>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}>
                  Aliases: {(r.routing_aliases || []).join(', ') || 'none'}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {(r.users || []).map(u => (
                    <span key={u.id} style={{ fontSize: 11, padding: '2px 8px', background: '#1e2030', borderRadius: 4, color: '#e2e8f0' }}>
                      {u.name} <span style={{ color: '#64748b' }}>({u.role})</span>
                    </span>
                  ))}
                  {(!r.users || r.users.length === 0) && <span style={{ fontSize: 11, color: '#475569', fontStyle: 'italic' }}>No users assigned</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── USER MODAL ── */}
      {showUserModal && (
        <Modal onClose={() => setShowUserModal(false)} title={editingUser ? 'Edit User' : 'Add User'}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div><label style={s.label}>Full Name *</label>
              <input value={uName} onChange={e => setUName(e.target.value)} style={s.input} placeholder="Jane Smith" /></div>
            <div><label style={s.label}>Email *</label>
              <input type="email" value={uEmail} onChange={e => setUEmail(e.target.value)} style={s.input} placeholder="jsmith@carecoord.org" /></div>
            <div><label style={s.label}>Role *</label>
              <select value={uRole} onChange={e => setURole(e.target.value)} style={{ ...s.input, cursor: 'pointer' }}>
                <option value="coordinator">Coordinator</option>
                <option value="supervisor">Supervisor</option>
                <option value="admin">Admin</option>
              </select></div>
            <div><label style={s.label}>Regions</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {regions.filter(r => r.is_active).map(r => (
                  <label key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#e2e8f0', cursor: 'pointer', padding: '4px 8px', background: uRegionIds.includes(r.id) ? '#6366f120' : '#1e2030', borderRadius: 6, border: '1px solid', borderColor: uRegionIds.includes(r.id) ? '#6366f1' : '#2a2d3e' }}>
                    <input type="checkbox" checked={uRegionIds.includes(r.id)}
                      onChange={() => setURegionIds(prev => prev.includes(r.id) ? prev.filter(id => id !== r.id) : [...prev, r.id])} />
                    {r.name}
                  </label>
                ))}
              </div></div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
            <button onClick={() => setShowUserModal(false)} style={s.btnOutline}>Cancel</button>
            <button onClick={saveUser} disabled={!uName.trim() || !uEmail.trim()}
              style={s.btn(uName.trim() && uEmail.trim() ? '#6366f1' : '#1e2030', uName.trim() && uEmail.trim() ? '#fff' : '#475569')}>
              {editingUser ? 'Save Changes' : 'Create User'}
            </button>
          </div>
        </Modal>
      )}

      {/* ── REGION MODAL ── */}
      {showRegionModal && (
        <Modal onClose={() => setShowRegionModal(false)} title={editingRegion ? 'Edit Region' : 'Add Region'}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div><label style={s.label}>Region Name *</label>
              <input value={rName} onChange={e => setRName(e.target.value)} style={s.input} placeholder="Northern PA" /></div>
            <div><label style={s.label}>Routing Email Aliases</label>
              <input value={rAliases} onChange={e => setRAliases(e.target.value)} style={s.input} placeholder="northernpa@carecoord.org, npa@carecoord.org" />
              <div style={{ fontSize: 10, color: '#475569', marginTop: 4 }}>Comma-separated email addresses that route to this region</div></div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
            <button onClick={() => setShowRegionModal(false)} style={s.btnOutline}>Cancel</button>
            <button onClick={saveRegion} disabled={!rName.trim()}
              style={s.btn(rName.trim() ? '#6366f1' : '#1e2030', rName.trim() ? '#fff' : '#475569')}>
              {editingRegion ? 'Save Changes' : 'Create Region'}
            </button>
          </div>
        </Modal>
      )}

      {/* ── REGION ASSIGNMENT MODAL ── */}
      {showRegionAssign && (
        <RegionAssignModal user={showRegionAssign} regions={regions}
          onSave={(rIds) => saveRegionAssignment(showRegionAssign.id, rIds)}
          onClose={() => setShowRegionAssign(null)} s={s} />
      )}

      {/* ── PASSWORD RESULT MODAL ── */}
      {showPasswordResult && (
        <Modal onClose={() => setShowPasswordResult(null)} title="Temporary Password">
          <div style={{ background: '#1e2030', borderRadius: 8, padding: 16, textAlign: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>Give this temporary password to the user:</div>
            <div style={{ fontSize: 22, fontFamily: "'IBM Plex Mono', monospace", color: '#6366f1', fontWeight: 700, letterSpacing: 2, userSelect: 'all' }}>
              {showPasswordResult}
            </div>
          </div>
          <div style={{ fontSize: 11, color: '#f59e0b', marginBottom: 16 }}>
            This password is shown only once. The user should change it on first login.
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={() => setShowPasswordResult(null)} style={s.btn('#6366f1', '#fff')}>Done</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Shared Modal wrapper ─────────────────────────────────────────────────────

function Modal({ onClose, title, children }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={onClose}>
      <div style={{ background: '#161822', borderRadius: 16, border: '1px solid #2a2d3e', padding: 24, width: 440, maxHeight: '85vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 20, margin: '0 0 20px 0' }}>{title}</h3>
        {children}
      </div>
    </div>
  );
}

// ── Region Assignment Modal ──────────────────────────────────────────────────

function RegionAssignModal({ user, regions, onSave, onClose, s }) {
  const [selected, setSelected] = useState(user.regionIds || []);
  const toggle = (id) => setSelected(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);

  return (
    <Modal onClose={onClose} title={'Assign Regions — ' + user.name}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
        {regions.filter(r => r.is_active).map(r => (
          <label key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: selected.includes(r.id) ? '#6366f110' : '#1e2030', borderRadius: 8, border: '1px solid', borderColor: selected.includes(r.id) ? '#6366f1' : '#2a2d3e', cursor: 'pointer', fontSize: 13 }}>
            <input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggle(r.id)} />
            <span style={{ fontWeight: 500 }}>{r.name}</span>
            <span style={{ fontSize: 10, color: '#64748b', marginLeft: 'auto' }}>{(r.routing_aliases || []).join(', ')}</span>
          </label>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onClose} style={s.btnOutline}>Cancel</button>
        <button onClick={() => onSave(selected)} style={s.btn('#6366f1', '#fff')}>Save Regions</button>
      </div>
    </Modal>
  );
}
`, 'utf8');
console.log('  ✓ client/src/components/AdminPanel.jsx — created');

// ─── 6. PATCH: client/src/App.jsx — add admin nav + route ───────────────────

const appPath = path.join(__dirname, 'client', 'src', 'App.jsx');
let appJsx = fs.readFileSync(appPath, 'utf8');

// Add import
if (!appJsx.includes('AdminPanel')) {
  appJsx = appJsx.replace(
    "import AuditLog from './components/AuditLog';",
    "import AuditLog from './components/AuditLog';\nimport AdminPanel from './components/AdminPanel';"
  );

  // Add nav item — after audit log
  appJsx = appJsx.replace(
    "...(isSupervisor ? [{ key: 'auditLog', icon: 'log', label: 'Audit Log' }] : []),",
    "...(isSupervisor ? [{ key: 'auditLog', icon: 'log', label: 'Audit Log' }] : []),\n            ...(currentUser.role === 'admin' ? [{ key: 'admin', icon: 'settings', label: 'Admin' }] : []),"
  );

  // Add screen rendering — after auditLog
  appJsx = appJsx.replace(
    "{screen === 'auditLog' && isSupervisor && (",
    `{screen === 'admin' && currentUser.role === 'admin' && (
          <AdminPanel currentUser={currentUser} showToast={showToast} />
        )}
        {screen === 'auditLog' && isSupervisor && (`
  );

  fs.writeFileSync(appPath, appJsx, 'utf8');
  console.log('  ✓ client/src/App.jsx — added Admin nav item + route');
} else {
  console.log('  ✓ client/src/App.jsx — AdminPanel already present');
}

console.log('\n✅ Admin Panel added!');
console.log('\nRestart: Ctrl+C then npm run dev');
console.log('Log in as Tom Adkins (admin) to see the Admin tab in the sidebar.\n');
console.log('Features:');
console.log('  • Users tab: Add, edit, deactivate/reactivate users');
console.log('  • Assign users to regions (checkbox modal)');
console.log('  • Reset password (generates temp password shown once)');
console.log('  • Regions tab: Add, edit, deactivate regions');
console.log('  • Deactivating a user returns their tickets to the queue');
console.log('  • Cannot deactivate a region with open tickets\n');
