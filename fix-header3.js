// fix-header3.js
const fs = require('fs');
const path = require('path');

const appPath = path.join(__dirname, 'client', 'src', 'App.jsx');
let app = fs.readFileSync(appPath, 'utf8');

// Add dark blue background to header
app = app.replace(
  "borderBottom: '1px solid #dde8f2', display: 'flex', alignItems: 'center', gap: 10, minHeight: 64",
  "borderBottom: '1px solid #102f54', background: '#143d6b', display: 'flex', alignItems: 'center', gap: 10, minHeight: 64"
);

// Remove the gradient icon square (line 119-120)
app = app.replace(
  "<div style={{ width: 28, height: 28, borderRadius: 6, background: 'linear-gradient(135deg, #1a5e9a, #2878b8)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>",
  "<!-- removed -->"
);

// Remove the Icon inside it and closing div
// Find the pattern: <!-- removed -->\n...Icon.../>\n...</div>
app = app.replace(
  /<!-- removed -->\s*<Icon[^/]*\/>\s*<\/div>/,
  ""
);

fs.writeFileSync(appPath, app, 'utf8');
console.log('✓ Header: dark blue background, logo icon removed');
