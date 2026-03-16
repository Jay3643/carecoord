// swap-to-blue.js
// Run from the carecoord folder: node swap-to-blue.js
// Swaps all teal/green to Seniority blue

const fs = require('fs');
const path = require('path');

console.log('\n🔵 Swapping greens to Seniority blues...\n');

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
  'client/index.html',
];

// Seniority blue palette:
// Primary: #1a5e9a  (buttons, links, active)
// Dark:    #143d6b  (sidebar bg)
// Darker:  #102f54  (sidebar hover/active)
// Light:   #a8c8e8  (sidebar muted text)
// Lighter: #e8f0f8  (msg bubble, highlights)
// BG tint: #f2f6fa  (page background)

const swaps = {
  // Primary teal → blue
  '#0e7a6b': '#1a5e9a',
  '#0a6359': '#14507e',
  '#0e8a6b': '#1a6aaa',
  '#0a9e8a': '#2878b8',
  '#12a08d': '#2080c0',

  // Sidebar dark teal → dark blue
  '#0a5c51': '#143d6b',
  '#08493f': '#102f54',

  // Sidebar light text teal → light blue
  '#a0d4c8': '#a8c8e8',

  // Light teal backgrounds → light blue
  '#e6f0ee': '#e8f0f8',
  '#e8f4f2': '#e8f0f8',
  '#f0f5f4': '#f0f4f9',
  '#e2eceb': '#dde8f2',
  '#dce8e6': '#d4e0f0',
  '#d0dfdd': '#c8d8ec',
  '#c8d9d6': '#c0d0e4',
  '#b0cec8': '#a8c0dc',

  // Background page tint
  '#f4f7f8': '#f2f6fa',

  // Gradient on login
  '#e6f0ee)': '#e0ecf6)',
};

for (const f of files) {
  const fullPath = path.join(__dirname, f);
  if (!fs.existsSync(fullPath)) { console.log('  ⚠ Skipped: ' + f); continue; }
  let content = fs.readFileSync(fullPath, 'utf8');
  for (const [find, replace] of Object.entries(swaps)) {
    while (content.includes(find)) {
      content = content.split(find).join(replace);
    }
  }
  fs.writeFileSync(fullPath, content, 'utf8');
  console.log('  ✓ ' + f);
}

console.log('\n✅ All greens swapped to Seniority blues!');
console.log('\nRestart: Ctrl+C then npm run dev\n');
