// retheme-seniority.js
// Run from the carecoord folder: node retheme-seniority.js
// Changes the entire color scheme to match Seniority Healthcare branding

const fs = require('fs');
const path = require('path');

console.log('\n🎨 Applying Seniority Healthcare theme...\n');

// Seniority brand colors (from website):
// Primary teal: #0e7a6b  (headers, buttons, accents)
// Dark teal: #0a5c51     (hover states, sidebar)
// Light teal: #e6f5f2    (backgrounds, highlights)
// Navy text: #1e3a4f     (primary text)
// Warm white: #f8fafa    (page background)
// White: #ffffff          (cards)
// Accent gold: #c9963b   (warm accent for notes/badges)
// Muted gray: #6b8299    (secondary text)
// Border: #d4e0e6

function replaceAll(str, map) {
  for (const [find, replace] of Object.entries(map)) {
    // Use split/join for literal replacement (no regex needed)
    while (str.includes(find)) {
      str = str.split(find).join(replace);
    }
  }
  return str;
}

function patchFile(relPath, colorMap) {
  const fullPath = path.join(__dirname, relPath);
  if (!fs.existsSync(fullPath)) { console.log('  ⚠ Skipped (not found): ' + relPath); return; }
  let content = fs.readFileSync(fullPath, 'utf8');
  content = replaceAll(content, colorMap);
  fs.writeFileSync(fullPath, content, 'utf8');
  console.log('  ✓ ' + relPath);
}

// ── Color mapping: old dark theme → new Seniority light theme ────────────────

const coreColors = {
  // Backgrounds
  '#0f1117': '#f4f7f8',    // page bg → warm light gray
  '#13151f': '#ffffff',    // panel/header bg → white
  '#161822': '#f0f5f4',    // sidebar/card bg → light teal-gray
  '#1e2030': '#e2eceb',    // input/secondary bg → light teal
  '#1a1c2a': '#dce8e6',    // hover states → slightly darker teal
  '#252840': '#d0dfdd',    // active/selected bg
  '#1a1a3e': '#e8f4f2',    // outbound msg bubble → light teal
  '#2a1f0d': '#fef8ec',    // note bg → warm cream
  '#3d2d12': '#f0ddb0',    // note border → gold border

  // Borders
  '#2a2d3e': '#c8d9d6',    // primary border → soft teal border
  '#2a2d5e': '#b0cec8',    // outbound msg border
  '#334155': '#c8d9d6',    // toast border

  // Primary accent (purple → teal)
  '#6366f1': '#0e7a6b',    // buttons, badges, active states → brand teal
  '#4f46e5': '#0a6359',    // gradient end / hover
  '#6366f118': '#0e7a6b18', // transparent teal
  '#6366f120': '#0e7a6b20', // transparent teal (slightly more opaque)
  '#6366f110': '#0e7a6b10',

  // Cyan accent → brand teal
  '#06b6d4': '#0e7a6b',    // inbound badge → teal
  '#06b6d418': '#0e7a6b18',

  // Text colors
  '#e2e8f0': '#1e3a4f',    // primary text → dark navy
  '#cbd5e1': '#2d4a5e',    // body text in messages
  '#94a3b8': '#5a7a8a',    // secondary text
  '#64748b': '#6b8299',    // muted text
  '#475569': '#8a9fb0',    // placeholder text
  '#fcd34d': '#7a5c10',    // note text → dark gold

  // Amber/warning
  '#f59e0b': '#c9963b',    // note accent → warm gold
  '#92400e': '#8a6d2e',    // note meta text → dark gold

  // Red / danger
  '#ef4444': '#d94040',    // red stays similar
  '#ef444420': '#d9404020',
  '#ef444440': '#d9404040',

  // Green / success
  '#10b981': '#0e8a6b',    // green → teal-green

  // Blue
  '#3b82f6': '#0e7a6b',    // blue → brand teal

  // Tags (keep these vibrant but slightly muted for light bg)
  // (tag colors from seed data are fine as-is)
};

