const fs = require('fs');
let queue = fs.readFileSync('client/src/components/QueueScreen.jsx', 'utf8');

// Add a select-all checkbox in the header area, between the search and filter buttons
queue = queue.replace(
  `{/* Ticket List */}
      <div style={{ flex: 1, overflow: 'auto', padding: '8px 16px' }}>`,
  `{/* Select All Bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 16px', borderBottom: '1px solid #e8f0f8', background: '#f8fafc' }}>
        <div onClick={selectAllTickets}
          style={{ width: 16, height: 16, border: selectedTicketIds.size > 0 && selectedTicketIds.size === paginatedTickets.length ? 'none' : '2px solid #c0d0e4', borderRadius: 3,
            background: selectedTicketIds.size > 0 && selectedTicketIds.size === paginatedTickets.length ? '#1a5e9a' : selectedTicketIds.size > 0 ? '#7baaf7' : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          {selectedTicketIds.size > 0 && <span style={{ color: '#fff', fontSize: 10, fontWeight: 700 }}>{selectedTicketIds.size === paginatedTickets.length ? '✓' : '—'}</span>}
        </div>
        <span style={{ fontSize: 12, color: '#6b8299', cursor: 'pointer' }} onClick={selectAllTickets}>
          {selectedTicketIds.size === 0 ? 'Select all' : selectedTicketIds.size === paginatedTickets.length ? 'Deselect all' : selectedTicketIds.size + ' selected'}
        </span>
        <span style={{ fontSize: 11, color: '#a0b0c0', marginLeft: 'auto' }}>{filteredTickets.length} tickets</span>
      </div>

      {/* Ticket List */}
      <div style={{ flex: 1, overflow: 'auto', padding: '8px 16px' }}>`
);

fs.writeFileSync('client/src/components/QueueScreen.jsx', queue, 'utf8');
console.log('✓ QueueScreen — select all bar added above ticket list');
console.log('Refresh browser.');
