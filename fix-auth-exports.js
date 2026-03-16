const fs = require('fs');
let auth = fs.readFileSync('server/routes/auth.js', 'utf8');

// The problem: invite routes were added AFTER module.exports = router;
// There are now TWO module.exports lines. Remove the first one and keep the second.

// Count occurrences
const count = (auth.match(/module\.exports = router;/g) || []).length;
console.log('Found', count, 'module.exports lines');

if (count > 1) {
  // Remove the FIRST occurrence, keep the last one
  auth = auth.replace('module.exports = router;', '// (moved to end)');
  // Only replace the first one - the second stays
  console.log('  ✓ Removed duplicate module.exports');
}

// Also need to make sure requireAuth, getDb, saveDb, toStr are available
// Check if the invite section has access to these
if (!auth.includes("const { requireAuth, toStr } = require('../middleware')")) {
  // They might be declared differently - check what's at the top
  const hasRequireAuth = auth.includes('requireAuth');
  const hasGetDb = auth.includes('getDb');
  console.log('  requireAuth available:', hasRequireAuth);
  console.log('  getDb available:', hasGetDb);
}

fs.writeFileSync('server/routes/auth.js', auth, 'utf8');

// Verify
try { require('./server/routes/auth'); console.log('  ✓ auth.js compiles OK'); }
catch(e) { console.log('  ERROR:', e.message); }
