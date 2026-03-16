const fs = require('fs');
let gmail = fs.readFileSync('server/routes/gmail.js', 'utf8');

// Move ts definition BEFORE the thread matching check
gmail = gmail.replace(
  `if (personal) continue;
    // Check if this email belongs to an existing ticket thread`,
  `if (personal) continue;
    const ts = internalDate || Date.now();
    // Check if this email belongs to an existing ticket thread`
);

// Remove the duplicate ts definition from the later line
gmail = gmail.replace(
  "const rid=toStr(regions[0].region_id), ts=internalDate||Date.now();",
  "const rid=toStr(regions[0].region_id);"
);

fs.writeFileSync('server/routes/gmail.js', gmail, 'utf8');
console.log('✓ Fixed: ts is now defined before thread matching');
console.log('Server will auto-restart. Test by replying to an existing thread.');
