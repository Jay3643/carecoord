import React, { useState, useEffect, useMemo } from 'react';
import { api } from '../api';
import { fmt } from '../utils';
import Icon from './Icons';
import { StatusBadge, TagPill, Avatar } from './ui';

export default function QueueScreen({ title, mode, currentUser, regions, onOpenTicket }) {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedTicketIds, setSelectedTicketIds] = useState(new Set());
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const PAGE_SIZE = 50;
  const [selectedRegion, setSelectedRegion] = useState('all');
  const [queueFilter, setQueueFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState(null);

  const userRegions = useMemo(() =>
    regions.filter(r => currentUser.regionIds.includes(r.id)),
    [regions, currentUser]
  );

  const fetchTickets = async () => {
    setLoading(true);
    try {
      if (mode === 'region') await api.gmailAutoSync().catch(() => {});
      const params = { queue: mode === 'personal' ? 'personal' : 'region', status: 'all' };
      if (selectedRegion && selectedRegion !== 'all') params.region = selectedRegion;
      if (searchQuery) params.search = searchQuery;
      const data = await api.getTickets(params);
      setTickets(data.tickets || data || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { fetchTickets(); }, [selectedRegion, searchQuery]);

  // Polling for near-real-time

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

  const toggleTicketSelect = (id) => {
    setSelectedTicketIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  const selectAllTickets = () => {
    if (selectedTicketIds.size === paginatedTickets?.length) setSelectedTicketIds(new Set());
    else setSelectedTicketIds(new Set((paginatedTickets||[]).map(t => t.id)));
  };
  const bulkPullFromQueue = async () => {
    if (selectedTicketIds.size === 0) return;
    try {
      const d = await api.bulkPullFromQueue(Array.from(selectedTicketIds));
      showToast?.(d.pulled + ' pulled from queue');
    } catch(e) {}
    setSelectedTicketIds(new Set());
    fetchTickets();
    if (refreshCounts) refreshCounts();
  };

  const toggleGroup = (key) => {
    setExpandedGroups(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  };

  const groupedTickets = useMemo(() => {
    const groups = {};
    const ft = queueFilter === 'all' ? tickets.filter(t => t.status !== 'CLOSED')
      : queueFilter === 'unassigned' ? tickets.filter(t => !t.assignee_user_id && t.status !== 'CLOSED')
      : queueFilter === 'open' ? tickets.filter(t => t.status === 'OPEN')
      : queueFilter === 'waiting' ? tickets.filter(t => t.status === 'WAITING_ON_EXTERNAL')
      : queueFilter === 'closed' ? tickets.filter(t => t.status === 'CLOSED')
      : tickets;
    
    for (const t of ft) {
      const key = t.assignee_user_id || '_unassigned';
      if (!groups[key]) {
        groups[key] = {
          key,
          assignee: t.assignee || null,
          label: t.assignee ? t.assignee.name : 'Unassigned',
          tickets: [],
        };
      }
      groups[key].tickets.push(t);
    }

    // Sort: unassigned first, then by assignee name
    const sorted = Object.values(groups).sort((a, b) => {
      if (a.key === '_unassigned') return -1;
      if (b.key === '_unassigned') return 1;
      return a.label.localeCompare(b.label);
    });
    return sorted;
  }, [tickets, queueFilter]);

  const filteredTickets = useMemo(() => {
    if (queueFilter === 'all') return tickets.filter(t => t.status !== 'CLOSED');
    if (queueFilter === 'unassigned') return tickets.filter(t => !t.assignee_user_id && t.status !== 'CLOSED');
    if (queueFilter === 'open') return tickets.filter(t => t.status === 'OPEN');
    if (queueFilter === 'waiting') return tickets.filter(t => t.status === 'WAITING_ON_EXTERNAL');
    if (queueFilter === 'closed') return tickets.filter(t => t.status === 'CLOSED');
    return tickets;
  }, [tickets, queueFilter]);

  const totalPages = Math.ceil(filteredTickets.length / PAGE_SIZE);
  const paginatedTickets = filteredTickets.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

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

      {/* Select All Bar */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '6px 16px', borderBottom: '1px solid #e8f0f8', background: '#f8fafc', gap: 0 }}>
        <div onClick={selectAllTickets}
          style={{ width: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer' }}>
          <div style={{ width: 16, height: 16, border: selectedTicketIds.size > 0 && selectedTicketIds.size === paginatedTickets.length ? 'none' : '2px solid #c0d0e4', borderRadius: 3,
            background: selectedTicketIds.size > 0 && selectedTicketIds.size === paginatedTickets.length ? '#1a5e9a' : selectedTicketIds.size > 0 ? '#7baaf7' : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {selectedTicketIds.size > 0 && <span style={{ color: '#fff', fontSize: 10, fontWeight: 700 }}>{selectedTicketIds.size === paginatedTickets.length ? '✓' : '—'}</span>}
          </div>
        </div>
        <div style={{ width: 8, flexShrink: 0 }} />
        <span style={{ fontSize: 12, color: '#6b8299', cursor: 'pointer', marginLeft: 14 }} onClick={selectAllTickets}>
          {selectedTicketIds.size === 0 ? 'Select all' : selectedTicketIds.size === paginatedTickets.length ? 'Deselect all' : selectedTicketIds.size + ' selected'}
        </span>
        <span style={{ fontSize: 11, color: '#a0b0c0', marginLeft: 'auto' }}>{filteredTickets.length} tickets</span>
      </div>

      {/* Ticket List — Grouped by Assignee */}
      <div style={{ flex: 1, overflow: 'auto', padding: '8px 16px' }}>
        {loading && tickets.length === 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#8a9fb0' }}>Loading...</div>
        )}
        {!loading && filteredTickets.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#8a9fb0', gap: 8 }}>
            <Icon name="inbox" size={40} />
            <div style={{ fontSize: 14, fontWeight: 500 }}>No tickets found</div>
          </div>
        )}
        {/* Bulk action bar */}
        {selectedTicketIds.size > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', marginBottom: 8, background: '#e8f0fe', borderRadius: 8, border: '1px solid #c0d0e4' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#1a5e9a' }}>{selectedTicketIds.size} selected</span>
            <button onClick={bulkPullFromQueue}
              style={{ padding: '4px 14px', background: '#c96a1b', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
              Pull from Queue
            </button>
            <button onClick={() => setSelectedTicketIds(new Set())}
              style={{ padding: '4px 14px', background: '#dde8f2', color: '#5a7a8a', border: '1px solid #c0d0e4', borderRadius: 6, cursor: 'pointer', fontSize: 11 }}>
              Cancel
            </button>
          </div>
        )}
        {groupedTickets.map(group => {
          const isExpanded = expandedGroups.has(group.key);
          const unreadCount = group.tickets.filter(t => t.has_unread).length;
          return (
            <div key={group.key} style={{ marginBottom: 6 }}>
              {/* Group Header */}
              <button onClick={() => toggleGroup(group.key)}
                style={{ display: 'flex', alignItems: 'center', width: '100%', padding: '10px 16px', background: group.key === '_unassigned' ? '#fef8ec' : '#f0f4f9',
                  border: '1px solid', borderColor: group.key === '_unassigned' ? '#f0ddb0' : '#dde8f2', borderRadius: isExpanded ? '10px 10px 0 0' : 10,
                  cursor: 'pointer', textAlign: 'left', color: '#1e3a4f', gap: 10, transition: 'all 0.1s' }}
                onMouseEnter={e => e.currentTarget.style.background = group.key === '_unassigned' ? '#fdf0d5' : '#e4ecf5'}
                onMouseLeave={e => e.currentTarget.style.background = group.key === '_unassigned' ? '#fef8ec' : '#f0f4f9'}>
                {/* Expand arrow */}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="#6b8299" style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.15s', flexShrink: 0 }}>
                  <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>
                </svg>
                {/* Avatar or icon */}
                {group.assignee ? (
                  <Avatar user={group.assignee} size={28} />
                ) : (
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#c9963b20', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="inbox" size={14} />
                  </div>
                )}
                {/* Name */}
                <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: group.key === '_unassigned' ? '#c9963b' : '#1e3a4f' }}>
                  {group.label}
                </span>
                {/* Unread badge */}
                {unreadCount > 0 && (
                  <span style={{ background: '#1a5e9a', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10, minWidth: 18, textAlign: 'center' }}>
                    {unreadCount} new
                  </span>
                )}
                {/* Total count */}
                <span style={{ fontSize: 12, color: '#6b8299', fontWeight: 500 }}>
                  {group.tickets.length} ticket{group.tickets.length !== 1 ? 's' : ''}
                </span>
              </button>
              {/* Expanded ticket list */}
              {isExpanded && (
                <div style={{ border: '1px solid', borderColor: group.key === '_unassigned' ? '#f0ddb0' : '#dde8f2', borderTop: 'none', borderRadius: '0 0 10px 10px', overflow: 'hidden' }}>
                  {group.tickets.map(ticket => {
                    const tags = ticket.tags || [];
                    return (
                      <button key={ticket.id} onClick={() => onOpenTicket(ticket.id)}
                        style={{ display: 'flex', alignItems: 'stretch', width: '100%', padding: '12px 8px 12px 16px', background: ticket.has_unread ? '#f8faff' : '#fff', border: 'none', borderBottom: '1px solid #f0f4f9',
                          cursor: 'pointer', textAlign: 'left', color: '#1e3a4f', transition: 'background 0.1s', gap: 12 }}
                        onMouseEnter={e => e.currentTarget.style.background = '#e8f0f8'}
                        onMouseLeave={e => e.currentTarget.style.background = ticket.has_unread ? '#f8faff' : '#fff'}>
                        {/* Checkbox */}
                        <div onClick={e => { e.stopPropagation(); toggleTicketSelect(ticket.id); }}
                          style={{ width: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer' }}>
                          <div style={{ width: 16, height: 16, border: selectedTicketIds.has(ticket.id) ? 'none' : '2px solid #c0d0e4', borderRadius: 3,
                            background: selectedTicketIds.has(ticket.id) ? '#1a5e9a' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {selectedTicketIds.has(ticket.id) && <span style={{ color: '#fff', fontSize: 10, fontWeight: 700 }}>✓</span>}
                          </div>
                        </div>
                        {/* Unread dot */}
                        <div style={{ width: 8, display: 'flex', alignItems: 'center' }}>
                          {ticket.has_unread ? <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#1a5e9a' }} /> : null}
                        </div>
                        {/* Content */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 10, fontFamily: "'IBM Plex Mono', monospace", color: '#6b8299' }}>{ticket.id.toUpperCase()}</span>
                            <StatusBadge status={ticket.status} />
                            {tags.map(tag => <TagPill key={tag.id} tag={tag} />)}
                          </div>
                          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ticket.subject}</div>
                          <div style={{ fontSize: 11, color: '#6b8299', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {(ticket.external_participants || [])[0]}
                          </div>
                        </div>
                        {/* Right side */}
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'center', gap: 4, minWidth: 100, flexShrink: 0 }}>
                          <span style={{ fontSize: 11, color: '#6b8299' }}>{fmt.time(ticket.last_activity_at)}</span>
                          <span style={{ fontSize: 10, color: '#8a9fb0', background: '#f0f4f9', padding: '2px 8px', borderRadius: 4 }}>{ticket.region?.name}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '10px 16px', borderTop: '1px solid #dde8f2', background: '#f0f4f9', flexShrink: 0 }}>
          <button onClick={() => setCurrentPage(1)} disabled={currentPage === 1}
            style={{ padding: '4px 10px', background: currentPage === 1 ? '#e8f0f8' : '#fff', border: '1px solid #c0d0e4', borderRadius: 6, cursor: currentPage === 1 ? 'default' : 'pointer', fontSize: 12, color: currentPage === 1 ? '#a0b0c0' : '#1a5e9a', fontWeight: 600 }}>
            First
          </button>
          <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}
            style={{ padding: '4px 10px', background: currentPage === 1 ? '#e8f0f8' : '#fff', border: '1px solid #c0d0e4', borderRadius: 6, cursor: currentPage === 1 ? 'default' : 'pointer', fontSize: 12, color: currentPage === 1 ? '#a0b0c0' : '#1a5e9a', fontWeight: 600 }}>
            ← Prev
          </button>
          <span style={{ fontSize: 13, color: '#1e3a4f', fontWeight: 600, padding: '0 8px' }}>
            Page {currentPage} of {totalPages}
          </span>
          <span style={{ fontSize: 12, color: '#6b8299' }}>
            ({filteredTickets.length} tickets)
          </span>
          <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}
            style={{ padding: '4px 10px', background: currentPage === totalPages ? '#e8f0f8' : '#fff', border: '1px solid #c0d0e4', borderRadius: 6, cursor: currentPage === totalPages ? 'default' : 'pointer', fontSize: 12, color: currentPage === totalPages ? '#a0b0c0' : '#1a5e9a', fontWeight: 600 }}>
            Next →
          </button>
          <button onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages}
            style={{ padding: '4px 10px', background: currentPage === totalPages ? '#e8f0f8' : '#fff', border: '1px solid #c0d0e4', borderRadius: 6, cursor: currentPage === totalPages ? 'default' : 'pointer', fontSize: 12, color: currentPage === totalPages ? '#a0b0c0' : '#1a5e9a', fontWeight: 600 }}>
            Last
          </button>
        </div>
      )}
    </div>
  );
}
