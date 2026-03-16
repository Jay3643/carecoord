const fs = require('fs');

// Fix gmail.js
let gmail = fs.readFileSync('server/routes/gmail.js', 'utf8');
gmail = gmail.replaceAll('process.env.GOOGLE_CLIENT_ID', 'process.env.GMAIL_CLIENT_ID');
gmail = gmail.replaceAll('process.env.GOOGLE_CLIENT_SECRET', 'process.env.GMAIL_CLIENT_SECRET');
gmail = gmail.replaceAll('process.env.GOOGLE_REDIRECT_URI', 'process.env.GMAIL_REDIRECT_URI');
fs.writeFileSync('server/routes/gmail.js', gmail, 'utf8');
console.log('  ✓ gmail.js');

// Fix tickets.js (reply send)
let tickets = fs.readFileSync('server/routes/tickets.js', 'utf8');
tickets = tickets.replaceAll('process.env.GOOGLE_CLIENT_ID', 'process.env.GMAIL_CLIENT_ID');
tickets = tickets.replaceAll('process.env.GOOGLE_CLIENT_SECRET', 'process.env.GMAIL_CLIENT_SECRET');
tickets = tickets.replaceAll('process.env.GOOGLE_REDIRECT_URI', 'process.env.GMAIL_REDIRECT_URI');
fs.writeFileSync('server/routes/tickets.js', tickets, 'utf8');
console.log('  ✓ tickets.js');

console.log('\n✅ Fixed. Now reconnect Google Workspace in the browser.');
console.log('The old token was from bad credentials so you need to re-auth.');
