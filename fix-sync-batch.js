const fs = require('fs');
let gmail = fs.readFileSync('server/routes/gmail.js', 'utf8');

// Increase maxResults from 20 to 100
gmail = gmail.replace(
  "const list = await gmail.users.messages.list({userId:'me', q:'in:inbox after:'+afterDate, maxResults:20});",
  "const list = await gmail.users.messages.list({userId:'me', q:'in:inbox after:'+afterDate, maxResults:100});"
);

fs.writeFileSync('server/routes/gmail.js', gmail, 'utf8');
console.log('✓ Sync now fetches up to 100 emails per run');
console.log('Run sync multiple times from browser console to catch up:');
console.log("  fetch('/api/gmail/sync',{method:'POST',credentials:'include'}).then(r=>r.json()).then(console.log)");
