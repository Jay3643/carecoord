import React, { useState, useEffect } from 'react';
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
    card: { background: '#f0f4f9', border: '1px solid #dde8f2', borderRadius: 10, padding: 16, marginBottom: 8 },
    btn: (bg, fg) => ({ padding: '6px 14px', background: bg, color: fg, border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600 }),
    btnOutline: { padding: '6px 14px', background: '#dde8f2', color: '#5a7a8a', border: '1px solid #c0d0e4', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600 },
    input: { width: '100%', padding: '10px 14px', background: '#dde8f2', border: '1px solid #c0d0e4', borderRadius: 8, color: '#1e3a4f', fontSize: 13, outline: 'none', boxSizing: 'border-box' },
    label: { fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: '#6b8299', display: 'block', marginBottom: 6 },
    roleBadge: (role) => ({
      fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, padding: '2px 8px', borderRadius: 4,
      background: role === 'admin' ? '#d9404020' : role === 'supervisor' ? '#c9963b20' : '#1a5e9a20',
      color: role === 'admin' ? '#d94040' : role === 'supervisor' ? '#c9963b' : '#1a5e9a',
    }),
  };

  const filteredUsers = showInactive ? users : users.filter(u => u.is_active);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '16px 24px', borderBottom: '1px solid #dde8f2', background: '#ffffff' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, letterSpacing: -0.3 }}>Administration</h1>
        </div>
        <div style={{ display: 'flex', gap: 4, background: '#dde8f2', borderRadius: 8, padding: 3, border: '1px solid #c0d0e4', width: 'fit-content' }}>
          {['users', 'regions'].map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{ padding: '6px 18px', borderRadius: 6, border: 'none', background: tab === t ? '#1a5e9a' : 'transparent', color: tab === t ? '#fff' : '#5a7a8a', fontSize: 12, fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize' }}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
        {loading && <div style={{ color: '#8a9fb0', textAlign: 'center', marginTop: 40 }}>Loading...</div>}

        {/* ── USERS TAB ── */}
        {!loading && tab === 'users' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{filteredUsers.length} Users</span>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#6b8299', cursor: 'pointer' }}>
                  <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
                  Show inactive
                </label>
              </div>
              <button onClick={openNewUser} style={s.btn('#1a5e9a', '#fff')}>
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
                    {!u.is_active && <span style={{ fontSize: 10, color: '#d94040', fontWeight: 600 }}>INACTIVE</span>}
                  </div>
                  <div style={{ fontSize: 12, color: '#6b8299' }}>{u.email}</div>
                  <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                    {(u.regions || []).map(r => (
                      <span key={r.id} style={{ fontSize: 10, padding: '1px 8px', background: '#dde8f2', borderRadius: 4, color: '#5a7a8a' }}>{r.name}</span>
                    ))}
                    {(!u.regions || u.regions.length === 0) && <span style={{ fontSize: 10, color: '#8a9fb0', fontStyle: 'italic' }}>No regions assigned</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  {u.is_active && (
                    <>
                      <button onClick={() => openEditUser(u)} style={s.btnOutline}>Edit</button>
                      <button onClick={() => setShowRegionAssign(u)} style={s.btnOutline}>Regions</button>
                      <button onClick={() => resetPassword(u)} style={{ ...s.btnOutline, color: '#c9963b', borderColor: '#c9963b40' }}>Reset PW</button>
                      {u.id !== currentUser.id && (
                        <button onClick={() => deleteUser(u)} style={{ ...s.btnOutline, color: '#d94040', borderColor: '#d9404040' }}>Deactivate</button>
                      )}
                    </>
                  )}
                  {!u.is_active && (
                    <button onClick={() => reactivateUser(u)} style={s.btn('#1a6aaa', '#fff')}>Reactivate</button>
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
              <button onClick={openNewRegion} style={s.btn('#1a5e9a', '#fff')}>
                + Add Region
              </button>
            </div>

            {regions.map(r => (
              <div key={r.id} style={{ ...s.card, opacity: r.is_active ? 1 : 0.5 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{r.name}</span>
                    {!r.is_active && <span style={{ fontSize: 10, color: '#d94040', fontWeight: 600, marginLeft: 8 }}>INACTIVE</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {r.is_active && (
                      <>
                        <button onClick={() => openEditRegion(r)} style={s.btnOutline}>Edit</button>
                        <button onClick={() => deleteRegion(r)} style={{ ...s.btnOutline, color: '#d94040', borderColor: '#d9404040' }}>Deactivate</button>
                      </>
                    )}
                  </div>
                </div>
                <div style={{ fontSize: 11, color: '#6b8299', marginBottom: 6 }}>
                  Aliases: {(r.routing_aliases || []).join(', ') || 'none'}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {(r.users || []).map(u => (
                    <span key={u.id} style={{ fontSize: 11, padding: '2px 8px', background: '#dde8f2', borderRadius: 4, color: '#1e3a4f' }}>
                      {u.name} <span style={{ color: '#6b8299' }}>({u.role})</span>
                    </span>
                  ))}
                  {(!r.users || r.users.length === 0) && <span style={{ fontSize: 11, color: '#8a9fb0', fontStyle: 'italic' }}>No users assigned</span>}
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
                  <label key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#1e3a4f', cursor: 'pointer', padding: '4px 8px', background: uRegionIds.includes(r.id) ? '#1a5e9a20' : '#dde8f2', borderRadius: 6, border: '1px solid', borderColor: uRegionIds.includes(r.id) ? '#1a5e9a' : '#c0d0e4' }}>
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
              style={s.btn(uName.trim() && uEmail.trim() ? '#1a5e9a' : '#dde8f2', uName.trim() && uEmail.trim() ? '#fff' : '#8a9fb0')}>
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
              <div style={{ fontSize: 10, color: '#8a9fb0', marginTop: 4 }}>Comma-separated email addresses that route to this region</div></div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
            <button onClick={() => setShowRegionModal(false)} style={s.btnOutline}>Cancel</button>
            <button onClick={saveRegion} disabled={!rName.trim()}
              style={s.btn(rName.trim() ? '#1a5e9a' : '#dde8f2', rName.trim() ? '#fff' : '#8a9fb0')}>
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
          <div style={{ background: '#dde8f2', borderRadius: 8, padding: 16, textAlign: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: '#6b8299', marginBottom: 8 }}>Give this temporary password to the user:</div>
            <div style={{ fontSize: 22, fontFamily: "'IBM Plex Mono', monospace", color: '#1a5e9a', fontWeight: 700, letterSpacing: 2, userSelect: 'all' }}>
              {showPasswordResult}
            </div>
          </div>
          <div style={{ fontSize: 11, color: '#c9963b', marginBottom: 16 }}>
            This password is shown only once. The user should change it on first login.
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={() => setShowPasswordResult(null)} style={s.btn('#1a5e9a', '#fff')}>Done</button>
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
      <div style={{ background: '#f0f4f9', borderRadius: 16, border: '1px solid #c0d0e4', padding: 24, width: 440, maxHeight: '85vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
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
          <label key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: selected.includes(r.id) ? '#1a5e9a10' : '#dde8f2', borderRadius: 8, border: '1px solid', borderColor: selected.includes(r.id) ? '#1a5e9a' : '#c0d0e4', cursor: 'pointer', fontSize: 13 }}>
            <input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggle(r.id)} />
            <span style={{ fontWeight: 500 }}>{r.name}</span>
            <span style={{ fontSize: 10, color: '#6b8299', marginLeft: 'auto' }}>{(r.routing_aliases || []).join(', ')}</span>
          </label>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onClose} style={s.btnOutline}>Cancel</button>
        <button onClick={() => onSave(selected)} style={s.btn('#1a5e9a', '#fff')}>Save Regions</button>
      </div>
    </Modal>
  );
}
