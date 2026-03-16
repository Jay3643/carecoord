// fix-logout-icon.js
const fs = require('fs');
const path = require('path');
const appPath = path.join(__dirname, 'client', 'src', 'App.jsx');
let app = fs.readFileSync(appPath, 'utf8');
app = app.replace(
  '<Icon name="x" size={12} />\n                Log out',
  'Log out'
);
fs.writeFileSync(appPath, app, 'utf8');
console.log('✓ Removed x icon from logout button. Restart: Ctrl+C then npm run dev');
