// fix-totp-window.js
const fs = require('fs');
const path = require('path');

const authPath = path.join(__dirname, 'server', 'routes', 'auth.js');
let auth = fs.readFileSync(authPath, 'utf8');

// Widen all TOTP windows from 3 to 5 (150 seconds of drift)
while (auth.includes('window: 3,')) {
  auth = auth.replace('window: 3,', 'window: 5,');
}
while (auth.includes('window: 2,')) {
  auth = auth.replace('window: 2,', 'window: 5,');
}
while (auth.includes('window: 1,')) {
  auth = auth.replace('window: 1,', 'window: 5,');
}

fs.writeFileSync(authPath, auth, 'utf8');
console.log('✓ TOTP window widened to 5 (150s drift allowed)');
console.log('Restart: npm run dev');
