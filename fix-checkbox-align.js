const fs = require('fs');
let queue = fs.readFileSync('client/src/components/QueueScreen.jsx', 'utf8');

// The ticket rows have:
// padding: 14px 8px 14px 16px
// then a 20px wide checkbox div
// then 8px wide unread dot div
// 
// So checkbox starts at 16px from left edge, inside a 20px container
// The select-all bar needs to match: 16px left padding, 20px container, then 8px spacer

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
      </div>`
);

fs.writeFileSync('client/src/components/QueueScreen.jsx', queue, 'utf8');
console.log('✓ Select-all checkbox aligned directly above ticket checkboxes');
console.log('Refresh browser.');
