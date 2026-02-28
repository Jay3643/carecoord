import React, { useState, useEffect } from 'react';
import { api } from '../api';
import { fmt } from '../utils';
import Icon from './Icons';
import { StatusBadge, Avatar } from './ui';

export default function Dashboard({ currentUser, allUsers, onOpenTicket, showToast }) {
  const [summary, setSummary] = useState(null);
  const [byRegion, setByRegion] = useState([]);
  const [byCoord, setByCoord] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkFromUser, setBulkFromUser] = useState('');
  const [bulkToUser, setBulkToUser] = useState('');
  const [drillRegion, setDrillRegion] = useState(null);
  const [drillUser, setDrillUser] = useState(null);
  const [drillTickets, setDrillTickets] = useState([]);

  const fetchDashboard = async () => {
    setLoading(true);
    try {
      const [s, r, c] = await Promise.all([
        api.getDashboardSummary(),
        api.getDashboardByRegion(),
        api.getDashboardByCoordinator(),
      ]);
      setSummary(s);
      setByRegion(r.regions);
      setByCoord(c.coordinators);
    } catch (e) {
      showToast('Error loading dashboard');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchDashboard(); }, []);

  const handleDrillRegion = async (regionId) => {
    setDrillRegion(regionId);
    setDrillUser(null);
    try {
      const data = await api.getTickets({ region: regionId, status: 'all' });
      setDrillTickets(data.tickets.filter(t => t.status !== 'CLOSED'));
    } catch (e) { showToast(e.message); }
  };

  const handleDrillUser = async (userId) => {
    setDrillUser(userId);
    setDrillRegion(null);
    try {
      const data = await api.getTickets({ queue: 'region', status: 'all' });
      setDrillTickets(data.tickets.filter(t => t.assignee_user_id === userId && t.status !== 'CLOSED'));
    } catch (e) { showToast(e.message); }
  };

  const handleBulkReassign = async () => {
    if (!bulkFromUser) return;
    try {
      const data = await api.bulkReassign(bulkFromUser, bulkToUser || null);
      showToast(`${data.reassigned} tickets reassigned`);
      setShowBulkModal(false);
      setBulkFromUser('');
      setBulkToUser('');
      fetchDashboard();
    } catch (e) { showToast(e.message); }
  };

  if (loading || !summary) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#8a9fb0' }}>Loading dashboard...</div>;
  }

  const coordinators = allUsers.filter(u => u.role === 'coordinator');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto' }}>
      <div style={{ padding: '16px 24px', borderBottom: '1px solid #dde8f2', background: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, letterSpacing: -0.3 }}>Supervisor Dashboard</h1>
        <button onClick={() => setShowBulkModal(true)} style={{ padding: '8px 16px', background: '#1a5e9a', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
          <Icon name="move" size={14} /> Bulk Reassign
        </button>
      </div>

      <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Summary cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          {[
            { label: 'Total Open', value: summary.totalOpen, color: '#1a5e9a' },
            { label: 'Unassigned', value: summary.unassigned, color: '#d94040' },
            { label: 'Closed Today', value: summary.closedToday, color: '#1a6aaa' },
            { label: 'Triage Queue', value: summary.triageCount, color: '#c9963b' },
          ].map((card, i) => (
            <div key={i} style={{ padding: '16px 20px', background: '#f0f4f9', borderRadius: 12, border: '1px solid #dde8f2' }}>
              <div style={{ fontSize: 11, color: '#6b8299', fontWeight: 500, marginBottom: 4 }}>{card.label}</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: card.color, fontFamily: "'IBM Plex Mono', monospace" }}>{card.value}</div>
            </div>
          ))}
        </div>

        {/* Oldest open */}
        {summary.oldestOpen && (
          <div style={{ padding: '12px 16px', background: '#fef8ec', borderRadius: 10, border: '1px solid #f0ddb0', display: 'flex', alignItems: 'center', gap: 12 }}>
            <Icon name="alertCircle" size={18} />
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: 11, color: '#c9963b', fontWeight: 600 }}>Oldest Open Ticket</span>
              <span style={{ fontSize: 12, color: '#7a5c10', marginLeft: 8 }}>{summary.oldestOpen.subject} — opened {fmt.time(summary.oldestOpen.created_at)}</span>
            </div>
            <button onClick={() => onOpenTicket(summary.oldestOpen.id)} style={{ padding: '4px 12px', background: '#c9963b', color: '#000', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>View</button>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {/* By Region */}
          <div style={{ background: '#f0f4f9', borderRadius: 12, border: '1px solid #dde8f2', padding: 20 }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 16 }}>Open Tickets by Region</h3>
            {byRegion.map(item => (
              <button key={item.region.id} onClick={() => handleDrillRegion(item.region.id)}
                style={{ display: 'flex', alignItems: 'center', width: '100%', padding: '10px 12px', background: drillRegion === item.region.id ? '#dde8f2' : 'transparent', border: 'none', borderRadius: 8, color: '#1e3a4f', cursor: 'pointer', marginBottom: 2, textAlign: 'left' }}>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{item.region.name}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 12, color: '#6b8299' }}>{item.unassigned} unassigned</span>
                  <span style={{ fontSize: 16, fontWeight: 700, fontFamily: "'IBM Plex Mono', monospace", color: '#1a5e9a', minWidth: 24, textAlign: 'right' }}>{item.open}</span>
                </div>
              </button>
            ))}
          </div>

          {/* By Coordinator */}
          <div style={{ background: '#f0f4f9', borderRadius: 12, border: '1px solid #dde8f2', padding: 20 }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 16 }}>Coordinator Workload</h3>
            {byCoord.map(item => (
              <button key={item.user.id} onClick={() => handleDrillUser(item.user.id)}
                style={{ display: 'flex', alignItems: 'center', width: '100%', padding: '10px 12px', background: drillUser === item.user.id ? '#dde8f2' : 'transparent', border: 'none', borderRadius: 8, color: '#1e3a4f', cursor: 'pointer', marginBottom: 2, textAlign: 'left', gap: 10 }}>
                <Avatar user={item.user} size={24} />
                <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{item.user.name}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 11, color: '#1a6aaa' }}>{item.closedToday} today</span>
                  <span style={{ fontSize: 16, fontWeight: 700, fontFamily: "'IBM Plex Mono', monospace", color: '#1a5e9a', minWidth: 24, textAlign: 'right' }}>{item.open}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Drill-down */}
        {(drillRegion || drillUser) && (
          <div style={{ background: '#f0f4f9', borderRadius: 12, border: '1px solid #dde8f2', padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h3 style={{ fontSize: 13, fontWeight: 700 }}>
                {drillRegion && `Tickets — ${byRegion.find(r => r.region.id === drillRegion)?.region?.name}`}
                {drillUser && `Tickets — ${allUsers.find(u => u.id === drillUser)?.name}`}
              </h3>
              <button onClick={() => { setDrillRegion(null); setDrillUser(null); setDrillTickets([]); }} style={{ background: 'none', border: 'none', color: '#6b8299', cursor: 'pointer', fontSize: 11 }}>Clear</button>
            </div>
            {drillTickets.length === 0 && <div style={{ color: '#8a9fb0', fontSize: 12 }}>No open tickets</div>}
            {drillTickets.map(t => (
              <button key={t.id} onClick={() => onOpenTicket(t.id)}
                style={{ display: 'flex', alignItems: 'center', width: '100%', padding: '10px 12px', background: 'transparent', border: 'none', borderRadius: 8, color: '#1e3a4f', cursor: 'pointer', marginBottom: 2, textAlign: 'left', gap: 10 }}
                onMouseEnter={e => e.currentTarget.style.background = '#dde8f2'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <span style={{ fontSize: 10, fontFamily: "'IBM Plex Mono', monospace", color: '#6b8299', width: 36 }}>{t.id.toUpperCase()}</span>
                <StatusBadge status={t.status} />
                <span style={{ flex: 1, fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.subject}</span>
                <span style={{ fontSize: 11, color: '#6b8299' }}>{fmt.time(t.last_activity_at)}</span>
                {t.assignee ? <Avatar user={t.assignee} size={20} /> : <span style={{ fontSize: 10, color: '#d94040' }}>unassigned</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Bulk modal */}
      {showBulkModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={() => setShowBulkModal(false)}>
          <div style={{ background: '#f0f4f9', borderRadius: 16, border: '1px solid #c0d0e4', padding: 24, width: 400 }} onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Bulk Reassign Tickets</h3>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#5a7a8a', display: 'block', marginBottom: 6 }}>From Coordinator</label>
              <select value={bulkFromUser} onChange={e => setBulkFromUser(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', background: '#dde8f2', border: '1px solid #c0d0e4', borderRadius: 8, color: '#1e3a4f', fontSize: 13 }}>
                <option value="">Select...</option>
                {coordinators.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#5a7a8a', display: 'block', marginBottom: 6 }}>To (blank = region queue)</label>
              <select value={bulkToUser} onChange={e => setBulkToUser(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', background: '#dde8f2', border: '1px solid #c0d0e4', borderRadius: 8, color: '#1e3a4f', fontSize: 13 }}>
                <option value="">Return to Region Queue</option>
                {coordinators.filter(u => u.id !== bulkFromUser).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowBulkModal(false)} style={{ padding: '8px 16px', background: '#dde8f2', color: '#5a7a8a', border: '1px solid #c0d0e4', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>Cancel</button>
              <button onClick={handleBulkReassign} disabled={!bulkFromUser}
                style={{ padding: '8px 16px', background: bulkFromUser ? '#1a5e9a' : '#dde8f2', color: bulkFromUser ? '#fff' : '#8a9fb0', border: 'none', borderRadius: 8, cursor: bulkFromUser ? 'pointer' : 'default', fontSize: 12, fontWeight: 600 }}>
                Reassign All
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
