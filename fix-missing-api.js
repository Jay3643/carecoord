// fix-missing-api.js
const fs = require('fs');
const path = require('path');
const glob = require('path');

// Scan all jsx files for api.xxx calls
const srcDir = path.join(__dirname, 'client', 'src');
function scanDir(dir) {
  let calls = new Set();
  const items = fs.readdirSync(dir);
  for (const item of items) {
    const full = path.join(dir, item);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      scanDir(full).forEach(c => calls.add(c));
    } else if (item.endsWith('.jsx') || item.endsWith('.js')) {
      const content = fs.readFileSync(full, 'utf8');
      const matches = content.matchAll(/api\.(\w+)/g);
      for (const m of matches) calls.add(m[1]);
    }
  }
  return calls;
}

const usedCalls = scanDir(srcDir);

// Read current api.js and find defined methods
const apiContent = fs.readFileSync(path.join(__dirname, 'client', 'src', 'api.js'), 'utf8');
const defined = new Set();
const defMatches = apiContent.matchAll(/(\w+):\s*\(/g);
for (const m of defMatches) defined.add(m[1]);

// Find missing
const missing = [];
for (const call of usedCalls) {
  if (!defined.has(call)) missing.push(call);
}

console.log('Used API calls:', [...usedCalls].sort().join(', '));
console.log('\nDefined methods:', [...defined].sort().join(', '));
console.log('\nMISSING:', missing.length ? missing.join(', ') : 'None!');

// Add missing methods
if (missing.length > 0) {
  let api = fs.readFileSync(path.join(__dirname, 'client', 'src', 'api.js'), 'utf8');
  
  const stubs = missing.map(m => {
    // Guess reasonable endpoints
    if (m === 'getCloseReasons') return "  getCloseReasons: () => request('/close-reasons')";
    if (m === 'getTags') return "  getTags: () => request('/tags')";
    if (m === 'getCategories') return "  getCategories: () => request('/categories')";
    if (m === 'getPriorities') return "  getPriorities: () => request('/priorities')";
    return "  " + m + ": () => request('/" + m.replace(/^get/, '').toLowerCase() + "')";
  }).join(',\n');

  api = api.replace(
    '  // Google Workspace',
    '  // Auto-added\n' + stubs + ',\n\n  // Google Workspace'
  );

  fs.writeFileSync(path.join(__dirname, 'client', 'src', 'api.js'), api, 'utf8');
  console.log('\n✓ Added ' + missing.length + ' missing methods to api.js');
}
