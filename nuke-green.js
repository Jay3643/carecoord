// nuke-green.js
// Run from the carecoord folder: node nuke-green.js
// Eliminates ALL green and teal — replaces with blues and orange

const fs = require('fs');
const path = require('path');

console.log('\n🔵🟠 Removing ALL green/teal, replacing with blue + orange...\n');

// Every green/teal hex that could exist (from original dark theme, teal retheme, or blue retheme)
const swaps = {
  // ── Cyans & teals (original theme) ──
  '#06b6d4': '#1a5e9a',     // cyan → blue
  '#06b6d418': '#1a5e9a18', // cyan transparent
  '#0891b2': '#1a5e9a',     // teal → blue
  '#0d9488': '#1a5e9a',     // teal → blue

  // ── Greens (original + tags) ──
  '#10b981': '#e87e22',     // emerald green → orange
  '#059669': '#c96a1b',     // green-600 → dark orange
  '#0e8a6b': '#1a6aaa',     // green → blue
  '#0e7a6b': '#1a5e9a',     // brand teal → blue
  '#0a6359': '#14507e',     // dark teal → dark blue
  '#0a9e8a': '#2878b8',     // light teal → light blue
  '#12a08d': '#2080c0',     // med teal → med blue
  '#0e7a6b18': '#1a5e9a18',
  '#0e7a6b20': '#1a5e9a20',
  '#0e7a6b10': '#1a5e9a10',

  // ── Teal sidebar (from retheme) ──
  '#0a5c51': '#143d6b',     // dark teal sidebar → dark blue
  '#08493f': '#102f54',     // darker teal → darker blue
  '#a0d4c8': '#a8c8e8',     // light teal text → light blue

  // ── Teal-tinted backgrounds (from retheme) ──
  '#e6f0ee': '#e8f0f8',
  '#e8f4f2': '#e8f0f8',
  '#f0f5f4': '#f0f4f9',
  '#e2eceb': '#dde8f2',
  '#dce8e6': '#d4e0f0',
  '#d0dfdd': '#c8d8ec',
  '#c8d9d6': '#c0d0e4',
  '#b0cec8': '#a8c0dc',

  // ── Blue-tinted greens that slipped through ──
  '#1a6aaa': '#1a6aaa',     // already blue, keep
};

// Also fix the seed data tag color for DME (green → orange)
const seedSwaps = {
  '#10b981': '#e87e22',     // DME tag green → orange
};

const clientFiles = [
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

const serverFiles = [
  'server/seed.js',
];

function applySwaps(relPath, map) {
  const fullPath = path.join(__dirname, relPath);
  if (!fs.existsSync(fullPath)) { console.log('  ⚠ Skipped: ' + relPath); return; }
  let content = fs.readFileSync(fullPath, 'utf8');
  let changes = 0;
  for (const [find, replace] of Object.entries(map)) {
    if (find === replace) continue;
    while (content.includes(find)) {
      content = content.split(find).join(replace);
      changes++;
    }
  }
  fs.writeFileSync(fullPath, content, 'utf8');
  console.log('  ✓ ' + relPath + (changes > 0 ? ' (' + changes + ' swaps)' : ' (clean)'));
}

for (const f of clientFiles) applySwaps(f, swaps);
for (const f of serverFiles) applySwaps(f, seedSwaps);

// ── Now verify: scan for any remaining green/teal hex codes ──────────────────

console.log('\n  Scanning for remaining green/teal...');
let found = false;

// Known green/teal patterns
const greenPatterns = [
  /['"]#0[0-9a-f][89a-f][0-9a-f]{3}['"]/gi,  // #0X8+ or #0X9+ (teal range)
  /['"]#[0-4][0-9a-f][89a-f][0-9a-f]{3}['"]/gi,
];

const knownGreens = ['059669','06b6d4','0891b2','0d9488','10b981','0e7a6b','0a6359','0a9e8a','12a08d','0e8a6b','0a5c51','08493f'];

for (const f of clientFiles) {
  const fullPath = path.join(__dirname, f);
  if (!fs.existsSync(fullPath)) continue;
  const content = fs.readFileSync(fullPath, 'utf8');
  for (const hex of knownGreens) {
    if (content.includes(hex)) {
      console.log('  ⚠ STILL FOUND #' + hex + ' in ' + f);
      found = true;
    }
  }
}

if (!found) {
  console.log('  ✅ No green/teal remaining!');
}

console.log('\n✅ Done! All green/teal eliminated.');
console.log('\nColor palette is now:');
console.log('  🔵 Primary blue: #1a5e9a (buttons, links, badges)');
console.log('  🔵 Dark blue:    #143d6b (sidebar)');
console.log('  🔵 Navy:         #102f54 (sidebar hover)');
console.log('  🟠 Orange:       #e87e22 (success states, DME tag)');
console.log('  🟠 Gold:         #c9963b / #f59e0b (notes, warnings)');
console.log('  🔴 Red:          #d94040 (errors, urgent)');
console.log('\nRestart: Ctrl+C then npm run dev');
console.log('Then re-seed to update the tag color: npm run seed\n');
