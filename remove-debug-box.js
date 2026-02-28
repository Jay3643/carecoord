// remove-debug-box.js
const fs = require('fs');
const path = require('path');

const loginPath = path.join(__dirname, 'client', 'src', 'components', 'LoginScreen.jsx');
let login = fs.readFileSync(loginPath, 'utf8');

// Remove the orange debug box entirely
login = login.replace(
  /\{serverCode && \(\s*<div style=\{\{ marginBottom: 16, padding: 12, background: '#fff3e0'[\s\S]*?<\/div>\s*\)\}/,
  ''
);

fs.writeFileSync(loginPath, login, 'utf8');
console.log('✓ Removed orange debug box from login screen');
