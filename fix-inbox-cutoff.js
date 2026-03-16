const fs = require('fs');
let gmail = fs.readFileSync('server/routes/gmail.js', 'utf8');

// Replace the cutoff logic to only apply for coordinators
gmail = gmail.replace(
  `    // Only show emails before the sync start date in personal inbox
    const syncState = getDb().prepare('SELECT sync_start_date FROM email_sync_state WHERE user_id=?').get(req.user.id);
    const cutoffDate = syncState?.sync_start_date || '2026/03/01';
    q = q ? q + ' before:' + cutoffDate : 'before:' + cutoffDate;`,
  `    // Only apply cutoff for coordinators — admin/supervisor see full inbox
    if (req.user.role === 'coordinator') {
      const syncState = getDb().prepare('SELECT sync_start_date FROM email_sync_state WHERE user_id=?').get(req.user.id);
      const cutoffDate = syncState?.sync_start_date || '2026/03/01';
      q = q ? q + ' before:' + cutoffDate : 'before:' + cutoffDate;
    }`
);

fs.writeFileSync('server/routes/gmail.js', gmail, 'utf8');

try { require('./server/routes/gmail'); console.log('✓ gmail.js compiles OK — admin/supervisor see full inbox'); }
catch(e) { console.log('ERROR:', e.message); }
