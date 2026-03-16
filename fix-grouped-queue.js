const fs = require('fs');
let q = fs.readFileSync('client/src/components/QueueScreen.jsx', 'utf8');

// Add expandedGroups state
q = q.replace(
  "const [selectedTicketIds, setSelectedTicketIds] = useState(new Set());",
  "const [selectedTicketIds, setSelectedTicketIds] = useState(new Set());\n  const [expandedGroups, setExpandedGroups] = useState(new Set());"
);

// Add toggle function and grouped tickets memo
q = q.replace(
  "const filteredTickets = useMemo(",
  `const toggleGroup = (key) => {
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

  const filteredTickets = useMemo(`
);

// Replace the ticket list section with grouped view
q = q.replace(
  `{/* Ticket List */}
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
        {/* Bulk action bar for supervisor/admin */}
        {selectedTicketIds.size > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', background: '#e8f0fe', borderBottom: '1px solid #c0d0e4' }}>
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
        {paginatedTickets.map(ticket => {
          const tags = ticket.tags || [];
          return (
            <button key={ticket.id} onClick={() => onOpenTicket(ticket.id)}
              style={{ display: 'flex', alignItems: 'stretch', width: '100%', padding: '14px 8px 14px 16px', background: ticket.has_unread ? '#f0f4f9' : 'transparent', border: '1px solid', borderColor: ticket.has_unread ? '#c0d0e4' : 'transparent', borderRadius: 10, cursor: 'pointer', textAlign: 'left', color: '#1e3a4f', marginBottom: 4, transition: 'all 0.15s', gap: 14 }}
              onMouseEnter={e => { e.currentTarget.style.background = '#d4e0f0'; }}
              onMouseLeave={e => { e.currentTarget.style.background = ticket.has_unread ? '#f0f4f9' : 'transparent'; }}>
              {/* Checkbox */}
              <div onClick={e => { e.stopPropagation(); toggleTicketSelect(ticket.id); }}
                style={{ width: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer' }}>
                <div style={{ width: 16, height: 16, border: selectedTicketIds.has(ticket.id) ? 'none' : '2px solid #c0d0e4', borderRadius: 3,
                  background: selectedTicketIds.has(ticket.id) ? '#1a5e9a' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {selectedTicketIds.has(ticket.id) && <span style={{ color: '#fff', fontSize: 10, fontWeight: 700 }}>✓</span>}
                </div>
              </div>
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
      </div>`,
  `{/* Ticket List — Grouped by Assignee */}
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
      </div>`
);

fs.writeFileSync('client/src/components/QueueScreen.jsx', q, 'utf8');
console.log('✓ QueueScreen — tickets grouped by assignee with collapsible sections');
console.log('  • Unassigned section (amber) at top');
console.log('  • Each coordinator section with avatar, name, ticket count, unread badge');
console.log('  • Click to expand/collapse');
console.log('  • Checkboxes still work for bulk actions');
console.log('Refresh browser.');
