// fix-nav-colors.js
const fs = require('fs');
const path = require('path');

const appPath = path.join(__dirname, 'client', 'src', 'App.jsx');
let app = fs.readFileSync(appPath, 'utf8');

app = app.replace(
  "color: screen === item.key ? '#ffffff' : '#d0e4f4',",
  "color: screen === item.key ? '#ffffff' : '#143d6b',"
);

fs.writeFileSync(appPath, app, 'utf8');
console.log('✓ Sidebar: dark blue (#143d6b) when unselected, white when selected');
