const fs = require('fs');
let gmail = fs.readFileSync('server/routes/gmail.js', 'utf8');

// 1. Fix the hide step in syncUser — remove 'SENT' from removeLabelIds
// There are multiple places this appears
let count = 0;
while (gmail.includes("'INBOX', 'UNREAD', 'SENT', 'CATEGORY_PERSONAL'")) {
  gmail = gmail.replace(
    "'INBOX', 'UNREAD', 'SENT', 'CATEGORY_PERSONAL'",
    "'INBOX', 'UNREAD', 'CATEGORY_PERSONAL'"
  );
  count++;
}
console.log('  ✓ Removed SENT label from', count, 'locations');

// Also check for the version without single quotes
while (gmail.includes('"INBOX", "UNREAD", "SENT"')) {
  gmail = gmail.replace('"INBOX", "UNREAD", "SENT"', '"INBOX", "UNREAD"');
  count++;
}

// 2. Fix has_unread — all new synced tickets should be marked as unread
// In the INSERT for new tickets, make sure has_unread is 1
gmail = gmail.replace(
  "db.prepare('INSERT OR IGNORE INTO tickets (id,subject,from_email,region_id,status,assignee_user_id,created_at,last_activity_at,external_participants) VALUES (?,?,?,?,?,?,?,?,?)')",
  "db.prepare('INSERT OR IGNORE INTO tickets (id,subject,from_email,region_id,status,assignee_user_id,created_at,last_activity_at,external_participants,has_unread) VALUES (?,?,?,?,?,?,?,?,?,1)')"
);

// Also fix the old version without assignee_user_id in case it exists
gmail = gmail.replace(
  "db.prepare('INSERT OR IGNORE INTO tickets (id,subject,from_email,region_id,status,created_at,last_activity_at,external_participants) VALUES (?,?,?,?,?,?,?,?)')",
  "db.prepare('INSERT OR IGNORE INTO tickets (id,subject,from_email,region_id,status,created_at,last_activity_at,external_participants,has_unread) VALUES (?,?,?,?,?,?,?,?,1)')"
);

fs.writeFileSync('server/routes/gmail.js', gmail, 'utf8');

// Verify
try { require('./server/routes/gmail'); console.log('  ✓ gmail.js compiles OK'); }
catch(e) { console.log('  ERROR:', e.message); }

console.log('');
console.log('✓ Fixed:');
console.log('  1. Emails will now be properly hidden from Gmail (SENT label removed)');
console.log('  2. All new tickets marked has_unread=1 consistently');
console.log('');
console.log('Restart server and send a test email to verify.');
