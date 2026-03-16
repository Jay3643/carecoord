const fs = require('fs');
let gmail = fs.readFileSync('server/routes/gmail.js', 'utf8');

// Change the sync query from only inbox to inbox OR CareCoord/Archived label
gmail = gmail.replace(
  "const params = { userId: 'me', q: 'in:inbox -from:me after:' + startDate, maxResults: 500 };",
  "const params = { userId: 'me', q: '{in:inbox label:CareCoord-Archived} -from:me after:' + startDate, maxResults: 500 };"
);

fs.writeFileSync('server/routes/gmail.js', gmail, 'utf8');

const check = fs.readFileSync('server/routes/gmail.js', 'utf8');
console.log(check.includes('label:CareCoord-Archived') ? '✓ Sync now includes archived emails' : '✗ Failed');
console.log('Push and redeploy. Old emails will re-sync.');
console.log('After they sync, change the query back to inbox-only to avoid duplicates.');
