import React, { useState, useEffect } from 'react';
import { api } from '../api';
import Icon from './Icons';
import { Avatar } from './ui';

const TAG_COLORS = [
  '#6b7280', '#d94040', '#c96a1b', '#ca8a04', '#2e7d32', '#0891b2',
  '#1a5e9a', '#7c3aed', '#d946ef', '#e11d48', '#2563eb', '#16a34a',
  '#ea580c', '#9333ea', '#0284c7', '#65a30d', '#db2777', '#0369a1',
  '#15803d', '#7e22ce', '#0e7490', '#a16207', '#be123c', '#4338ca',
];

function TagsSection({ showToast, s, regions }) {
  const [tags, setTags] = React.useState([]);
  const [newName, setNewName] = React.useState('');
  const [newColor, setNewColor] = React.useState('#1a5e9a');
  const [newParentId, setNewParentId] = React.useState('');
  const [newRegionId, setNewRegionId] = React.useState('');
  const [editingId, setEditingId] = React.useState(null);
  const [editName, setEditName] = React.useState('');
  const [editColor, setEditColor] = React.useState('');
  const [filterRegion, setFilterRegion] = React.useState('all');
  const [expandedTags, setExpandedTags] = React.useState(new Set());

  const loadTags = () => {
    api.adminGetTags().then(d => setTags(d.tags || [])).catch(() => {});
  };
  React.useEffect(() => { loadTags(); }, []);

  const parentTags = tags.filter(t => !t.parentId);
  const getSubtags = (parentId) => tags.filter(t => t.parentId === parentId);
  const regionName = (rid) => { const r = (regions || []).find(r => r.id === rid); return r ? r.name : ''; };

  const filteredParents = filterRegion === 'all' ? parentTags : parentTags.filter(t => !t.regionId || t.regionId === filterRegion);

  const createTag = async () => {
    if (!newName.trim()) { showToast('Tag name required'); return; }
    try {
      await api.adminCreateTag({ name: newName.trim(), color: newColor, parentId: newParentId || null, regionId: newRegionId || null });
      showToast('Tag created');
      setNewName(''); setNewColor('#1a5e9a'); setNewParentId(''); setNewRegionId('');
      loadTags();
    } catch (e) { showToast(e.message || 'Failed'); }
  };

  const saveEdit = async (id) => {
    try {
      await api.adminUpdateTag(id, { name: editName.trim(), color: editColor });
      showToast('Tag updated');
      setEditingId(null);
      loadTags();
    } catch (e) { showToast(e.message || 'Failed'); }
  };

  const deleteTag = async (tag) => {
    const subs = getSubtags(tag.id);
    const msg = subs.length > 0 ? 'Delete "' + tag.name + '" and its ' + subs.length + ' subtag(s)?' : 'Delete tag "' + tag.name + '"?';
    if (!confirm(msg)) return;
    try {
      await api.adminDeleteTag(tag.id);
      showToast('Tag deleted');
      loadTags();
    } catch (e) { showToast(e.message || 'Failed'); }
  };

  const toggleTagExpand = (id) => setExpandedTags(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const renderTag = (tag, indent) => {
    const subtags = getSubtags(tag.id);
    const isExpanded = expandedTags.has(tag.id);
    const isParent = subtags.length > 0 && !indent;
    return (
      <React.Fragment key={tag.id}>
        <div style={{ ...s.card, display: 'flex', alignItems: 'center', gap: 10, marginLeft: indent || 0 }}>
          {editingId === tag.id ? (
            <>
              <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', maxWidth: 160 }}>
                {TAG_COLORS.map(c => (
                  <button key={c} onClick={() => setEditColor(c)}
                    style={{ width: 14, height: 14, borderRadius: '50%', background: c, border: editColor === c ? '2px solid #1e3a4f' : '2px solid transparent', cursor: 'pointer', padding: 0 }} />
                ))}
              </div>
              <input value={editName} onChange={e => setEditName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && saveEdit(tag.id)}
                style={{ flex: 1, padding: '6px 10px', border: '1px solid #c0d0e4', borderRadius: 6, fontSize: 13, outline: 'none' }} />
              <button onClick={() => saveEdit(tag.id)} style={s.btn('#1a5e9a', '#fff')}>Save</button>
              <button onClick={() => setEditingId(null)} style={s.btnOutline}>Cancel</button>
            </>
          ) : (
            <>
              {isParent ? (
                <button onClick={() => toggleTagExpand(tag.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="#6b8299" style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.15s' }}>
                    <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>
                  </svg>
                </button>
              ) : (
                <div style={{ width: 12, flexShrink: 0 }} />
              )}
              <div style={{ width: 14, height: 14, borderRadius: '50%', background: tag.color || '#6b7280', flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 13, fontWeight: indent ? 400 : 600, cursor: isParent ? 'pointer' : 'default' }}
                onClick={() => isParent && toggleTagExpand(tag.id)}>
                {tag.name}
              </span>
              {tag.regionId && <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, background: '#e8f0fe', color: '#1a5e9a' }}>{regionName(tag.regionId)}</span>}
              {isParent && <span style={{ fontSize: 9, color: '#8a9fb0', background: '#f0f4f9', padding: '1px 6px', borderRadius: 4 }}>{subtags.length} subtag{subtags.length !== 1 ? 's' : ''}</span>}
              <button onClick={() => { setEditingId(tag.id); setEditName(tag.name); setEditColor(tag.color || '#6b7280'); }} style={s.btnOutline}>Edit</button>
              <button onClick={() => deleteTag(tag)} style={{ ...s.btnOutline, color: '#d94040', borderColor: '#d9404040' }}>Del</button>
            </>
          )}
        </div>
        {isExpanded && subtags.map(sub => renderTag(sub, (indent || 0) + 28))}
      </React.Fragment>
    );
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{tags.length} Tags</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: '#6b8299' }}>Filter:</span>
          <select value={filterRegion} onChange={e => setFilterRegion(e.target.value)}
            style={{ padding: '4px 8px', border: '1px solid #c0d0e4', borderRadius: 6, fontSize: 12, background: '#f0f4f9' }}>
            <option value="all">All Regions</option>
            <option value="">Global (no region)</option>
            {(regions || []).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
      </div>

      {/* Create new tag */}
      <div style={{ ...s.card, display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', maxWidth: 180 }}>
            {TAG_COLORS.map(c => (
              <button key={c} onClick={() => setNewColor(c)}
                style={{ width: 18, height: 18, borderRadius: '50%', background: c, border: newColor === c ? '2px solid #1e3a4f' : '2px solid transparent', cursor: 'pointer', padding: 0 }} />
            ))}
          </div>
          <div style={{ width: 18, height: 18, borderRadius: '50%', background: newColor, flexShrink: 0 }} />
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Tag name..."
            onKeyDown={e => e.key === 'Enter' && createTag()}
            style={{ flex: 1, padding: '8px 12px', border: '1px solid #c0d0e4', borderRadius: 8, fontSize: 13, outline: 'none', minWidth: 120 }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <select value={newParentId} onChange={e => setNewParentId(e.target.value)}
            style={{ padding: '6px 10px', border: '1px solid #c0d0e4', borderRadius: 6, fontSize: 12, background: '#f0f4f9' }}>
            <option value="">No parent (top-level tag)</option>
            {parentTags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select value={newRegionId} onChange={e => setNewRegionId(e.target.value)}
            style={{ padding: '6px 10px', border: '1px solid #c0d0e4', borderRadius: 6, fontSize: 12, background: '#f0f4f9' }}>
            <option value="">Global (all regions)</option>
            {(regions || []).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <button onClick={createTag} disabled={!newName.trim()}
            style={s.btn(newName.trim() ? '#1a5e9a' : '#dde8f2', newName.trim() ? '#fff' : '#8a9fb0')}>
            + Add Tag
          </button>
        </div>
      </div>

      {/* Tag tree */}
      {filteredParents.map(tag => renderTag(tag, 0))}

      {filteredParents.length === 0 && (
        <div style={{ textAlign: 'center', padding: 40, color: '#8a9fb0' }}>No tags found. Create one above.</div>
      )}
    </div>
  );
}

function InviteSection({ currentUser, showToast, regions }) {
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [role, setRole] = React.useState('coordinator');
  const [selectedRegions, setSelectedRegions] = React.useState([]);
  const [invitations, setInvitations] = React.useState([]);
  const [sending, setSending] = React.useState(false);

  React.useEffect(() => { loadInvitations(); }, []);
  const loadInvitations = () => {
    api.getInvitations().then(d => setInvitations(d.invitations || [])).catch(() => {});
  };

  const sendInvite = async () => {
    if (!name.trim() || !email.trim()) { showToast('Name and email required'); return; }
    if (!email.endsWith('@seniorityhealthcare.com')) { showToast('Must be @seniorityhealthcare.com'); return; }
    if (selectedRegions.length === 0) { showToast('Select at least one region'); return; }
    setSending(true);
    try {
      const d = await api.sendInvite({ name, email: email.toLowerCase(), role, regionIds: selectedRegions });
      showToast('Invitation sent to ' + email);
      setName(''); setEmail(''); setSelectedRegions([]);
      loadInvitations();
    } catch (e) { showToast(e.message || 'Failed to send'); }
    setSending(false);
  };

  const isSupervisor = currentUser.role === 'supervisor';
  const fmt = (ts) => ts ? new Date(ts).toLocaleDateString() : '-';

  return (
    <div>
      <h3 style={{ fontSize: 15, fontWeight: 700, color: '#1e3a4f', marginBottom: 16 }}>Invite New User</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: '#5a7a8a', display: 'block', marginBottom: 4 }}>Full Name</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Jane Smith"
            style={{ width: '100%', padding: '10px 12px', border: '1px solid #c0d0e4', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} />
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: '#5a7a8a', display: 'block', marginBottom: 4 }}>Email</label>
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder="jane@seniorityhealthcare.com"
            style={{ width: '100%', padding: '10px 12px', border: '1px solid #c0d0e4', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} />
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: '#5a7a8a', display: 'block', marginBottom: 4 }}>Role</label>
          <select value={role} onChange={e => setRole(e.target.value)}
            style={{ width: '100%', padding: '10px 12px', border: '1px solid #c0d0e4', borderRadius: 8, fontSize: 13, background: '#fff' }}>
            <option value="coordinator">Coordinator</option>
            {!isSupervisor && <option value="supervisor">Supervisor</option>}
            {!isSupervisor && <option value="admin">Admin</option>}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: '#5a7a8a', display: 'block', marginBottom: 4 }}>Region(s)</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {(regions || []).map(r => (
              <label key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer' }}>
                <input type="checkbox" checked={selectedRegions.includes(r.id)}
                  onChange={e => setSelectedRegions(prev => e.target.checked ? [...prev, r.id] : prev.filter(x => x !== r.id))} />
                {r.name}
              </label>
            ))}
          </div>
        </div>
      </div>
      <button onClick={sendInvite} disabled={sending}
        style={{ padding: '10px 24px', background: '#1a5e9a', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: sending ? 0.7 : 1 }}>
        {sending ? 'Sending...' : 'Send Invitation'}
      </button>

      <h3 style={{ fontSize: 15, fontWeight: 700, color: '#1e3a4f', margin: '32px 0 12px' }}>Pending Invitations</h3>
      <div style={{ border: '1px solid #dde8f2', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: '#f0f4f9' }}>
              <th style={{ padding: '8px 12px', textAlign: 'left', color: '#5a7a8a', fontWeight: 600 }}>Name</th>
              <th style={{ padding: '8px 12px', textAlign: 'left', color: '#5a7a8a', fontWeight: 600 }}>Email</th>
              <th style={{ padding: '8px 12px', textAlign: 'left', color: '#5a7a8a', fontWeight: 600 }}>Role</th>
              <th style={{ padding: '8px 12px', textAlign: 'left', color: '#5a7a8a', fontWeight: 600 }}>Status</th>
              <th style={{ padding: '8px 12px', textAlign: 'left', color: '#5a7a8a', fontWeight: 600 }}>Sent</th>
              <th style={{ padding: '8px 12px', textAlign: 'right', color: '#5a7a8a', fontWeight: 600 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {invitations.map(inv => (
              <tr key={inv.id} style={{ borderTop: '1px solid #e8f0f8' }}>
                <td style={{ padding: '8px 12px' }}>{inv.name}</td>
                <td style={{ padding: '8px 12px', color: '#5a7a8a' }}>{inv.email}</td>
                <td style={{ padding: '8px 12px' }}><span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: inv.role === 'admin' ? '#fce4e4' : inv.role === 'supervisor' ? '#e4f0fc' : '#e4fce8', color: inv.role === 'admin' ? '#d94040' : inv.role === 'supervisor' ? '#1a5e9a' : '#2e7d32' }}>{inv.role}</span></td>
                <td style={{ padding: '8px 12px' }}>
                  {inv.acceptedAt ? <span style={{ color: '#2e7d32', fontWeight: 600 }}>Accepted</span>
                    : inv.expired ? <span style={{ color: '#d94040' }}>Expired</span>
                    : <span style={{ color: '#f59e0b' }}>Pending</span>}
                </td>
                <td style={{ padding: '8px 12px', color: '#8a9fb0' }}>{fmt(inv.createdAt)}</td>
                <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                  {!inv.acceptedAt && (
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                      <button onClick={() => { api.resendInvite(inv.id).then(() => { showToast('Resent'); loadInvitations(); }); }}
                        style={{ padding: '4px 10px', background: '#e4f0fc', border: '1px solid #c0d0e4', borderRadius: 4, fontSize: 11, cursor: 'pointer', color: '#1a5e9a' }}>Resend</button>
                      <button onClick={() => { api.revokeInvite(inv.id).then(() => { showToast('Revoked'); loadInvitations(); }); }}
                        style={{ padding: '4px 10px', background: '#fce4e4', border: '1px solid #e8c0c0', borderRadius: 4, fontSize: 11, cursor: 'pointer', color: '#d94040' }}>Revoke</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {invitations.length === 0 && (
              <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: '#8a9fb0' }}>No invitations sent yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function AdminPanel({ currentUser, showToast, regions: passedRegions }) {
  const isAdmin = currentUser.role === 'admin';
  const [tab, setTab] = useState(isAdmin ? 'users' : 'tags');
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
  const [workspaceStatus, setWorkspaceStatus] = useState({});

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

  // Load workspace connection status for all users
  useEffect(() => {
    if (currentUser.role !== 'admin') return;
    users.forEach(u => {
      api.adminWorkspaceStatus(u.id).then(s => {
        setWorkspaceStatus(prev => ({ ...prev, [u.id]: s }));
      }).catch(() => {});
    });
  }, [users]);

  const connectWorkspace = async (userId) => {
    try {
      const data = await api.adminConnectWorkspace(userId);
      const w = window.open(data.authUrl, 'gmail-auth-' + userId, 'width=500,height=600');
      const check = setInterval(() => {
        if (w?.closed) {
          clearInterval(check);
          api.adminWorkspaceStatus(userId).then(s => {
            setWorkspaceStatus(prev => ({ ...prev, [userId]: s }));
            if (s.connected) showToast('Workspace connected for ' + s.email);
          });
        }
      }, 500);
    } catch (e) { showToast(e.message); }
  };

  const disconnectWorkspace = async (userId) => {
    try {
      await api.adminDisconnectWorkspace(userId);
      setWorkspaceStatus(prev => ({ ...prev, [userId]: { connected: false, email: null } }));
      showToast('Workspace disconnected');
    } catch (e) { showToast(e.message); }
  };

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
          {(isAdmin ? ['users', 'invitations', 'regions', 'tags'] : ['tags']).map(t => (
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

        {/* ── INVITATIONS TAB ── */}
        {!loading && tab === 'invitations' && (
          <InviteSection currentUser={currentUser} showToast={showToast} regions={passedRegions || regions} />
        )}

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
                      {currentUser.role === 'admin' && (
                        workspaceStatus[u.id]?.connected ? (
                          <button onClick={() => disconnectWorkspace(u.id)}
                            style={{ ...s.btnOutline, color: '#2e7d32', borderColor: '#2e7d3240', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ade80' }} />
                            {workspaceStatus[u.id]?.email ? workspaceStatus[u.id].email.split('@')[0] : 'Connected'}
                          </button>
                        ) : (
                          <button onClick={() => connectWorkspace(u.id)}
                            style={{ ...s.btnOutline, color: '#1a73e8', borderColor: '#1a73e840' }}>
                            Connect Workspace
                          </button>
                        )
                      )}
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

        {/* ── TAGS TAB ── */}
        {!loading && tab === 'tags' && (
          <TagsSection showToast={showToast} s={s} regions={regions} />
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
