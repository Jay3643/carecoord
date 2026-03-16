// fix-gsuite-btn.js
const fs = require('fs');
const path = require('path');

// Fix App.jsx
const appPath = path.join(__dirname, 'client', 'src', 'App.jsx');
let app = fs.readFileSync(appPath, 'utf8');

if (!app.includes('GmailConnectButton')) {
  app = app.replace(
    "import PersonalInbox from './components/PersonalInbox';",
    "import PersonalInbox from './components/PersonalInbox';\nimport { GmailConnectButton } from './components/GmailPanel';"
  );
}

if (!app.includes('<GmailConnectButton')) {
  app = app.replace(
    "<div style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#ffffff' }}>{currentUser.name}</div>",
    "{!sidebarCollapsed && <GmailConnectButton showToast={showToast} />}\n                <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#ffffff' }}>{currentUser.name}</div>"
  );
}

fs.writeFileSync(appPath, app, 'utf8');
console.log('  ✓ App.jsx — added connect button');

// Fix GmailPanel.jsx — change all Gmail references to Google Workspace
const panelPath = path.join(__dirname, 'client', 'src', 'components', 'GmailPanel.jsx');
let panel = fs.readFileSync(panelPath, 'utf8');

panel = panel.replace("Connect Gmail Account", "Connect Google Workspace");
panel = panel.replace("'Gmail Connected'", "'Google Workspace Connected'");
panel = panel.replace("Gmail Connected", "Google Workspace");
panel = panel.replace("'Gmail not connected'", "'Google Workspace not connected'");
panel = panel.replace("'Gmail connected! Syncing emails...'", "'Google Workspace connected! Syncing emails...'");
panel = panel.replace("'Gmail disconnected'", "'Google Workspace disconnected'");
panel = panel.replace("Disconnect your Gmail?", "Disconnect Google Workspace?");
panel = panel.replace("<Icon name=\"mail\" size={12} /> Connect Gmail", "<Icon name=\"mail\" size={12} /> Connect Google Workspace");

fs.writeFileSync(panelPath, panel, 'utf8');
console.log('  ✓ GmailPanel.jsx — rebranded to Google Workspace');
console.log('\\nRefresh browser.');
