const fs = require('fs');

// The issue: App.jsx polls every 15 seconds for counts, but after push/pull
// the numbers don't update until the next poll. Fix: trigger immediate refresh
// after any push/pull action, and reduce poll interval.

let app = fs.readFileSync('client/src/App.jsx', 'utf8');

// 1. Reduce polling interval from 15s to 5s
app = app.replace(
  'const interval = setInterval(fetchCounts, 15000);',
  'const interval = setInterval(fetchCounts, 5000);'
);

// 2. Expose fetchCounts so child components can trigger it
// Add a ref and pass it down
if (!app.includes('refreshCounts')) {
  // Add refreshCounts function that child components can call
  app = app.replace(
    'const isSupervisor = currentUser?.role === \'supervisor\' || currentUser?.role === \'admin\';',
    `const isSupervisor = currentUser?.role === 'supervisor' || currentUser?.role === 'admin';

  const refreshCounts = () => {
    if (!currentUser) return;
    api.getTickets({ queue: 'region', status: 'unassigned' })
      .then(d => setUnassignedCount(d.tickets?.length || 0)).catch(() => {});
    api.getTickets({ queue: 'personal', status: 'all' })
      .then(d => setPersonalCount((d.tickets || []).filter(t => t.status !== 'CLOSED').length)).catch(() => {});
  };`
  );

  // Pass refreshCounts to QueueScreen
  app = app.replace(
    'showToast={showToast} />',
    'showToast={showToast} refreshCounts={refreshCounts} />'
  );
  // Do it for both queue screens (there are two)
  app = app.replace(
    'showToast={showToast} />',
    'showToast={showToast} refreshCounts={refreshCounts} />'
  );

  // Pass to PersonalInbox too
  app = app.replace(
    '<PersonalInbox currentUser={currentUser} showToast={showToast} />',
    '<PersonalInbox currentUser={currentUser} showToast={showToast} refreshCounts={refreshCounts} />'
  );
}

fs.writeFileSync('client/src/App.jsx', app, 'utf8');
console.log('  ✓ App.jsx — 5s polling + refreshCounts passed to children');

// 3. Update QueueScreen to accept and call refreshCounts after bulk pull
let queue = fs.readFileSync('client/src/components/QueueScreen.jsx', 'utf8');
queue = queue.replace(
  'export default function QueueScreen({ title, mode, currentUser, regions, onOpenTicket, showToast }) {',
  'export default function QueueScreen({ title, mode, currentUser, regions, onOpenTicket, showToast, refreshCounts }) {'
);
// Call refreshCounts after bulk pull
queue = queue.replace(
  "setSelectedTicketIds(new Set());\n    fetchTickets();\n  };",
  "setSelectedTicketIds(new Set());\n    fetchTickets();\n    if (refreshCounts) refreshCounts();\n  };"
);
fs.writeFileSync('client/src/components/QueueScreen.jsx', queue, 'utf8');
console.log('  ✓ QueueScreen — triggers refreshCounts after pull');

// 4. Update PersonalInbox to accept and call refreshCounts after bulk push
let inbox = fs.readFileSync('client/src/components/PersonalInbox.jsx', 'utf8');
inbox = inbox.replace(
  'export default function PersonalInbox({ showToast }) {',
  'export default function PersonalInbox({ showToast, refreshCounts }) {'
);
// After bulk push
inbox = inbox.replace(
  "showToast?.(d.pushed + ' pushed to queue');\n      setMessages(prev => prev.filter(m => !checkedIds.has(m.id)));\n      setCheckedIds(new Set());",
  "showToast?.(d.pushed + ' pushed to queue');\n      setMessages(prev => prev.filter(m => !checkedIds.has(m.id)));\n      setCheckedIds(new Set());\n      if (refreshCounts) refreshCounts();"
);
// After single push
inbox = inbox.replace(
  "showToast?.('Pushed to queue: ' + (d.subject||''));\n                        setMessages(prev => prev.filter(m => m.id !== selected.id));\n                        setSelected(null); setDetail(null);",
  "showToast?.('Pushed to queue: ' + (d.subject||''));\n                        setMessages(prev => prev.filter(m => m.id !== selected.id));\n                        setSelected(null); setDetail(null);\n                        if (refreshCounts) refreshCounts();"
);
fs.writeFileSync('client/src/components/PersonalInbox.jsx', inbox, 'utf8');
console.log('  ✓ PersonalInbox — triggers refreshCounts after push');

console.log('');
console.log('Done. Refresh browser.');
console.log('  Counts now update within 5 seconds automatically');
console.log('  Counts update INSTANTLY after push/pull actions');
