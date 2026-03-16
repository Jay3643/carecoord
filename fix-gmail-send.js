const fs = require('fs');
let tickets = fs.readFileSync('server/routes/tickets.js', 'utf8');

// Fix: use the Gmail account email as From, not the region alias
tickets = tickets.replace(
  "const emailLines = [\n        'From: ' + fromAddr,",
  "const senderEmail = tokenRow.email || fromAddr;\n      const emailLines = [\n        'From: ' + senderEmail,"
);

// Fix: the \r\n was being escaped wrong
tickets = tickets.replace(
  "const raw = Buffer.from(emailLines.join('\\\\r\\\\n')).toString('base64url');",
  "const raw = Buffer.from(emailLines.join('\\r\\n')).toString('base64url');"
);

// Also fix: if the escape is different
tickets = tickets.replace(
  "const raw = Buffer.from(emailLines.join('\\r\\n')).toString('base64url');",
  "const raw = Buffer.from(emailLines.join(String.fromCharCode(13,10))).toString('base64url');"
);

fs.writeFileSync('server/routes/tickets.js', tickets, 'utf8');
console.log('✓ Fixed Gmail send: uses authenticated email, proper line endings');
console.log('Try sending a reply again.');
