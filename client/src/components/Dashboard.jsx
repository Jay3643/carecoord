import React, { useState, useEffect } from 'react';
import { api } from '../api';
import { fmt } from '../utils';
import Icon from './Icons';
import { StatusBadge, Avatar } from './ui';

function BirdsEyeView({ currentUser, allUsers, onOpenTicket, showToast }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filterRegion, setFilterRegion] = useState('all');
  const [filterCoord, setFilterCoord] = useState('all');
  const [filterAging, setFilterAging] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [reassignTicket, setReassignTicket] = useState(null);
  const [reassignTo, setReassignTo] = useState('');

  const fetchData = () => {
    api.getBirdsEye().then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  };
  useEffect(() => { fetchData(); const i = setInterval(fetchData, 10000); return () => clearInterval(i); }, []);

  const handleReassign = async () => {
    if (!reassignTicket) return;
    try {
      await api.assignTicket(reassignTicket, reassignTo || null);
      showToast('Ticket reassigned');
      setReassignTicket(null); setReassignTo('');
      fetchData();
    } catch(e) { showToast(e.message); }
  };

  if (loading || !data) return <div style={{ padding: 40, textAlign: 'center', color: '#8a9fb0' }}>Loading command center...</div>;

  const filteredTickets = data.tickets.filter(t => {
    if (filterRegion !== 'all' && t.region?.id !== filterRegion) return false;
    if (filterCoord !== 'all') {
      if (filterCoord === 'unassigned' && t.assignee) return false;
      if (filterCoord !== 'unassigned' && t.assignee?.id !== filterCoord) return false;
    }
    if (filterAging !== 'all' && t.aging !== filterAging) return false;
    if (filterStatus !== 'all' && t.status !== filterStatus) return false;
    return true;
  });

  const agingCounts = { fresh: 0, '1h+': 0, '4h+': 0, '24h+': 0 };
  data.tickets.forEach(t => agingCounts[t.aging]++);

  const selectStyle = { padding: '6px 10px', background: '#dde8f2', border: '1px solid #c0d0e4', borderRadius: 6, fontSize: 11, color: '#1e3a4f', cursor: 'pointer' };

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16, overflow: 'auto', flex: 1 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        {[
          { key: 'fresh', label: 'Fresh (<1hr)', count: agingCounts.fresh, color: '#2e7d32', bg: '#e8f5e9' },
          { key: '1h+', label: '1-4 hours', count: agingCounts['1h+'], color: '#f59e0b', bg: '#fef8ec' },
          { key: '4h+', label: '4-24 hours', count: agingCounts['4h+'], color: '#e67e22', bg: '#fdf0e0' },
          { key: '24h+', label: '24+ hours', count: agingCounts['24h+'], color: '#d94040', bg: '#fde8e8' },
        ].map(a => (
          <div key={a.key} onClick={() => setFilterAging(filterAging === a.key ? 'all' : a.key)}
            style={{ padding: '14px 16px', background: filterAging === a.key ? a.color : a.bg, borderRadius: 10, border: '1px solid ' + a.color + '40', cursor: 'pointer', transition: 'all 0.15s' }}>
            <div style={{ fontSize: 10, color: filterAging === a.key ? '#fff' : a.color, fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>{a.label}</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: filterAging === a.key ? '#fff' : a.color, fontFamily: "'IBM Plex Mono', monospace" }}>{a.count}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '12px 16px', background: '#f0f4f9', borderRadius: 10, border: '1px solid #dde8f2' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#6b8299', alignSelf: 'center', marginRight: 8 }}>Team:</span>
        {data.coordinators.map(c => (
          <div key={c.id} onClick={() => setFilterCoord(filterCoord === c.id ? 'all' : c.id)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 20, background: filterCoord === c.id ? '#102f54' : '#fff', color: filterCoord === c.id ? '#fff' : '#1e3a4f', border: '1px solid #c0d0e4', cursor: 'pointer', fontSize: 12, fontWeight: 500 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: c.isOnline ? '#4ade80' : '#d1d5db', flexShrink: 0 }} />
            <span>{c.name}</span>
            <span style={{ fontSize: 10, fontWeight: 700, background: filterCoord === c.id ? '#1a5e9a' : '#dde8f2', padding: '1px 6px', borderRadius: 10, color: filterCoord === c.id ? '#fff' : '#1a5e9a' }}>{c.openTickets}</span>
          </div>
        ))}
        <div onClick={() => setFilterCoord(filterCoord === 'unassigned' ? 'all' : 'unassigned')}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 20, background: filterCoord === 'unassigned' ? '#d94040' : '#fff', color: filterCoord === 'unassigned' ? '#fff' : '#d94040', border: '1px solid #d9404060', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
          Unassigned
          <span style={{ fontSize: 10, fontWeight: 700, background: filterCoord === 'unassigned' ? '#b91c1c' : '#fde8e8', padding: '1px 6px', borderRadius: 10 }}>{data.tickets.filter(t => !t.assignee).length}</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#6b8299' }}>Filters:</span>
        <select value={filterRegion} onChange={e => setFilterRegion(e.target.value)} style={selectStyle}>
          <option value="all">All Regions</option>
          {data.regions.map(r => <option key={r.id} value={r.id}>{r.name} ({r.totalOpen})</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={selectStyle}>
          <option value="all">All Statuses</option>
          <option value="OPEN">Open</option>
          <option value="WAITING_ON_EXTERNAL">Waiting</option>
        </select>
        {(filterRegion !== 'all' || filterCoord !== 'all' || filterAging !== 'all' || filterStatus !== 'all') && (
          <button onClick={() => { setFilterRegion('all'); setFilterCoord('all'); setFilterAging('all'); setFilterStatus('all'); }}
            style={{ padding: '6px 12px', background: '#f0f4f9', color: '#6b8299', border: '1px solid #c0d0e4', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 500 }}>Reset Filters</button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#6b8299' }}>{filteredTickets.length} tickets</span>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        {data.regions.map(r => {
          const pct = data.tickets.length ? (r.totalOpen / Math.max(...data.regions.map(x => x.totalOpen || 1))) * 100 : 0;
          return (
            <div key={r.id} onClick={() => setFilterRegion(filterRegion === r.id ? 'all' : r.id)}
              style={{ flex: 1, padding: '10px 12px', background: filterRegion === r.id ? '#102f54' : '#f0f4f9', borderRadius: 8, border: '1px solid #dde8f2', cursor: 'pointer', color: filterRegion === r.id ? '#fff' : '#1e3a4f' }}>
              <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6 }}>{r.name}</div>
              <div style={{ height: 6, background: filterRegion === r.id ? '#1a5e9a' : '#dde8f2', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: pct + '%', background: filterRegion === r.id ? '#4ade80' : '#1a5e9a', borderRadius: 3, transition: 'width 0.3s' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 10, color: filterRegion === r.id ? '#a8c8e8' : '#6b8299' }}>
                <span>{r.totalOpen} open</span><span>{r.unassigned} unassigned</span>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #dde8f2', overflow: 'auto', maxHeight: 'calc(100vh - 400px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
            <tr style={{ background: '#f0f4f9' }}>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#5a7a8a' }}>Ticket</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#5a7a8a' }}>Subject</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#5a7a8a' }}>From</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#5a7a8a' }}>Region</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#5a7a8a' }}>Assigned To</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#5a7a8a' }}>Age</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#5a7a8a' }}>Status</th>
              <th style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 600, color: '#5a7a8a' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredTickets.map(t => {
              const ageColor = t.aging === '24h+' ? '#d94040' : t.aging === '4h+' ? '#e67e22' : t.aging === '1h+' ? '#f59e0b' : '#2e7d32';
              const ageLabel = t.lastActivityMs < 60000 ? '<1m' : t.lastActivityMs < 3600000 ? Math.floor(t.lastActivityMs/60000)+'m' : t.lastActivityMs < 86400000 ? Math.floor(t.lastActivityMs/3600000)+'h' : Math.floor(t.lastActivityMs/86400000)+'d';
              return (
                <tr key={t.id} style={{ borderTop: '1px solid #f0f4f9' }} onMouseEnter={e => e.currentTarget.style.background='#f8fafc'} onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                  <td style={{ padding: '8px 12px', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: '#6b8299' }}>{t.id.slice(0,12).toUpperCase()}</td>
                  <td style={{ padding: '8px 12px', maxWidth: 250 }}>
                    <div onClick={() => onOpenTicket(t.id)} style={{ cursor: 'pointer', fontWeight: 500, color: '#1a5e9a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} onMouseEnter={e=>e.currentTarget.style.textDecoration='underline'} onMouseLeave={e=>e.currentTarget.style.textDecoration='none'}>{t.subject}</div>
                    <div style={{ fontSize: 10, color: '#8a9fb0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.fromEmail}</div>
                  </td>
                  <td style={{ padding: '8px 12px', fontSize: 11, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.fromEmail || '-'}</td>
                  <td style={{ padding: '8px 12px', fontSize: 11 }}>{t.region?.name || '-'}</td>
                  <td style={{ padding: '8px 12px' }}>{t.assignee ? <span style={{ fontSize: 11, fontWeight: 500 }}>{t.assignee.name}</span> : <span style={{ fontSize: 11, color: '#d94040', fontWeight: 600 }}>Unassigned</span>}</td>
                  <td style={{ padding: '8px 12px' }}><span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, background: ageColor+'18', color: ageColor }}>{ageLabel}</span></td>
                  <td style={{ padding: '8px 12px' }}><StatusBadge status={t.status} /></td>
                  <td style={{ padding: '8px 8px', textAlign: 'right' }}>
                    <button onClick={() => { setReassignTicket(t.id); setReassignTo(t.assignee?.id || ''); }} style={{ padding: '3px 8px', background: '#dde8f2', border: '1px solid #c0d0e4', borderRadius: 4, fontSize: 10, cursor: 'pointer', color: '#1a5e9a', fontWeight: 600 }}>Reassign</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filteredTickets.length === 0 && <div style={{ padding: 32, textAlign: 'center', color: '#8a9fb0' }}>No tickets match filters</div>}
        
      </div>

      {reassignTicket && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }} onClick={() => setReassignTicket(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, padding: 24, width: 360, boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: '#1e3a4f', marginBottom: 16 }}>Reassign Ticket</h3>
            <div style={{ fontSize: 12, color: '#6b8299', marginBottom: 12 }}>{reassignTicket}</div>
            <select value={reassignTo} onChange={e => setReassignTo(e.target.value)} style={{ width: '100%', padding: '10px 12px', border: '1px solid #c0d0e4', borderRadius: 8, fontSize: 13, marginBottom: 16, background: '#fff' }}>
              <option value="">Return to Queue (unassign)</option>
              {data.coordinators.map(c => <option key={c.id} value={c.id}>{c.name} ({c.openTickets} tickets)</option>)}
            </select>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setReassignTicket(null)} style={{ padding: '8px 16px', background: '#f0f4f9', border: '1px solid #c0d0e4', borderRadius: 8, cursor: 'pointer', fontSize: 12, color: '#5a7a8a' }}>Cancel</button>
              <button onClick={handleReassign} style={{ padding: '8px 16px', background: '#1a5e9a', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>Reassign</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Dashboard({ currentUser, allUsers, onOpenTicket, showToast }) {
  const [summary, setSummary] = useState(null);
  const [byRegion, setByRegion] = useState([]);
  const [byCoord, setByCoord] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dashTab, setDashTab] = useState('overview');
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkFromUser, setBulkFromUser] = useState('');
  const [bulkToUser, setBulkToUser] = useState('');
  const [drillRegion, setDrillRegion] = useState(null);
  const [drillUser, setDrillUser] = useState(null);
  const [drillTickets, setDrillTickets] = useState([]);

  const fetchDashboard = async () => {
    setLoading(true);
    try {
      const [s, r, c] = await Promise.all([api.getDashboardSummary(), api.getDashboardByRegion(), api.getDashboardByCoordinator()]);
      setSummary(s); setByRegion(r.regions); setByCoord(c.coordinators);
    } catch (e) { showToast('Error loading dashboard'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchDashboard(); }, []);

  const handleDrillRegion = async (regionId) => {
    setDrillRegion(regionId); setDrillUser(null);
    try { const data = await api.getTickets({ region: regionId, status: 'all' }); setDrillTickets(data.tickets.filter(t => t.status !== 'CLOSED')); } catch (e) { showToast(e.message); }
  };

  const handleDrillUser = async (userId) => {
    setDrillUser(userId); setDrillRegion(null);
    try { const data = await api.getTickets({ queue: 'region', status: 'all' }); setDrillTickets(data.tickets.filter(t => t.assignee_user_id === userId && t.status !== 'CLOSED')); } catch (e) { showToast(e.message); }
  };

  const handleBulkReassign = async () => {
    if (!bulkFromUser) return;
    try { const data = await api.bulkReassign(bulkFromUser, bulkToUser || null); showToast(data.reassigned + ' tickets reassigned'); setShowBulkModal(false); setBulkFromUser(''); setBulkToUser(''); fetchDashboard(); } catch (e) { showToast(e.message); }
  };

  if (loading || !summary) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#8a9fb0' }}>Loading dashboard...</div>;

  const coordinators = allUsers.filter(u => u.role === 'coordinator');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '16px 24px', borderBottom: '1px solid #dde8f2', background: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, letterSpacing: -0.3 }}>Supervisor Dashboard</h1>
        <div style={{ display: 'flex', gap: 4, background: '#dde8f2', borderRadius: 8, padding: 3, border: '1px solid #c0d0e4' }}>
          {[{ key: 'overview', label: 'Overview' }, { key: 'birdsEye', label: "Bird's Eye" }].map(t => (
            <button key={t.key} onClick={() => setDashTab(t.key)} style={{ padding: '6px 16px', borderRadius: 6, border: 'none', background: dashTab === t.key ? '#1a5e9a' : 'transparent', color: dashTab === t.key ? '#fff' : '#5a7a8a', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>{t.label}</button>
          ))}
        </div>
        <button onClick={() => setShowBulkModal(true)} style={{ padding: '8px 16px', background: '#1a5e9a', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
          <Icon name="move" size={14} /> Bulk Reassign
        </button>
      </div>

      {dashTab === 'birdsEye' && <BirdsEyeView currentUser={currentUser} allUsers={allUsers} onOpenTicket={onOpenTicket} showToast={showToast} />}

      {dashTab === 'overview' && (
        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20, overflow: 'auto', flex: 1 }}>
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

          {(drillRegion || drillUser) && (
            <div style={{ background: '#f0f4f9', borderRadius: 12, border: '1px solid #dde8f2', padding: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <h3 style={{ fontSize: 13, fontWeight: 700 }}>
                  {drillRegion && 'Tickets — ' + (byRegion.find(r => r.region.id === drillRegion)?.region?.name || '')}
                  {drillUser && 'Tickets — ' + (allUsers.find(u => u.id === drillUser)?.name || '')}
                </h3>
                <button onClick={() => { setDrillRegion(null); setDrillUser(null); setDrillTickets([]); }} style={{ background: 'none', border: 'none', color: '#6b8299', cursor: 'pointer', fontSize: 11 }}>Clear</button>
              </div>
              {drillTickets.length === 0 && <div style={{ color: '#8a9fb0', fontSize: 12 }}>No open tickets</div>}
              {drillTickets.map(t => (
                <button key={t.id} onClick={() => onOpenTicket(t.id)}
                  style={{ display: 'flex', alignItems: 'center', width: '100%', padding: '10px 12px', background: 'transparent', border: 'none', borderRadius: 8, color: '#1e3a4f', cursor: 'pointer', marginBottom: 2, textAlign: 'left', gap: 10 }}
                  onMouseEnter={e => e.currentTarget.style.background = '#dde8f2'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <span style={{ fontSize: 10, fontFamily: "'IBM Plex Mono', monospace", color: '#6b8299', width: 36 }}>{t.id.toUpperCase()}</span>
                  <StatusBadge status={t.status} />
                  <span style={{ flex: 1, fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.subject}</span>
                  <span style={{ fontSize: 10, color: '#8a9fb0', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.from_email || (t.external_participants||[])[0] || ''}</span>
                  <span style={{ fontSize: 11, color: '#6b8299' }}>{fmt.time(t.last_activity_at)}</span>
                  {t.assignee ? <Avatar user={t.assignee} size={20} /> : <span style={{ fontSize: 10, color: '#d94040' }}>unassigned</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {showBulkModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={() => setShowBulkModal(false)}>
          <div style={{ background: '#f0f4f9', borderRadius: 16, border: '1px solid #c0d0e4', padding: 24, width: 400 }} onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Bulk Reassign Tickets</h3>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#5a7a8a', display: 'block', marginBottom: 6 }}>From Coordinator</label>
              <select value={bulkFromUser} onChange={e => setBulkFromUser(e.target.value)} style={{ width: '100%', padding: '8px 12px', background: '#dde8f2', border: '1px solid #c0d0e4', borderRadius: 8, color: '#1e3a4f', fontSize: 13 }}>
                <option value="">Select...</option>
                {coordinators.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#5a7a8a', display: 'block', marginBottom: 6 }}>To (blank = region queue)</label>
              <select value={bulkToUser} onChange={e => setBulkToUser(e.target.value)} style={{ width: '100%', padding: '8px 12px', background: '#dde8f2', border: '1px solid #c0d0e4', borderRadius: 8, color: '#1e3a4f', fontSize: 13 }}>
                <option value="">Return to Region Queue</option>
                {coordinators.filter(u => u.id !== bulkFromUser).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowBulkModal(false)} style={{ padding: '8px 16px', background: '#dde8f2', color: '#5a7a8a', border: '1px solid #c0d0e4', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>Cancel</button>
              <button onClick={handleBulkReassign} disabled={!bulkFromUser} style={{ padding: '8px 16px', background: bulkFromUser ? '#1a5e9a' : '#dde8f2', color: bulkFromUser ? '#fff' : '#8a9fb0', border: 'none', borderRadius: 8, cursor: bulkFromUser ? 'pointer' : 'default', fontSize: 12, fontWeight: 600 }}>Reassign All</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
