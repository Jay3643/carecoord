// fix-totp.js
const fs = require('fs');
const path = require('path');

const authPath = path.join(__dirname, 'server', 'routes', 'auth.js');
let auth = fs.readFileSync(authPath, 'utf8');

// Widen the TOTP window from 1 to 2 (allows 60 seconds of drift)
while (auth.includes('window: 1,')) {
  auth = auth.replace('window: 1,', 'window: 2,');
}

fs.writeFileSync(authPath, auth, 'utf8');
console.log('✓ Widened TOTP verification window to 2 (60s drift allowed)');
console.log('Restart: npm run dev');
