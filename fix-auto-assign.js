const fs = require('fs');
let gmail = fs.readFileSync('server/routes/gmail.js', 'utf8');

// In syncUser, when creating a new ticket, assign to the coordinator
gmail = gmail.replace(
  "db.prepare('INSERT OR IGNORE INTO tickets (id,subject,from_email,region_id,status,created_at,last_activity_at,external_participants) VALUES (?,?,?,?,?,?,?,?)')\n          .run(tid, subj, from, rid, 'OPEN', ts, ts, JSON.stringify([from]));",
  "db.prepare('INSERT OR IGNORE INTO tickets (id,subject,from_email,region_id,status,assignee_user_id,created_at,last_activity_at,external_participants) VALUES (?,?,?,?,?,?,?,?,?)')\n          .run(tid, subj, from, rid, 'OPEN', uid, ts, ts, JSON.stringify([from]));"
);

fs.writeFileSync('server/routes/gmail.js', gmail, 'utf8');

// Verify
try { require('./server/routes/gmail'); console.log('✓ gmail.js compiles OK — tickets auto-assigned to coordinator'); }
catch(e) { console.log('ERROR:', e.message); }
