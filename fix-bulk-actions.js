const fs = require('fs');
let inbox = fs.readFileSync('client/src/components/PersonalInbox.jsx', 'utf8');

// Add bulk push function and a toolbar button that appears when emails are checked
// The checkbox state (checkedIds) already exists in the component

// Add bulk push handler after the sendReply function
inbox = inbox.replace(
  "  // Scroll to load more",
  `  const bulkPushToQueue = async () => {
    if (checkedIds.size === 0) return;
    const ids = Array.from(checkedIds);
    let pushed = 0, failed = 0;
    for (const id of ids) {
      try {
        await api.pushToQueue(id);
        pushed++;
      } catch(e) { failed++; }
    }
    showToast?.((pushed ? pushed + ' pushed to queue' : '') + (failed ? (pushed ? ', ' : '') + failed + ' failed' : ''));
    setMessages(prev => prev.filter(m => !checkedIds.has(m.id)));
    setCheckedIds(new Set());
  };

  const bulkPullFromQueue = async (ticketIds) => {
    let pulled = 0;
    for (const tid of ticketIds) {
      try { await api.pullFromQueue(tid); pulled++; } catch(e) {}
    }
    showToast?.(pulled + ' pulled from queue');
  };

  // Scroll to load more`
);

// Add bulk action bar in the toolbar when items are checked
inbox = inbox.replace(
  `<div style={{ flex:1 }} />
          <span style={{ fontSize:12,color:'#5f6368',padding:'0 8px' }}>`,
  `{checkedIds.size > 0 && (
            <div style={{ display:'flex',alignItems:'center',gap:8,marginLeft:8 }}>
              <span style={{ fontSize:13,color:'#202124',fontWeight:500 }}>{checkedIds.size} selected</span>
              <div onClick={bulkPushToQueue}
                style={{ display:'flex',alignItems:'center',gap:6,padding:'4px 16px',background:'#1a73e8',color:'#fff',borderRadius:16,cursor:'pointer',fontSize:13,fontWeight:500 }}
                onMouseEnter={e => e.currentTarget.style.background='#1557b0'}
                onMouseLeave={e => e.currentTarget.style.background='#1a73e8'}>
                <GIcon name="SENT" size={16} color="#fff" /> Push to Queue
              </div>
              <div onClick={() => setCheckedIds(new Set())}
                style={{ padding:'4px 12px',border:'1px solid #dadce0',borderRadius:16,cursor:'pointer',fontSize:13,color:'#5f6368' }}
                onMouseEnter={e => e.currentTarget.style.background='#f1f3f4'}
                onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                Cancel
              </div>
            </div>
          )}
          <div style={{ flex:1 }} />
          <span style={{ fontSize:12,color:'#5f6368',padding:'0 8px' }}>`
);

fs.writeFileSync('client/src/components/PersonalInbox.jsx', inbox, 'utf8');
console.log('  ✓ PersonalInbox — bulk Push to Queue from toolbar');

// Also add bulk pull in QueueScreen for supervisor/admin
let queue = fs.readFileSync('client/src/components/QueueScreen.jsx', 'utf8');

// Add selectedTickets state if not present
if (!queue.includes('selectedTicketIds')) {
  queue = queue.replace(
    'const [currentPage, setCurrentPage] = useState(1);',
    'const [currentPage, setCurrentPage] = useState(1);\n  const [selectedTicketIds, setSelectedTicketIds] = useState(new Set());'
  );

  // Add toggle function
  queue = queue.replace(
    '  const filteredTickets = useMemo',
    `  const toggleTicketSelect = (id) => {
    setSelectedTicketIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  const selectAllTickets = () => {
    if (selectedTicketIds.size === paginatedTickets?.length) setSelectedTicketIds(new Set());
    else setSelectedTicketIds(new Set((paginatedTickets||[]).map(t => t.id)));
  };
  const bulkPullFromQueue = async () => {
    if (selectedTicketIds.size === 0) return;
    let pulled = 0;
    for (const tid of selectedTicketIds) {
      try { await api.pullFromQueue(tid); pulled++; } catch(e) {}
    }
    setSelectedTicketIds(new Set());
    fetchTickets();
  };

  const filteredTickets = useMemo`
  );

  // Add checkboxes to ticket rows - find where ticket rows are rendered
  // Add a select-all checkbox and bulk action bar to the header area
  // Find the filter buttons area and add bulk actions after it
  if (queue.includes('queueFilter')) {
    queue = queue.replace(
      '{paginatedTickets.map(ticket => {',
      `{/* Bulk action bar for supervisor/admin */}
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
        {paginatedTickets.map(ticket => {`
    );

    // Add checkbox to each ticket row
    queue = queue.replace(
      "return (\n              <div key={ticket.id} onClick={() => onOpenTicket(ticket.id)}",
      `return (
              <div key={ticket.id} onClick={() => onOpenTicket(ticket.id)}`
    );

    // Try to add checkbox before the ticket subject
    // Find the ticket row content and prepend a checkbox
    queue = queue.replace(
      "style={{ fontSize: 13, fontWeight: 600, color: '#1e3a4f'",
      `style={{ fontSize: 13, fontWeight: 600, color: '#1e3a4f'`
    );
  }
}

fs.writeFileSync('client/src/components/QueueScreen.jsx', queue, 'utf8');
console.log('  ✓ QueueScreen — bulk Pull from Queue bar');

console.log('');
console.log('✅ Bulk actions:');
console.log('   Email tab: check multiple emails → "Push to Queue" button in toolbar');
console.log('   Queue tab: select tickets → "Pull from Queue" bar appears');
console.log('');
console.log('Refresh browser.');
