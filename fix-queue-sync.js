const fs = require('fs');
let f = fs.readFileSync('client/src/components/QueueScreen.jsx', 'utf8');

f = f.replace(
  "      // sync handled by background polling",
  "      if (mode === 'region') await api.gmailAutoSync().catch(() => {});"
);

fs.writeFileSync('client/src/components/QueueScreen.jsx', f, 'utf8');

// Verify
const check = fs.readFileSync('client/src/components/QueueScreen.jsx', 'utf8');
console.log(check.includes('gmailAutoSync') ? '✓ Auto-sync added to QueueScreen' : 'FAILED');