// ── Patch all component files ────────────────────────────────────────────────

const files = [
  'client/src/App.jsx',
  'client/src/components/LoginScreen.jsx',
  'client/src/components/QueueScreen.jsx',
  'client/src/components/TicketDetail.jsx',
  'client/src/components/Dashboard.jsx',
  'client/src/components/AuditLog.jsx',
  'client/src/components/ComposeModal.jsx',
  'client/src/components/AdminPanel.jsx',
  'client/src/components/ui.jsx',
];

for (const f of files) {
  patchFile(f, coreColors);
}

// ── Fix specific elements that need manual tweaks ────────────────────────────

// Fix the gradient on the sidebar logo mark
const appPath = path.join(__dirname, 'client', 'src', 'App.jsx');
let appJsx = fs.readFileSync(appPath, 'utf8');

// Fix gradient
appJsx = appJsx.replace(
  "linear-gradient(135deg, #0e7a6b, #0e7a6b)",
  "linear-gradient(135deg, #0e7a6b, #0a9e8a)"
);

// Make sidebar slightly different from white content area
// Sidebar should be the darker teal-gray
appJsx = appJsx.replace(
  /background: '#f0f5f4', borderRight: '1px solid #c8d9d6'/g,
  "background: '#0a5c51', borderRight: '1px solid #08493f'"
);

// Make sidebar text light on dark teal sidebar
// We need to fix the sidebar specifically - the sidebar should have light text on dark bg
// Let's do targeted replacements for sidebar elements

// Replace the sidebar border-bottom
appJsx = appJsx.replace(
  "borderBottom: '1px solid #c8d9d6', display: 'flex', alignItems: 'center', gap: 10, minHeight: 64",
  "borderBottom: '1px solid #08493f', display: 'flex', alignItems: 'center', gap: 10, minHeight: 64"
);

// Fix CareCoord title in sidebar to be white
appJsx = appJsx.replace(
  "fontWeight: 700, fontSize: 14, letterSpacing: -0.3, whiteSpace: 'nowrap' }}>CareCoord",
  "fontWeight: 700, fontSize: 14, letterSpacing: -0.3, whiteSpace: 'nowrap', color: '#ffffff' }}>Seniority"
);

// Fix sidebar collapse button color
appJsx = appJsx.replace(
  /color: '#6b8299', cursor: 'pointer', padding: 4 }}>\s*<Icon name=\{sidebarCollapsed/,
  "color: '#a0d4c8', cursor: 'pointer', padding: 4 }}>\n            <Icon name={sidebarCollapsed"
);

// Fix sidebar nav buttons - they need light colors on dark bg
appJsx = appJsx.replace(
  "background: (screen === item.key || (screen === 'ticketDetail' && item.key === 'regionQueue')) ? '#e2eceb' : 'transparent',",
  "background: (screen === item.key || (screen === 'ticketDetail' && item.key === 'regionQueue')) ? '#08493f' : 'transparent',"
);
appJsx = appJsx.replace(
  "color: screen === item.key ? '#1e3a4f' : '#6b8299',",
  "color: screen === item.key ? '#ffffff' : '#a0d4c8',"
);

// Fix sidebar nav icon size line
appJsx = appJsx.replace(
  "cursor: 'pointer', fontSize: 13, fontWeight: 500, width: '100%', textAlign: 'left',",
  "cursor: 'pointer', fontSize: 13, fontWeight: 500, width: '100%', textAlign: 'left', color: 'inherit',"
);

// Fix sidebar badge colors to be visible on dark
appJsx = appJsx.replace(
  "background: item.badgeColor, color: '#fff'",
  "background: '#d94040', color: '#fff'"
);

