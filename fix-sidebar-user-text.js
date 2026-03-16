// fix-sidebar-user-text.js
const fs = require('fs');
const path = require('path');

const appPath = path.join(__dirname, 'client', 'src', 'App.jsx');
let app = fs.readFileSync(appPath, 'utf8');

// Fix username - make white
app = app.replace(
  "fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#ffffff'",
  "fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#ffffff'"
);

// Fix role text - make it brighter
app = app.replace(
  "fontSize: 10, color: '#a0d4c8', textTransform: 'capitalize'",
  "fontSize: 10, color: '#ffffff', textTransform: 'capitalize'"
);

// Fix logout button text
app = app.replace(
  "background: '#08493f', border: '1px solid #0a5c51', borderRadius: 6, color: '#a0d4c8'",
  "background: '#102f54', border: '1px solid #1a5e9a', borderRadius: 6, color: '#ffffff'"
);

// Fix logout hover states
app = app.replace(
  "e.currentTarget.style.background = '#08493f'; e.currentTarget.style.color = '#a0d4c8'",
  "e.currentTarget.style.background = '#102f54'; e.currentTarget.style.color = '#ffffff'"
);

app = app.replace(
  "e.currentTarget.style.background = '#0e7a6b'; e.currentTarget.style.color = '#ffffff'",
  "e.currentTarget.style.background = '#1a5e9a'; e.currentTarget.style.color = '#ffffff'"
);

fs.writeFileSync(appPath, app, 'utf8');
console.log('✓ Sidebar user area text brightened');
