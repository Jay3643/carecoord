// fix-queue-loop.js
const fs = require('fs');
const path = require('path');

// 1. Add missing getTickets to api.js
const apiPath = path.join(__dirname, 'client', 'src', 'api.js');
let api = fs.readFileSync(apiPath, 'utf8');

if (!api.includes('getTickets:')) {
  api = api.replace(
    '// Auto-added',
    '// Tickets\n  getTickets: (params) => request(\'/tickets\' + (params ? \'?\' + new URLSearchParams(params).toString() : \'\')),\n\n  // Auto-added'
  );
  // If no Auto-added marker, try before Google Workspace
  if (!api.includes('getTickets:')) {
    api = api.replace(
      '// Google Workspace',
      'getTickets: (params) => request(\'/tickets\' + (params ? \'?\' + new URLSearchParams(params).toString() : \'\')),\n\n  // Google Workspace'
    );
  }
  fs.writeFileSync(apiPath, api, 'utf8');
  console.log('  ✓ api.js — added getTickets');
} else {
  console.log('  ✓ api.js — getTickets already exists');
}

// 2. Fix QueueScreen — remove interval, stabilize useEffect
const queuePath = path.join(__dirname, 'client', 'src', 'components', 'QueueScreen.jsx');
let queue = fs.readFileSync(queuePath, 'utf8');

// Remove the polling interval entirely
queue = queue.replace(
  /\s*useEffect\(\(\) => \{\s*const interval = setInterval\(fetchTickets, \d+\);\s*return \(\) => clearInterval\(interval\);\s*\}, \[fetchTickets\]\);/,
  ''
);

// Fix the main useEffect to not depend on fetchTickets (which changes every render)
queue = queue.replace(
  "useEffect(() => { fetchTickets(); }, [fetchTickets]);",
  "useEffect(() => { fetchTickets(); }, []);"
);

fs.writeFileSync(queuePath, queue, 'utf8');
console.log('  ✓ QueueScreen.jsx — removed polling loop, stable fetch');

console.log('\nRefresh browser.');
