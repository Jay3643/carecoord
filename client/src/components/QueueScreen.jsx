import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { api } from '../api';
import { fmt } from '../utils';
import Icon from './Icons';
import { StatusBadge, TagPill, Avatar } from './ui';

export default function QueueScreen({ title, mode, currentUser, regions, onOpenTicket }) {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedRegion, setSelectedRegion] = useState('all');
  const [queueFilter, setQueueFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState(null);

  const userRegions = useMemo(() =>
    regions.filter(r => currentUser.regionIds.includes(r.id)),
    [regions, currentUser]
  );

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    try {
      const params = { queue: mode };
      if (selectedRegion !== 'all') params.region = selectedRegion;
      if (queueFilter !== 'all') params.status = queueFilter;
      if (searchQuery.trim()) params.search = searchQuery;
      const data = await api.getTickets(params);
      setTickets(data.tickets);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [mode, selectedRegion, queueFilter, searchQuery]);

  useEffect(() => { fetchTickets(); }, [fetchTickets]);

  // Polling for near-real-time
  useEffect(() => {
    const interval = setInterval(fetchTickets, 10000);
    return () => clearInterval(interval);
  }, [fetchTickets]);

  const filterCounts = useMemo(() => {
    // We'll approximate counts from loaded data — for exact counts, a dedicated endpoint would be better
    return {
      all: tickets.filter(t => t.status !== 'CLOSED').length,
      unassigned: tickets.filter(t => !t.assignee_user_id && t.status !== 'CLOSED').length,
      open: tickets.filter(t => t.status === 'OPEN').length,
      waiting: tickets.filter(t => t.status === 'WAITING_ON_EXTERNAL').length,
      closed: tickets.filter(t => t.status === 'CLOSED').length,
    };
  }, [tickets]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '16px 24px', borderBottom: '1px solid #dde8f2', background: '#ffffff' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, letterSpacing: -0.3 }}>{title}</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {mode === 'region' && userRegions.length > 1 && (
              <select value={selectedRegion} onChange={e => setSelectedRegion(e.target.value)}
                style={{ background: '#dde8f2', border: '1px solid #c0d0e4', borderRadius: 8, padding: '6px 12px', color: '#1e3a4f', fontSize: 12, cursor: 'pointer' }}>
                <option value="all">All Regions</option>
                {userRegions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            )}
            <button onClick={fetchTickets} style={{ background: '#dde8f2', border: '1px solid #c0d0e4', borderRadius: 8, padding: '6px 10px', color: '#6b8299', cursor: 'pointer' }} title="Refresh">
              <Icon name="settings" size={14} />
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ position: 'relative', flex: 1, maxWidth: 320 }}>
            <input type="text" placeholder="Search tickets..." value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{ width: '100%', padding: '8px 12px 8px 32px', background: '#dde8f2', border: '1px solid #c0d0e4', borderRadius: 8, color: '#1e3a4f', fontSize: 12, outline: 'none' }} />
            <div style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#8a9fb0', pointerEvents: 'none' }}>
              <Icon name="search" size={14} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 4, background: '#dde8f2', borderRadius: 8, padding: 3, border: '1px solid #c0d0e4' }}>
            {[
              { key: 'all', label: 'Active' },
              ...(mode !== 'personal' ? [{ key: 'unassigned', label: 'Unassigned' }] : []),
              { key: 'open', label: 'Open' },
              { key: 'waiting', label: 'Waiting' },
              { key: 'closed', label: 'Closed' },
            ].map(f => (
              <button key={f.key} onClick={() => setQueueFilter(f.key)}
                style={{ padding: '5px 12px', borderRadius: 6, border: 'none', background: queueFilter === f.key ? '#1a5e9a' : 'transparent', color: queueFilter === f.key ? '#fff' : '#5a7a8a', fontSize: 11, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Ticket List */}
      <div style={{ flex: 1, overflow: 'auto', padding: '8px 16px' }}>
        {loading && tickets.length === 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#8a9fb0' }}>Loading...</div>
        )}
        {!loading && tickets.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#8a9fb0', gap: 8 }}>
            <Icon name="inbox" size={40} />
            <div style={{ fontSize: 14, fontWeight: 500 }}>No tickets found</div>
          </div>
        )}
        {tickets.map(ticket => {
          const tags = ticket.tags || [];
          return (
            <button key={ticket.id} onClick={() => onOpenTicket(ticket.id)}
              style={{ display: 'flex', alignItems: 'stretch', width: '100%', padding: '14px 16px', background: ticket.has_unread ? '#f0f4f9' : 'transparent', border: '1px solid', borderColor: ticket.has_unread ? '#c0d0e4' : 'transparent', borderRadius: 10, cursor: 'pointer', textAlign: 'left', color: '#1e3a4f', marginBottom: 4, transition: 'all 0.15s', gap: 14 }}
              onMouseEnter={e => { e.currentTarget.style.background = '#d4e0f0'; }}
              onMouseLeave={e => { e.currentTarget.style.background = ticket.has_unread ? '#f0f4f9' : 'transparent'; }}>
              {/* Unread dot */}
              <div style={{ width: 8, display: 'flex', alignItems: 'flex-start', paddingTop: 6 }}>
                {ticket.has_unread ? <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#1a5e9a' }} /> : null}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 10, fontFamily: "'IBM Plex Mono', monospace", color: '#6b8299' }}>{ticket.id.toUpperCase()}</span>
                  <StatusBadge status={ticket.status} />
                  {tags.map(tag => <TagPill key={tag.id} tag={tag} />)}
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ticket.subject}</div>
                <div style={{ fontSize: 12, color: '#6b8299', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {(ticket.external_participants || [])[0]}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'space-between', gap: 4, minWidth: 120 }}>
                <span style={{ fontSize: 11, color: '#6b8299' }}>{fmt.time(ticket.last_activity_at)}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 10, color: '#8a9fb0', background: '#dde8f2', padding: '2px 8px', borderRadius: 4 }}>{ticket.region?.name}</span>
                  {ticket.assignee && <Avatar user={ticket.assignee} size={22} />}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
