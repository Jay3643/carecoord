const fs = require('fs');
let f = fs.readFileSync('client/src/components/QueueScreen.jsx', 'utf8');

// Add page state
f = f.replace(
  'const [loading, setLoading] = useState(true);',
  'const [loading, setLoading] = useState(true);\n  const [currentPage, setCurrentPage] = useState(1);\n  const PAGE_SIZE = 50;'
);

// Reset page when filter changes
f = f.replace(
  'const [queueFilter, setQueueFilter] = useState(',
  'const [queueFilterRaw, setQueueFilterRaw] = useState('
);

// Add wrapper that resets page
f = f.replace(
  'setQueueFilterRaw',
  'setQueueFilter'
);

// Actually let's just add page reset in the right places
// Revert - let me do this cleaner
f = fs.readFileSync('client/src/components/QueueScreen.jsx', 'utf8');

// Add pagination state after loading
f = f.replace(
  'const [loading, setLoading] = useState(true);',
  'const [loading, setLoading] = useState(true);\n  const [currentPage, setCurrentPage] = useState(1);\n  const PAGE_SIZE = 50;'
);

// After filteredTickets useMemo, add paginated version
f = f.replace(
  '  return (\n    <div style={{ display: \'flex\', flexDirection: \'column\', height: \'100%\' }}>',
  `  const totalPages = Math.ceil(filteredTickets.length / PAGE_SIZE);
  const paginatedTickets = filteredTickets.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>`
);

// Replace filteredTickets.map with paginatedTickets.map
f = f.replace(
  '{filteredTickets.map(ticket => {',
  '{paginatedTickets.map(ticket => {'
);

// Replace filteredTickets.length === 0 with check
f = f.replace(
  '!loading && filteredTickets.length === 0 && (',
  '!loading && filteredTickets.length === 0 && ('
);

// Reset page when filter changes
f = f.replace(
  'setQueueFilter(f)',
  'setQueueFilter(f); setCurrentPage(1)'
);

// If setQueueFilter is used differently, also reset on region change
f = f.replace(
  'setSelectedRegion(r)',
  'setSelectedRegion(r); setCurrentPage(1)'
);

// Add pagination controls before the closing </div> of the main container
// Find the ticket list container's closing and add pagination after it
f = f.replace(
  '{filteredTickets.length === 0',
  '{paginatedTickets.length === 0'
);

// Add pagination bar - insert before the final closing divs
// Find the filter counts display area and add pagination info there
f = f.replace(
  "style={{ fontSize: 11, color: '#6b8299' }}>{filteredTickets.length} tickets</span>",
  "style={{ fontSize: 11, color: '#6b8299' }}>{filteredTickets.length} tickets · Page {currentPage} of {Math.max(1, totalPages)}</span>"
);

// If the above didn't match, try alternate
if (!f.includes('Page {currentPage}')) {
  // Add pagination bar at bottom of ticket list
  f = f.replace(
    '      </div>\n    </div>\n  );\n}',
    `      </div>
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
}`
  );
}

fs.writeFileSync('client/src/components/QueueScreen.jsx', f, 'utf8');
console.log('✓ QueueScreen — 50 per page with pagination controls');
console.log('  First / Prev / Page X of Y (Z tickets) / Next / Last');
console.log('  Resets to page 1 on filter or region change');
console.log('Refresh browser.');
