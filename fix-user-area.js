// fix-user-area.js
const fs = require('fs');
const path = require('path');

const appPath = path.join(__dirname, 'client', 'src', 'App.jsx');
let app = fs.readFileSync(appPath, 'utf8');

// Fix role text - currently #a8c8e8 (too light)
app = app.replace(
  "fontSize: 10, color: '#a8c8e8', textTransform: 'capitalize'",
  "fontSize: 10, color: '#ffffff', textTransform: 'capitalize'"
);

// Fix collapsed logout button - currently #6b8299
app = app.replace(
  "background: 'none', border: 'none', color: '#6b8299', cursor: 'pointer', padding: 4 }} title=\"Log out\"",
  "background: 'none', border: 'none', color: '#ffffff', cursor: 'pointer', padding: 4 }} title=\"Log out\""
);

fs.writeFileSync(appPath, app, 'utf8');
console.log('✓ User area: role text and logout button now white');
