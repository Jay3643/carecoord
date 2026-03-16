const fs = require('fs');
let gmail = fs.readFileSync('server/routes/gmail.js', 'utf8');

// Fix: subtract 1 day from afterDate so Gmail returns today's emails too
// The internalDate timestamp check still filters accurately
gmail = gmail.replace(
  "const afterDate = new Date(syncState.last_sync_at).toISOString().split('T')[0];",
  "const afterMs = new Date(syncState.last_sync_at); afterMs.setDate(afterMs.getDate() - 1);\n  const afterDate = afterMs.toISOString().split('T')[0];"
);

fs.writeFileSync('server/routes/gmail.js', gmail, 'utf8');
console.log('fixed — Gmail query now includes today\'s emails');
console.log('Server will auto-restart. Test by running in browser console:');
console.log("  fetch('/api/gmail/sync', {method:'POST', credentials:'include'}).then(r=>r.json()).then(console.log)");