// Fix New Message button in sidebar — make it lighter on dark sidebar
appJsx = appJsx.replace(
  "background: 'linear-gradient(135deg, #0e7a6b, #0a6359)',",
  "background: 'linear-gradient(135deg, #12a08d, #0e7a6b)',"
);
appJsx = appJsx.replace(
  "boxShadow: '0 2px 8px rgba(99,102,241,0.3)',",
  "boxShadow: '0 2px 8px rgba(14,122,107,0.4)',"
);

// Fix sidebar bottom user area
appJsx = appJsx.replace(
  "borderTop: '1px solid #c8d9d6' }}>",
  "borderTop: '1px solid #08493f' }}>"
);

// Fix user name in sidebar
appJsx = appJsx.replace(
  "fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentUser.name}",
  "fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#ffffff' }}>{currentUser.name}"
);

appJsx = appJsx.replace(
  "fontSize: 10, color: '#6b8299', textTransform: 'capitalize' }}>{currentUser.role}",
  "fontSize: 10, color: '#a0d4c8', textTransform: 'capitalize' }}>{currentUser.role}"
);

// Fix logout button on dark sidebar
appJsx = appJsx.replace(
  "background: '#e2eceb', border: '1px solid #c8d9d6', borderRadius: 6, color: '#5a7a8a'",
  "background: '#08493f', border: '1px solid #0a5c51', borderRadius: 6, color: '#a0d4c8'"
);

appJsx = appJsx.replace(
  "e.currentTarget.style.background = '#e2eceb'; e.currentTarget.style.color = '#5a7a8a'",
  "e.currentTarget.style.background = '#08493f'; e.currentTarget.style.color = '#a0d4c8'"
);

appJsx = appJsx.replace(
  "e.currentTarget.style.background = '#c8d9d6'; e.currentTarget.style.color = '#d94040'",
  "e.currentTarget.style.background = '#0e7a6b'; e.currentTarget.style.color = '#ffffff'"
);

// Fix toast styling for light theme
appJsx = appJsx.replace(
  "background: '#c8d9d6', color: '#1e3a4f'",
  "background: '#1e3a4f', color: '#ffffff'"
);

fs.writeFileSync(appPath, appJsx, 'utf8');
console.log('  ✓ App.jsx — sidebar dark teal + branding fixes');

// ── Fix Login Screen specifically ────────────────────────────────────────────

const loginPath = path.join(__dirname, 'client', 'src', 'components', 'LoginScreen.jsx');
if (fs.existsSync(loginPath)) {
  let login = fs.readFileSync(loginPath, 'utf8');

  // Make login screen background a subtle gradient
  login = login.replace(
    "background: '#f4f7f8'",
    "background: 'linear-gradient(135deg, #f4f7f8, #e6f0ee)'"
  );

  fs.writeFileSync(loginPath, login, 'utf8');
  console.log('  ✓ LoginScreen.jsx — background gradient');
}

// ── Fix the index.html to update the font import if needed ───────────────────

const htmlPath = path.join(__dirname, 'client', 'index.html');
if (fs.existsSync(htmlPath)) {
  let html = fs.readFileSync(htmlPath, 'utf8');
  if (!html.includes('background-color')) {
    html = html.replace('</head>', '  <style>body { background-color: #f4f7f8; }</style>\n  </head>');
  } else {
    html = html.replace(/background-color:\s*#[0-9a-fA-F]+/, 'background-color: #f4f7f8');
  }
  fs.writeFileSync(htmlPath, html, 'utf8');
  console.log('  ✓ index.html — body background');
}

console.log('\n✅ Seniority Healthcare theme applied!');
console.log('\nColor scheme:');
console.log('  • Sidebar: Dark teal (#0a5c51)');
console.log('  • Brand: Teal green (#0e7a6b)');
console.log('  • Background: Light warm gray (#f4f7f8)');
console.log('  • Cards/panels: White (#ffffff)');
console.log('  • Text: Navy (#1e3a4f)');
console.log('  • Notes: Warm gold (#c9963b)');
console.log('  • App name: "Seniority"');
console.log('\nRestart: Ctrl+C then npm run dev\n');
