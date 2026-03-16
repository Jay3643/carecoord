// fix-remove-gmail-panel.js
const fs = require('fs');
const path = require('path');

const appPath = path.join(__dirname, 'client', 'src', 'App.jsx');
let app = fs.readFileSync(appPath, 'utf8');

// Remove import
app = app.replace("import GmailPanel from './components/GmailPanel';\n", "");

// Remove nav item
app = app.replace("            { key: 'gmail', icon: 'mail', label: 'Gmail' },\n", "");

// Remove screen render
app = app.replace(/\s*\{screen === 'gmail' && \(\s*<GmailPanel[^/]*\/>\s*\)\}/, "");

fs.writeFileSync(appPath, app, 'utf8');
console.log('✓ Removed old Gmail panel, nav item, and import');
