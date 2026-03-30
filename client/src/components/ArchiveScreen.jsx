import React, { useState, useEffect } from 'react';
import { api } from '../api';
import { fmt } from '../utils';
import Icon from './Icons';
import { StatusBadge, TagPill, Avatar } from './ui';

export default function ArchiveScreen({ currentUser, isSupervisor, onOpenTicket, showToast }) {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 25;

  const fetchArchive = async () => {
    setLoading(true);
    try {
      const params = { queue: 'region', status: 'closed' };
      if (searchQuery) params.search = searchQuery;
      const data = await api.getTickets(params);
      setTickets((data.tickets || []).sort((a, b) => (b.closed_at || b.last_activity_at || 0) - (a.closed_at || a.last_activity_at || 0)));
    } catch (e) { showToast?.('Failed to load archive'); }
    setLoading(false);
  };

  useEffect(() => { fetchArchive(); }, [searchQuery]);

  const totalPages = Math.ceil(tickets.length / PAGE_SIZE);
  const paginated = tickets.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const handleReopen = async (ticketId, e) => {
    e.stopPropagation();
    if (!isSupervisor) { showToast?.('Supervisor access required to reopen'); return; }
    try {
      await api.changeStatus(ticketId, 'OPEN');
      showToast?.('Ticket reopened');
      fetchArchive();
    } catch (e) { showToast?.(e.message); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: "'IBM Plex Sans', -apple-system, sans-serif" }}>
      {/* Header */}
      <div style={{ padding: '16px 24px', borderBottom: '1px solid #dde8f2', background: '#fff', display: 'flex', alignItems: 'center', gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: '#1e3a4f', margin: 0 }}>Archive</h1>
          <div style={{ fontSize: 12, color: '#6b8299', marginTop: 2 }}>{tickets.length} closed tickets</div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#f0f4f9', border: '1px solid #c0d0e4', borderRadius: 8, padding: '6px 12px', minWidth: 280 }}>
          <Icon name="search" size={14} />
          <input type="text" placeholder="Search archived tickets..." value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); setCurrentPage(1); }}
            style={{ border: 'none', background: 'none', outline: 'none', fontSize: 13, color: '#1e3a4f', flex: 1 }} />
        </div>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflow: 'auto', padding: '16px 24px' }}>
        {loading && <div style={{ textAlign: 'center', padding: 32, color: '#8a9fb0' }}>Loading archive...</div>}
        {!loading && tickets.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#8a9fb0', gap: 8 }}>
            <Icon name="shield" size={40} />
            <div style={{ fontSize: 14, fontWeight: 500 }}>No archived tickets</div>
          </div>
        )}
        {!loading && paginated.length > 0 && (
          <div style={{ border: '1px solid #dde8f2', borderRadius: 10, overflow: 'hidden' }}>
            {paginated.map(ticket => {
              const tags = ticket.tags || [];
              const closeReason = ticket.close_reason_id;
              return (
                <button key={ticket.id} onClick={() => onOpenTicket(ticket.id)}
                  style={{ display: 'flex', alignItems: 'stretch', width: '100%', padding: '12px 16px', background: '#fff', border: 'none', borderBottom: '1px solid #f0f4f9', cursor: 'pointer', textAlign: 'left', color: '#1e3a4f', gap: 12 }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                  onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 10, fontFamily: "'IBM Plex Mono', monospace", color: '#8a9fb0' }}>{ticket.id.toUpperCase()}</span>
                      <StatusBadge status={ticket.status} />
                      {tags.map(tag => <TagPill key={tag.id} tag={tag} />)}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ticket.subject}</div>
                    <div style={{ fontSize: 11, color: '#6b8299', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {(ticket.external_participants || [])[0]}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'center', gap: 4, minWidth: 130, flexShrink: 0 }}>
                    <span style={{ fontSize: 11, color: '#6b8299' }}>Closed {fmt.time(ticket.closed_at)}</span>
                    {ticket.assignee && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Avatar user={ticket.assignee} size={16} />
                        <span style={{ fontSize: 10, color: '#8a9fb0' }}>{ticket.assignee.name}</span>
                      </div>
                    )}
                    <span style={{ fontSize: 10, color: '#8a9fb0', background: '#f0f4f9', padding: '2px 8px', borderRadius: 4 }}>{ticket.region?.name}</span>
                  </div>
                  {isSupervisor && (
                    <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                      <button onClick={(e) => handleReopen(ticket.id, e)}
                        style={{ padding: '4px 10px', background: '#e8f0fe', color: '#1a5e9a', border: '1px solid #c5d7f2', borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
                        onMouseEnter={e => { e.currentTarget.style.background = '#d2e3fc'; e.stopPropagation(); }}
                        onMouseLeave={e => { e.currentTarget.style.background = '#e8f0fe'; }}>
                        Reopen
                      </button>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 16 }}>
            <button onClick={() => setCurrentPage(1)} disabled={currentPage === 1}
              style={{ padding: '4px 10px', background: '#dde8f2', border: '1px solid #c0d0e4', borderRadius: 6, cursor: currentPage > 1 ? 'pointer' : 'default', fontSize: 11, color: currentPage > 1 ? '#1e3a4f' : '#c0d0e4' }}>First</button>
            <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}
              style={{ padding: '4px 10px', background: '#dde8f2', border: '1px solid #c0d0e4', borderRadius: 6, cursor: currentPage > 1 ? 'pointer' : 'default', fontSize: 11, color: currentPage > 1 ? '#1e3a4f' : '#c0d0e4' }}>Prev</button>
            <span style={{ fontSize: 12, color: '#6b8299' }}>Page {currentPage} of {totalPages}</span>
            <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}
              style={{ padding: '4px 10px', background: '#dde8f2', border: '1px solid #c0d0e4', borderRadius: 6, cursor: currentPage < totalPages ? 'pointer' : 'default', fontSize: 11, color: currentPage < totalPages ? '#1e3a4f' : '#c0d0e4' }}>Next</button>
            <button onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages}
              style={{ padding: '4px 10px', background: '#dde8f2', border: '1px solid #c0d0e4', borderRadius: 6, cursor: currentPage < totalPages ? 'pointer' : 'default', fontSize: 11, color: currentPage < totalPages ? '#1e3a4f' : '#c0d0e4' }}>Last</button>
          </div>
        )}
      </div>
    </div>
  );
}
