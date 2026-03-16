const fs = require('fs');

// ── 1. Fix PersonalInbox: remove duplicate bulk toolbar ──
let inbox = fs.readFileSync('client/src/components/PersonalInbox.jsx', 'utf8');

// Remove the second duplicate block (lines with checkedIds.size > 0 that appear twice)
// Find first occurrence end, then remove second occurrence
const marker = `{checkedIds.size > 0 && (
            <div style={{ display:'flex',alignItems:'center',gap:8,marginLeft:8 }}>`;
const firstIdx = inbox.indexOf(marker);
const firstEnd = inbox.indexOf('</div>\n          )}', firstIdx) + '</div>\n          )}'.length;
const secondIdx = inbox.indexOf(marker, firstEnd);
if (secondIdx > -1) {
  const secondEnd = inbox.indexOf('</div>\n          )}', secondIdx) + '</div>\n          )}'.length;
  inbox = inbox.substring(0, secondIdx) + inbox.substring(secondEnd);
  console.log('  ✓ PersonalInbox — removed duplicate bulk toolbar');
}

fs.writeFileSync('client/src/components/PersonalInbox.jsx', inbox, 'utf8');

// ── 2. Fix QueueScreen: add checkboxes to ticket rows ──
let queue = fs.readFileSync('client/src/components/QueueScreen.jsx', 'utf8');

// Add checkbox before the unread dot in each ticket row
queue = queue.replace(
  `<button key={ticket.id} onClick={() => onOpenTicket(ticket.id)}
              style={{ display: 'flex', alignItems: 'stretch', width: '100%', padding: '14px 16px',`,
  `<button key={ticket.id} onClick={() => onOpenTicket(ticket.id)}
              style={{ display: 'flex', alignItems: 'stretch', width: '100%', padding: '14px 8px 14px 16px',`
);

// Add checkbox click handler inside the ticket row, before the unread dot
queue = queue.replace(
  `{/* Unread dot */}
              <div style={{ width: 8, display: 'flex', alignItems: 'flex-start', paddingTop: 6 }}>`,
  `{/* Checkbox */}
              <div onClick={e => { e.stopPropagation(); toggleTicketSelect(ticket.id); }}
                style={{ width: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer' }}>
                <div style={{ width: 16, height: 16, border: selectedTicketIds.has(ticket.id) ? 'none' : '2px solid #c0d0e4', borderRadius: 3,
                  background: selectedTicketIds.has(ticket.id) ? '#1a5e9a' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {selectedTicketIds.has(ticket.id) && <span style={{ color: '#fff', fontSize: 10, fontWeight: 700 }}>✓</span>}
                </div>
              </div>
              {/* Unread dot */}
              <div style={{ width: 8, display: 'flex', alignItems: 'flex-start', paddingTop: 6 }}>`
);

fs.writeFileSync('client/src/components/QueueScreen.jsx', queue, 'utf8');
console.log('  ✓ QueueScreen — checkboxes added to ticket rows');

console.log('');
console.log('Done. Refresh browser.');
console.log('  Email: check emails → blue "Push to Queue" bar in toolbar');
console.log('  Queue: check tickets → orange "Pull from Queue" bar appears');
