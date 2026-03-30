import React, { useState, useEffect, useMemo } from 'react';
import { api } from '../api';
import { Avatar } from './ui';
import Icon from './Icons';

const COLORS = ['#1a5e9a', '#2e7d32', '#c96a1b', '#7b1fa2', '#d32f2f', '#0097a7', '#5d4037', '#455a64'];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const ACTION_LABELS = {
  ticket_created: 'Created ticket',
  outbound_sent: 'Sent email',
  assignee_changed: 'Reassigned',
  status_changed: 'Status changed',
  note_added: 'Added note',
  auto_assigned: 'Auto-assigned',
  region_changed: 'Region changed',
  bulk_reassign: 'Bulk reassign',
};
const ACTION_COLORS = {
  ticket_created: '#2e7d32',
  outbound_sent: '#1a5e9a',
  assignee_changed: '#c96a1b',
  status_changed: '#7b1fa2',
  note_added: '#5d4037',
  auto_assigned: '#0097a7',
  region_changed: '#455a64',
  bulk_reassign: '#d32f2f',
};

function Card({ children, style }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #dde8f2', borderRadius: 10, padding: 16, ...style }}>
      {children}
    </div>
  );
}

function MiniBar({ value, max, color = '#1a5e9a', height = 8 }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div style={{ width: '100%', height, background: '#e8f0f8', borderRadius: height / 2, overflow: 'hidden' }}>
      <div style={{ width: pct + '%', height: '100%', background: color, borderRadius: height / 2, transition: 'width 0.3s ease' }} />
    </div>
  );
}

function formatHours(h) {
  if (h === null || h === undefined) return '--';
  if (h < 1) return Math.round(h * 60) + 'm';
  if (h < 24) return h.toFixed(1) + 'h';
  return (h / 24).toFixed(1) + 'd';
}

