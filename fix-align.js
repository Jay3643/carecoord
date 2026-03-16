const fs = require('fs');
let queue = fs.readFileSync('client/src/components/QueueScreen.jsx', 'utf8');

// Replace the select all bar with properly aligned version
queue = queue.replace(
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
      </div>`,
  `{/* Select All Bar */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '8px 16px 8px 32px', borderBottom: '1px solid #e8f0f8', background: '#f8fafc', gap: 12 }}>
        <div onClick={selectAllTickets}
          style={{ width: 16, height: 16, border: selectedTicketIds.size > 0 && selectedTicketIds.size === paginatedTickets.length ? 'none' : '2px solid #c0d0e4', borderRadius: 3,
            background: selectedTicketIds.size > 0 && selectedTicketIds.size === paginatedTickets.length ? '#1a5e9a' : selectedTicketIds.size > 0 ? '#7baaf7' : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
          {selectedTicketIds.size > 0 && <span style={{ color: '#fff', fontSize: 10, fontWeight: 700 }}>{selectedTicketIds.size === paginatedTickets.length ? '✓' : '—'}</span>}
        </div>
        <span style={{ fontSize: 12, color: '#6b8299', cursor: 'pointer', userSelect: 'none' }} onClick={selectAllTickets}>
          {selectedTicketIds.size === 0 ? 'Select all' : selectedTicketIds.size === paginatedTickets.length ? 'Deselect all' : selectedTicketIds.size + ' selected'}
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: '#a0b0c0' }}>{filteredTickets.length} tickets</span>
      </div>`
);

fs.writeFileSync('client/src/components/QueueScreen.jsx', queue, 'utf8');
console.log('✓ Select-all bar aligned with ticket checkboxes');
