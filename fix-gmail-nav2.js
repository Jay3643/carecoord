// fix-gmail-nav2.js
const fs = require('fs');
const path = require('path');

const appPath = path.join(__dirname, 'client', 'src', 'App.jsx');
let app = fs.readFileSync(appPath, 'utf8');

app = app.replace(
  "...(currentUser.role === 'admin' ? [{ key: 'admin', icon: 'settings', label: 'Admin' }] : []),",
  "{ key: 'gmail', icon: 'mail', label: 'Gmail' },\n            ...(currentUser.role === 'admin' ? [{ key: 'admin', icon: 'settings', label: 'Admin' }] : []),"
);

fs.writeFileSync(appPath, app, 'utf8');
console.log('✓ Added Gmail nav item');