function formatTs(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  if (d.toDateString() === new Date(now - 86400000).toDateString()) return 'yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function ActivityDashboard({ currentUser, allUsers, showToast }) {
  const [period, setPeriod] = useState(30);
  const [trends, setTrends] = useState([]);
  const [performance, setPerformance] = useState([]);
  const [tagStats, setTagStats] = useState([]);
  const [feed, setFeed] = useState([]);
  const [feedTotal, setFeedTotal] = useState(0);
  const [heatmap, setHeatmap] = useState([]);
  const [loading, setLoading] = useState(true);
  const [feedFilter, setFeedFilter] = useState({ userId: '', actionType: '', days: 7 });
  const [activeTab, setActiveTab] = useState('online');
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [drilldownMinutes, setDrilldownMinutes] = useState(15);
  const [drilldownData, setDrilldownData] = useState(null);
  const [auditUserId, setAuditUserId] = useState('');
  const [auditDays, setAuditDays] = useState(30);
  const [auditData, setAuditData] = useState(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [drilldownLoading, setDrilldownLoading] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [t, p, tg, f, h] = await Promise.all([
        api.getActivityTrends(period),
        api.getActivityPerformance(period),
        api.getActivityTags(),
        api.getActivityFeed({ days: feedFilter.days, userId: feedFilter.userId, actionType: feedFilter.actionType, limit: 50 }),
        api.getActivityHeatmap(14),
      ]);
      setTrends(t.trends || []);
      setPerformance(p.coordinators || []);
      setTagStats(tg.tags || []);
      setFeed(f.feed || []);
      setFeedTotal(f.total || 0);
      setHeatmap(h.heatmap || []);
    } catch (e) { showToast?.('Failed to load activity data'); }
    setLoading(false);
  };

  useEffect(() => { loadData(); }, [period]);

  const reloadFeed = async () => {
    try {
      const f = await api.getActivityFeed({ days: feedFilter.days, userId: feedFilter.userId, actionType: feedFilter.actionType, limit: 50 });
      setFeed(f.feed || []);
      setFeedTotal(f.total || 0);
    } catch (e) {}
  };
  useEffect(() => { reloadFeed(); }, [feedFilter]);

  // Poll online users every 15 seconds
  const fetchOnline = async () => {
    try {
      const d = await api.getOnlineUsers();
      setOnlineUsers(d.users || []);
    } catch(e) {}
  };
  useEffect(() => {
    fetchOnline();
    const iv = setInterval(fetchOnline, 15000);
    return () => clearInterval(iv);
  }, []);

  // Drill-down into a user's recent activity
  const loadDrilldown = async (userId, minutes) => {
    setSelectedUserId(userId);
    setDrilldownMinutes(minutes);
    setDrilldownLoading(true);
    try {
      const d = await api.getUserRecentActivity(userId, minutes);
      setDrilldownData(d);
    } catch(e) { showToast?.('Failed to load user activity'); setDrilldownData(null); }
    setDrilldownLoading(false);
  };

  useEffect(() => {
    if (selectedUserId) loadDrilldown(selectedUserId, drilldownMinutes);
  }, [drilldownMinutes]);

  const TIME_PRESETS = [
    { label: '15 min', minutes: 15 },
    { label: '30 min', minutes: 30 },
    { label: '1 hour', minutes: 60 },
    { label: '4 hours', minutes: 240 },
    { label: '1 day', minutes: 1440 },
    { label: '1 week', minutes: 10080 },
  ];

  const onlineSorted = useMemo(() => {
    return [...onlineUsers].sort((a, b) => {
      // Online first, then away, then offline
      const aScore = a.isOnline ? 0 : a.isAway ? 1 : 2;
      const bScore = b.isOnline ? 0 : b.isAway ? 1 : 2;
      if (aScore !== bScore) return aScore - bScore;
      // Then by last_active desc
      return (b.lastActive || 0) - (a.lastActive || 0);
    });
  }, [onlineUsers]);

  const onlineCount = onlineUsers.filter(u => u.isOnline).length;
  const awayCount = onlineUsers.filter(u => u.isAway).length;

  function formatAgo(ts) {
    if (!ts) return 'never';
    const diff = Date.now() - ts;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    return Math.floor(diff / 86400000) + 'd ago';
  }

  // Summary stats from performance data
  const summary = useMemo(() => {
    const totalClosed = performance.reduce((s, c) => s + c.closed, 0);
    const totalOpen = performance.reduce((s, c) => s + c.open, 0);
    const totalEmails = performance.reduce((s, c) => s + c.emailsSent, 0);
    const totalActions = performance.reduce((s, c) => s + c.totalActions, 0);
    const avgResolution = performance.filter(c => c.avgResolutionHours !== null);
    const avgHours = avgResolution.length > 0 ? avgResolution.reduce((s, c) => s + c.avgResolutionHours, 0) / avgResolution.length : null;
    return { totalClosed, totalOpen, totalEmails, totalActions, avgResolutionHours: avgHours };
  }, [performance]);

  // Chart: max value for trend chart
  const trendMax = useMemo(() => Math.max(1, ...trends.map(t => Math.max(t.created, t.closed))), [trends]);

  const maxPerf = useMemo(() => Math.max(1, ...performance.map(c => c.totalActions)), [performance]);

  if (loading && trends.length === 0) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#8a9fb0' }}>Loading activity data...</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '16px 24px', borderBottom: '1px solid #dde8f2', background: '#fff', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, letterSpacing: -0.3, margin: 0, flex: 1 }}>Activity Dashboard</h1>
        <div style={{ display: 'flex', gap: 4, background: '#dde8f2', borderRadius: 8, padding: 3, border: '1px solid #c0d0e4' }}>
          {[
            { key: 'online', label: 'Who\u2019s Online', badge: onlineCount },
            { key: 'overview', label: 'Overview' },
            { key: 'team', label: 'Team' },
            { key: 'feed', label: 'Activity Feed' },
            { key: 'userAudit', label: 'User Audit' },
          ].map(t => (
            <button key={t.key} onClick={() => setActiveTab(t.key)}
              style={{ padding: '5px 14px', borderRadius: 6, border: 'none', background: activeTab === t.key ? '#1a5e9a' : 'transparent', color: activeTab === t.key ? '#fff' : '#5a7a8a', fontSize: 12, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
              {t.label}
              {t.badge > 0 && <span style={{ background: activeTab === t.key ? '#fff' : '#2e7d32', color: activeTab === t.key ? '#1a5e9a' : '#fff', fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 8, minWidth: 16, textAlign: 'center' }}>{t.badge}</span>}
            </button>
          ))}
        </div>
        <select value={period} onChange={e => setPeriod(Number(e.target.value))}
          style={{ background: '#dde8f2', border: '1px solid #c0d0e4', borderRadius: 8, padding: '6px 12px', color: '#1e3a4f', fontSize: 12, cursor: 'pointer' }}>
          <option value={7}>Last 7 days</option>
          <option value={14}>Last 14 days</option>
          <option value={30}>Last 30 days</option>
          <option value={60}>Last 60 days</option>
          <option value={90}>Last 90 days</option>
        </select>
        <button onClick={loadData} style={{ background: '#dde8f2', border: '1px solid #c0d0e4', borderRadius: 8, padding: '6px 10px', color: '#6b8299', cursor: 'pointer' }} title="Refresh">
          <Icon name="inbox" size={14} />
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '16px 24px' }}>
        {activeTab === 'online' && (
          <div style={{ display: 'flex', gap: 16, height: '100%' }}>
            {/* User List */}
            <div style={{ width: 340, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>Team Status</span>
                <span style={{ fontSize: 11, color: '#2e7d32', fontWeight: 600 }}>{onlineCount} online</span>
                {awayCount > 0 && <span style={{ fontSize: 11, color: '#c96a1b', fontWeight: 600 }}>{awayCount} away</span>}
              </div>
              <Card style={{ flex: 1, padding: 0, overflow: 'auto' }}>
                {onlineSorted.map(u => {
                  const statusColor = u.isOnline ? '#4ade80' : u.isAway ? '#fbbf24' : '#d1d5db';
                  const statusLabel = u.isOnline ? 'Online' : u.isAway ? 'Away' : u.hasSession ? 'Idle' : 'Offline';
                  const isSelected = selectedUserId === u.id;
                  return (
                    <div key={u.id} onClick={() => loadDrilldown(u.id, drilldownMinutes)}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid #f0f4f9', background: isSelected ? '#e8f0f8' : '#fff', transition: 'background 0.1s' }}
                      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = '#f8fafc'; }}
                      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = '#fff'; }}>
                      <div style={{ position: 'relative', flexShrink: 0 }}>
                        <Avatar user={u} size={36} />
                        <span style={{ position: 'absolute', bottom: -1, right: -1, width: 12, height: 12, borderRadius: '50%', background: statusColor, border: '2px solid #fff' }} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.name}</div>
                        <div style={{ fontSize: 11, color: '#6b8299', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ textTransform: 'capitalize' }}>{u.role}</span>
                          {u.workStatus === 'inactive' && <span style={{ color: '#d32f2f', fontSize: 10, fontWeight: 600 }}>INACTIVE</span>}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: u.isOnline ? '#2e7d32' : u.isAway ? '#c96a1b' : '#8a9fb0' }}>{statusLabel}</div>
                        <div style={{ fontSize: 10, color: '#8a9fb0' }}>{formatAgo(u.lastActive)}</div>
                      </div>
                    </div>
                  );
                })}
                {onlineSorted.length === 0 && (
                  <div style={{ padding: 32, textAlign: 'center', color: '#8a9fb0', fontSize: 13 }}>No users found</div>
                )}
              </Card>
            </div>

            {/* Drill-Down Panel */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              {!selectedUserId ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#8a9fb0' }}>
                  <div style={{ textAlign: 'center' }}>
                    <Icon name="user" size={40} />
                    <div style={{ fontSize: 14, marginTop: 8 }}>Click a team member to see their recent activity</div>
                  </div>
                </div>
              ) : (
                <>
                  {/* User header + time range selector */}
                  {(() => {
                    const u = onlineUsers.find(x => x.id === selectedUserId);
                    if (!u) return null;
                    const statusColor = u.isOnline ? '#4ade80' : u.isAway ? '#fbbf24' : '#d1d5db';
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                        <div style={{ position: 'relative' }}>
                          <Avatar user={u} size={44} />
                          <span style={{ position: 'absolute', bottom: 0, right: 0, width: 14, height: 14, borderRadius: '50%', background: statusColor, border: '2px solid #fff' }} />
                        </div>
                        <div>
                          <div style={{ fontSize: 16, fontWeight: 700 }}>{u.name}</div>
                          <div style={{ fontSize: 12, color: '#6b8299' }}>{u.email} &middot; Last active: {formatAgo(u.lastActive)}</div>
                        </div>
                        <div style={{ marginLeft: 'auto', display: 'flex', gap: 3, background: '#dde8f2', borderRadius: 8, padding: 3, border: '1px solid #c0d0e4' }}>
                          {TIME_PRESETS.map(tp => (
                            <button key={tp.minutes} onClick={() => setDrilldownMinutes(tp.minutes)}
                              style={{ padding: '4px 10px', borderRadius: 6, border: 'none', background: drilldownMinutes === tp.minutes ? '#1a5e9a' : 'transparent', color: drilldownMinutes === tp.minutes ? '#fff' : '#5a7a8a', fontSize: 11, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                              {tp.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                  {drilldownLoading ? (
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8a9fb0' }}>Loading...</div>
                  ) : drilldownData ? (
                    <>
                      {/* Summary cards */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
                        <Card style={{ textAlign: 'center', padding: 12 }}>
                          <div style={{ fontSize: 9, color: '#6b8299', fontWeight: 500, textTransform: 'uppercase', letterSpacing: 0.5 }}>Total Actions</div>
                          <div style={{ fontSize: 24, fontWeight: 700, color: '#7b1fa2' }}>{drilldownData.totalActions}</div>
                        </Card>
                        <Card style={{ textAlign: 'center', padding: 12 }}>
                          <div style={{ fontSize: 9, color: '#6b8299', fontWeight: 500, textTransform: 'uppercase', letterSpacing: 0.5 }}>Emails Sent</div>
                          <div style={{ fontSize: 24, fontWeight: 700, color: '#1a5e9a' }}>{drilldownData.emailsSent}</div>
                        </Card>
                        <Card style={{ textAlign: 'center', padding: 12 }}>
                          <div style={{ fontSize: 9, color: '#6b8299', fontWeight: 500, textTransform: 'uppercase', letterSpacing: 0.5 }}>Notes Added</div>
                          <div style={{ fontSize: 24, fontWeight: 700, color: '#5d4037' }}>{drilldownData.notesAdded}</div>
                        </Card>
                        <Card style={{ textAlign: 'center', padding: 12 }}>
                          <div style={{ fontSize: 9, color: '#6b8299', fontWeight: 500, textTransform: 'uppercase', letterSpacing: 0.5 }}>Tickets Touched</div>
                          <div style={{ fontSize: 24, fontWeight: 700, color: '#c96a1b' }}>{drilldownData.ticketsTouched?.length || 0}</div>
                        </Card>
                      </div>

                      {/* Action breakdown */}
                      {drilldownData.actionCounts && Object.keys(drilldownData.actionCounts).length > 0 && (
                        <Card style={{ marginBottom: 16, padding: 12 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Action Breakdown</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {Object.entries(drilldownData.actionCounts).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
                              <span key={type} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', background: (ACTION_COLORS[type] || '#6b8299') + '15', borderRadius: 6, fontSize: 12, fontWeight: 500 }}>
                                <span style={{ width: 8, height: 8, borderRadius: '50%', background: ACTION_COLORS[type] || '#6b8299' }} />
                                {ACTION_LABELS[type] || type}
                                <span style={{ fontWeight: 700, color: ACTION_COLORS[type] || '#6b8299' }}>{count}</span>
                              </span>
                            ))}
                          </div>
                        </Card>
                      )}

                      {/* Tickets touched */}
                      {drilldownData.ticketsTouched?.length > 0 && (
                        <Card style={{ marginBottom: 16, padding: 12 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Tickets Touched</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {drilldownData.ticketsTouched.map(t => (
                              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', background: '#f8fafc', borderRadius: 6, fontSize: 12 }}>
                                <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#6b8299', fontSize: 10 }}>{t.id.toUpperCase().slice(0, 12)}</span>
                                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>{t.subject}</span>
                                <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: t.status === 'CLOSED' ? '#e8f5e9' : t.status === 'WAITING_ON_EXTERNAL' ? '#fff3e0' : '#e3f2fd', color: t.status === 'CLOSED' ? '#2e7d32' : t.status === 'WAITING_ON_EXTERNAL' ? '#e65100' : '#1565c0', fontWeight: 600 }}>{t.status}</span>
                              </div>
                            ))}
                          </div>
                        </Card>
                      )}

                      {/* Activity timeline */}
                      <Card style={{ flex: 1, padding: 0, overflow: 'auto' }}>
                        <div style={{ padding: '10px 14px', borderBottom: '1px solid #f0f4f9', fontSize: 12, fontWeight: 600, color: '#6b8299', position: 'sticky', top: 0, background: '#fff', zIndex: 1 }}>
                          Activity Timeline ({drilldownData.actions?.length || 0} events)
                        </div>
                        {(!drilldownData.actions || drilldownData.actions.length === 0) && (
                          <div style={{ padding: 24, textAlign: 'center', color: '#8a9fb0', fontSize: 12 }}>No activity in this time range</div>
                        )}
                        {(drilldownData.actions || []).map((item, i) => (
                          <div key={item.id || i}
                            style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 14px', borderBottom: '1px solid #f8fafc', fontSize: 12 }}>
                            <div style={{ width: 8, height: 8, borderRadius: '50%', background: ACTION_COLORS[item.actionType] || '#6b8299', marginTop: 4, flexShrink: 0 }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <span style={{ fontWeight: 600, color: ACTION_COLORS[item.actionType] || '#6b8299' }}>{ACTION_LABELS[item.actionType] || item.actionType}</span>
                              {item.detail && <span style={{ color: '#6b8299', marginLeft: 6 }}>{item.detail}</span>}
                            </div>
                            <span style={{ fontSize: 10, color: '#8a9fb0', whiteSpace: 'nowrap', flexShrink: 0 }}>{formatTs(item.ts)}</span>
                          </div>
                        ))}
                      </Card>
                    </>
                  ) : null}
                </>
              )}
            </div>
          </div>
        )}

        {activeTab === 'overview' && (
          <>
            {/* KPI Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 20 }}>
              {[
                { label: 'Tickets Closed', value: summary.totalClosed, color: '#2e7d32', icon: 'check' },
                { label: 'Currently Open', value: summary.totalOpen, color: '#c96a1b', icon: 'inbox' },
                { label: 'Emails Sent', value: summary.totalEmails, color: '#1a5e9a', icon: 'send' },
                { label: 'Total Actions', value: summary.totalActions, color: '#7b1fa2', icon: 'log' },
                { label: 'Avg Resolution', value: formatHours(summary.avgResolutionHours), color: '#0097a7', icon: 'clock' },
              ].map((kpi, i) => (
                <Card key={i} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: '#6b8299', fontWeight: 500, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>{kpi.label}</div>
                  <div style={{ fontSize: 28, fontWeight: 700, color: kpi.color, lineHeight: 1 }}>{kpi.value}</div>
                </Card>
              ))}
            </div>

            {/* Ticket Volume Trend Chart */}
            <Card style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                Ticket Volume
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 400, color: '#6b8299' }}>
                  <span style={{ width: 10, height: 3, background: '#2e7d32', borderRadius: 2 }} /> Created
                  <span style={{ width: 10, height: 3, background: '#1a5e9a', borderRadius: 2, marginLeft: 8 }} /> Closed
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: 120, padding: '0 4px' }}>
                {trends.map((t, i) => {
                  const cH = (t.created / trendMax) * 100;
                  const clH = (t.closed / trendMax) * 100;
                  const showLabel = trends.length <= 14 || i % Math.ceil(trends.length / 14) === 0;
                  return (
                    <div key={t.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }} title={t.date + ': ' + t.created + ' created, ' + t.closed + ' closed'}>
                      <div style={{ display: 'flex', gap: 1, alignItems: 'flex-end', width: '100%', height: 100, justifyContent: 'center' }}>
                        <div style={{ flex: 1, maxWidth: 12, height: Math.max(2, cH) + '%', background: '#2e7d32', borderRadius: '2px 2px 0 0', transition: 'height 0.3s' }} />
                        <div style={{ flex: 1, maxWidth: 12, height: Math.max(2, clH) + '%', background: '#1a5e9a', borderRadius: '2px 2px 0 0', transition: 'height 0.3s' }} />
                      </div>
                      {showLabel && <span style={{ fontSize: 9, color: '#8a9fb0', whiteSpace: 'nowrap', transform: 'rotate(-45deg)', transformOrigin: 'top left', marginTop: 4 }}>{t.date.slice(5)}</span>}
                    </div>
                  );
                })}
              </div>
            </Card>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
              {/* Activity Heatmap */}
              <Card>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Activity Heatmap (last 2 weeks)</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'auto repeat(24, 1fr)', gap: 2, fontSize: 9 }}>
                  <div />
                  {Array.from({ length: 24 }, (_, h) => (
                    <div key={h} style={{ textAlign: 'center', color: '#8a9fb0' }}>{h % 3 === 0 ? h : ''}</div>
                  ))}
                  {DAY_NAMES.map((day, di) => (
                    <React.Fragment key={di}>
                      <div style={{ color: '#6b8299', fontWeight: 500, paddingRight: 6, display: 'flex', alignItems: 'center' }}>{day}</div>
                      {Array.from({ length: 24 }, (_, hi) => {
                        const val = heatmap[di]?.[hi] || 0;
                        const maxVal = Math.max(1, ...(heatmap.flat ? heatmap.flat() : [1]));
                        const intensity = val / maxVal;
                        return (
                          <div key={hi} title={day + ' ' + hi + ':00 — ' + val + ' actions'}
                            style={{ width: '100%', aspectRatio: '1', borderRadius: 2, background: val === 0 ? '#f0f4f9' : `rgba(26, 94, 154, ${0.15 + intensity * 0.85})` }} />
                        );
                      })}
                    </React.Fragment>
                  ))}
                </div>
              </Card>

              {/* Tag Distribution */}
              <Card>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Tag Distribution</div>
                {tagStats.length === 0 && <div style={{ color: '#8a9fb0', fontSize: 12, fontStyle: 'italic' }}>No tags found</div>}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {tagStats.filter(t => t.total > 0).map(tag => (
                    <div key={tag.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 10, height: 10, borderRadius: '50%', background: tag.color || '#8a9fb0', flexShrink: 0 }} />
                      <span style={{ fontSize: 12, fontWeight: 500, minWidth: 80 }}>{tag.name}</span>
                      <div style={{ flex: 1 }}>
                        <MiniBar value={tag.total} max={tagStats[0]?.total || 1} color={tag.color || '#1a5e9a'} />
                      </div>
                      <span style={{ fontSize: 11, color: '#6b8299', minWidth: 60, textAlign: 'right' }}>{tag.open} open / {tag.total}</span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </>
        )}

        {activeTab === 'team' && (
          <>
            {/* Coordinator Performance Table */}
            <Card>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Team Performance ({period} days)</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #dde8f2' }}>
                      <th style={{ textAlign: 'left', padding: '8px 12px', color: '#6b8299', fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>Team Member</th>
                      <th style={{ textAlign: 'center', padding: '8px 8px', color: '#6b8299', fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>Open</th>
                      <th style={{ textAlign: 'center', padding: '8px 8px', color: '#6b8299', fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>Closed</th>
                      <th style={{ textAlign: 'center', padding: '8px 8px', color: '#6b8299', fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>Emails</th>
                      <th style={{ textAlign: 'center', padding: '8px 8px', color: '#6b8299', fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>Notes</th>
                      <th style={{ textAlign: 'center', padding: '8px 8px', color: '#6b8299', fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>Actions</th>
                      <th style={{ textAlign: 'center', padding: '8px 8px', color: '#6b8299', fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>Avg Resolution</th>
                      <th style={{ textAlign: 'left', padding: '8px 12px', color: '#6b8299', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', minWidth: 120 }}>Activity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {performance.map((c, i) => (
                      <tr key={c.user.id} style={{ borderBottom: '1px solid #f0f4f9' }}
                        onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'} onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
                        <td style={{ padding: '10px 12px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <Avatar user={c.user} size={32} />
                            <div>
                              <div style={{ fontWeight: 600, fontSize: 13 }}>{c.user.name}</div>
                              <div style={{ fontSize: 11, color: '#6b8299', textTransform: 'capitalize' }}>
                                {c.user.role}
                                {c.user.workStatus === 'inactive' && <span style={{ color: '#d32f2f', marginLeft: 6 }}>inactive</span>}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td style={{ textAlign: 'center', padding: '10px 8px', fontWeight: 600, color: c.open > 0 ? '#c96a1b' : '#6b8299' }}>{c.open}</td>
                        <td style={{ textAlign: 'center', padding: '10px 8px', fontWeight: 600, color: '#2e7d32' }}>{c.closed}</td>
                        <td style={{ textAlign: 'center', padding: '10px 8px', color: '#1a5e9a' }}>{c.emailsSent}</td>
                        <td style={{ textAlign: 'center', padding: '10px 8px', color: '#5d4037' }}>{c.notesAdded}</td>
                        <td style={{ textAlign: 'center', padding: '10px 8px', fontWeight: 600 }}>{c.totalActions}</td>
                        <td style={{ textAlign: 'center', padding: '10px 8px', color: '#0097a7', fontWeight: 500 }}>{formatHours(c.avgResolutionHours)}</td>
                        <td style={{ padding: '10px 12px' }}>
                          <MiniBar value={c.totalActions} max={maxPerf} color={COLORS[i % COLORS.length]} />
                        </td>
                      </tr>
                    ))}
                    {performance.length === 0 && (
                      <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: '#8a9fb0' }}>No activity data</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}

        {activeTab === 'feed' && (
          <>
            {/* Filters */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
              <select value={feedFilter.userId} onChange={e => setFeedFilter(prev => ({ ...prev, userId: e.target.value }))}
                style={{ background: '#dde8f2', border: '1px solid #c0d0e4', borderRadius: 8, padding: '6px 12px', color: '#1e3a4f', fontSize: 12, cursor: 'pointer' }}>
                <option value="">All Users</option>
                {(allUsers || []).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
              <select value={feedFilter.actionType} onChange={e => setFeedFilter(prev => ({ ...prev, actionType: e.target.value }))}
                style={{ background: '#dde8f2', border: '1px solid #c0d0e4', borderRadius: 8, padding: '6px 12px', color: '#1e3a4f', fontSize: 12, cursor: 'pointer' }}>
                <option value="">All Actions</option>
                {Object.entries(ACTION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <select value={feedFilter.days} onChange={e => setFeedFilter(prev => ({ ...prev, days: Number(e.target.value) }))}
                style={{ background: '#dde8f2', border: '1px solid #c0d0e4', borderRadius: 8, padding: '6px 12px', color: '#1e3a4f', fontSize: 12, cursor: 'pointer' }}>
                <option value={1}>Last 24 hours</option>
                <option value={3}>Last 3 days</option>
                <option value={7}>Last 7 days</option>
                <option value={14}>Last 14 days</option>
                <option value={30}>Last 30 days</option>
              </select>
              <span style={{ fontSize: 12, color: '#6b8299' }}>{feedTotal} events</span>
            </div>

            {/* Feed List */}
            <Card style={{ padding: 0 }}>
              {feed.length === 0 && (
                <div style={{ padding: 32, textAlign: 'center', color: '#8a9fb0', fontSize: 13 }}>No activity found for this period</div>
              )}
              {feed.map((item, i) => (
                <div key={item.id || i}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: i < feed.length - 1 ? '1px solid #f0f4f9' : 'none' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'} onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: ACTION_COLORS[item.actionType] || '#6b8299', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                    {(item.actor?.name || '?')[0].toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600 }}>{item.actor?.name || 'System'}</span>
                      <span style={{ display: 'inline-block', padding: '1px 8px', background: (ACTION_COLORS[item.actionType] || '#6b8299') + '18', color: ACTION_COLORS[item.actionType] || '#6b8299', borderRadius: 4, fontSize: 10, fontWeight: 600 }}>
                        {ACTION_LABELS[item.actionType] || item.actionType}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: '#6b8299', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>
                      {item.detail}
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: '#8a9fb0', whiteSpace: 'nowrap', flexShrink: 0 }}>
                    {formatTs(item.ts)}
                  </div>
                  {item.entityId && (
                    <span style={{ fontSize: 10, fontFamily: "'IBM Plex Mono', monospace", color: '#8a9fb0', background: '#f0f4f9', padding: '2px 6px', borderRadius: 4, flexShrink: 0 }}>
                      {String(item.entityId).toUpperCase().slice(0, 12)}
                    </span>
                  )}
                </div>
              ))}
            </Card>
          </>
        )}
        {activeTab === 'userAudit' && (
          <div>
            {/* User selector */}
            <Card style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#6b8299' }}>Select User:</label>
                <select value={auditUserId} onChange={e => setAuditUserId(e.target.value)}
                  style={{ flex: 1, maxWidth: 300, padding: '8px 12px', background: '#f0f4f9', border: '1px solid #c0d0e4', borderRadius: 8, fontSize: 13, color: '#1e3a4f' }}>
                  <option value="">Choose a team member...</option>
                  {(allUsers || []).map(u => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
                </select>
                <select value={auditDays} onChange={e => setAuditDays(Number(e.target.value))}
                  style={{ padding: '8px 12px', background: '#f0f4f9', border: '1px solid #c0d0e4', borderRadius: 8, fontSize: 12 }}>
                  <option value={7}>7 days</option>
                  <option value={14}>14 days</option>
                  <option value={30}>30 days</option>
                  <option value={60}>60 days</option>
                  <option value={90}>90 days</option>
                </select>
                <button onClick={async () => {
                  if (!auditUserId) { showToast?.('Select a user'); return; }
                  setAuditLoading(true);
                  try { const d = await api.getUserAudit(auditUserId, auditDays); setAuditData(d); }
                  catch(e) { showToast?.(e.message); }
                  setAuditLoading(false);
                }}
                  style={{ padding: '8px 18px', background: '#1a5e9a', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  Run Audit
                </button>
              </div>
            </Card>

            {auditLoading && <div style={{ textAlign: 'center', padding: 32, color: '#8a9fb0' }}>Loading audit...</div>}

            {auditData && !auditLoading && (
              <>
                {/* User header */}
                <Card style={{ marginBottom: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <Avatar user={auditData.user} size={48} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: '#1e3a4f' }}>{auditData.user.name}</div>
                      <div style={{ fontSize: 12, color: '#6b8299' }}>{auditData.user.email} — {auditData.user.role}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: auditData.online?.isOnline ? '#4ade80' : '#94a3b8' }} />
                      <span style={{ fontSize: 12, color: '#6b8299' }}>{auditData.online?.isOnline ? 'Online' : auditData.online?.lastActive ? 'Last seen ' + formatTs(auditData.online.lastActive) : 'Offline'}</span>
                    </div>
                  </div>
                </Card>

                {/* Stats row */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 16 }}>
                  <Card><div style={{ fontSize: 24, fontWeight: 700, color: '#1a5e9a' }}>{auditData.tickets.openCount}</div><div style={{ fontSize: 11, color: '#6b8299' }}>Open Tickets</div></Card>
                  <Card><div style={{ fontSize: 24, fontWeight: 700, color: '#d94040' }}>{auditData.tickets.unreadCount}</div><div style={{ fontSize: 11, color: '#6b8299' }}>Unread</div></Card>
                  <Card><div style={{ fontSize: 24, fontWeight: 700, color: '#2e7d32' }}>{auditData.tickets.closedCount}</div><div style={{ fontSize: 11, color: '#6b8299' }}>Closed ({auditDays}d)</div></Card>
                  <Card><div style={{ fontSize: 24, fontWeight: 700, color: '#c96a1b' }}>{auditData.activity.totalActions}</div><div style={{ fontSize: 11, color: '#6b8299' }}>Actions ({auditDays}d)</div></Card>
                  <Card>
                    <div style={{ fontSize: 24, fontWeight: 700, color: auditData.responseTime.avgMs ? (auditData.responseTime.avgMs < 3600000 ? '#2e7d32' : auditData.responseTime.avgMs < 14400000 ? '#c96a1b' : '#d94040') : '#8a9fb0' }}>
                      {auditData.responseTime.avgMs ? (auditData.responseTime.avgMs < 60000 ? Math.round(auditData.responseTime.avgMs / 1000) + 's' : auditData.responseTime.avgMs < 3600000 ? Math.round(auditData.responseTime.avgMs / 60000) + 'm' : Math.round(auditData.responseTime.avgMs / 3600000 * 10) / 10 + 'h') : '--'}
                    </div>
                    <div style={{ fontSize: 11, color: '#6b8299' }}>Avg Response Time</div>
                  </Card>
                </div>

                {/* Response time details */}
                {auditData.responseTime.count > 0 && (
                  <Card style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#1e3a4f', marginBottom: 12 }}>Response Times ({auditData.responseTime.count} tickets)</div>
                    <div style={{ display: 'flex', gap: 24, marginBottom: 12, fontSize: 12 }}>
                      <div><span style={{ color: '#6b8299' }}>Fastest: </span><span style={{ fontWeight: 600, color: '#2e7d32' }}>{formatHours(auditData.responseTime.fastestMs / 3600000)}</span></div>
                      <div><span style={{ color: '#6b8299' }}>Slowest: </span><span style={{ fontWeight: 600, color: '#d94040' }}>{formatHours(auditData.responseTime.slowestMs / 3600000)}</span></div>
                      <div><span style={{ color: '#6b8299' }}>Average: </span><span style={{ fontWeight: 600 }}>{formatHours(auditData.responseTime.avgMs / 3600000)}</span></div>
                    </div>
                    <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                      {auditData.responseTime.details.map(r => (
                        <div key={r.ticketId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #f0f4f9', fontSize: 12 }}>
                          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: '#8a9fb0', minWidth: 90 }}>{r.ticketId.slice(0, 15)}</span>
                          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#1e3a4f' }}>{r.subject}</span>
                          <span style={{ fontWeight: 600, minWidth: 50, textAlign: 'right', color: r.responseMs < 3600000 ? '#2e7d32' : r.responseMs < 14400000 ? '#c96a1b' : '#d94040' }}>
                            {r.responseMs < 60000 ? Math.round(r.responseMs / 1000) + 's' : r.responseMs < 3600000 ? Math.round(r.responseMs / 60000) + 'm' : Math.round(r.responseMs / 3600000 * 10) / 10 + 'h'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </Card>
                )}

                {/* Open tickets with wait times */}
                {auditData.tickets.openTickets.length > 0 && (
                  <Card style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#1e3a4f', marginBottom: 12 }}>Current Open Tickets ({auditData.tickets.openTickets.length})</div>
                    <div style={{ maxHeight: 250, overflowY: 'auto' }}>
                      {auditData.tickets.openTickets.map(t => (
                        <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #f0f4f9', fontSize: 12 }}>
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: t.hasUnread ? '#d94040' : '#4ade80', flexShrink: 0 }} />
                          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#1e3a4f', fontWeight: t.hasUnread ? 600 : 400 }}>{t.subject}</span>
                          <span style={{ fontSize: 10, color: '#6b8299' }}>{t.hasUnread ? 'Unread' : 'Read'}</span>
                          {t.waitingMs && <span style={{ fontSize: 10, fontWeight: 600, color: t.waitingMs > 14400000 ? '#d94040' : '#c96a1b' }}>waiting {Math.round(t.waitingMs / 3600000 * 10) / 10}h</span>}
                        </div>
                      ))}
                    </div>
                  </Card>
                )}

                {/* Action breakdown */}
                <Card style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#1e3a4f', marginBottom: 12 }}>Action Breakdown ({auditDays} days)</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {Object.entries(auditData.activity.actionCounts).sort((a, b) => b[1] - a[1]).map(([action, count]) => (
                      <div key={action} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: '#f0f4f9', borderRadius: 6 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: ACTION_COLORS[action] || '#94a3b8' }} />
                        <span style={{ fontSize: 12, color: '#1e3a4f' }}>{ACTION_LABELS[action] || action}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#6b8299' }}>{count}</span>
                      </div>
                    ))}
                  </div>
                </Card>

                {/* Recent actions timeline */}
                <Card>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#1e3a4f', marginBottom: 12 }}>Recent Actions</div>
                  <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                    {auditData.activity.recentActions.map(a => (
                      <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid #f0f4f9', fontSize: 12 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: ACTION_COLORS[a.actionType] || '#94a3b8', flexShrink: 0 }} />
                        <span style={{ fontSize: 10, color: '#8a9fb0', minWidth: 70 }}>{formatTs(a.ts)}</span>
                        <span style={{ color: '#1a5e9a', fontWeight: 500 }}>{ACTION_LABELS[a.actionType] || a.actionType}</span>
                        <span style={{ flex: 1, color: '#6b8299', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.detail}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
