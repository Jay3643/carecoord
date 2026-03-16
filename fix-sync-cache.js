const fs = require('fs');

// 1. Add no-cache headers to auto-sync route in gmail.js
let gmail = fs.readFileSync('server/routes/gmail.js', 'utf8');
gmail = gmail.replace(
  "router.get('/auto-sync', requireAuth, async (req, res) => {",
  "router.get('/auto-sync', requireAuth, async (req, res) => {\n  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');\n  res.set('Pragma', 'no-cache');"
);
// Also add to POST /sync
gmail = gmail.replace(
  "router.post('/sync', requireAuth, async (req, res) => {",
  "router.post('/sync', requireAuth, async (req, res) => {\n  res.set('Cache-Control', 'no-store');"
);
fs.writeFileSync('server/routes/gmail.js', gmail, 'utf8');
console.log('  ✓ gmail.js — no-cache headers on sync routes');

// 2. Add cache-buster to api.js auto-sync call
let api = fs.readFileSync('client/src/api.js', 'utf8');
api = api.replace(
  "gmailAutoSync: () => request('/gmail/auto-sync'),",
  "gmailAutoSync: () => request('/gmail/auto-sync?t=' + Date.now()),"
);
fs.writeFileSync('client/src/api.js', api, 'utf8');
console.log('  ✓ api.js — cache-buster on auto-sync');

console.log('\nRestart server (Ctrl+C, npm run dev), hard refresh browser (Ctrl+Shift+R)');
console.log('Then send a NEW test email and click Region Queue.');
