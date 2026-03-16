// show-sidebar-user.js
const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, 'client', 'src', 'App.jsx'), 'utf8');
const lines = app.split('\n');

for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('currentUser.name') || lines[i].includes('currentUser.role') || lines[i].includes('Log out') || lines[i].includes('logout') || lines[i].includes('handleLogout')) {
    console.log('Line ' + (i+1) + ': ' + lines[i].trim());
  }
}
