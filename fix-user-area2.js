// fix-user-area2.js
const fs = require('fs');
const path = require('path');

const appPath = path.join(__dirname, 'client', 'src', 'App.jsx');
let app = fs.readFileSync(appPath, 'utf8');

// Fix the footer border to match dark sidebar
app = app.replace(
  "padding: sidebarCollapsed ? '12px 8px' : '12px 16px', borderTop: '1px solid #dde8f2'",
  "padding: sidebarCollapsed ? '12px 8px' : '12px 16px', borderTop: '1px solid #102f54', background: '#143d6b'"
);

fs.writeFileSync(appPath, app, 'utf8');
console.log('✓ User footer now has dark blue background — white text will be visible');
