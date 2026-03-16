const fs = require('fs');
let gmail = fs.readFileSync('server/routes/gmail.js', 'utf8');

// Find the second /personal route (the broken one) and remove it
// The first one is the good async one, the second is the leftover
const firstIdx = gmail.indexOf("router.get('/personal', requireAuth, async");
const secondIdx = gmail.indexOf("router.get('/personal', requireAuth, async", firstIdx + 1);

if (secondIdx === -1) {
  // Maybe the second one isn't async - search for any second /personal GET
  const altIdx = gmail.indexOf("router.get('/personal',", firstIdx + 100);
  if (altIdx > -1) {
    // Find the end of this route handler
    let depth = 0, end = altIdx;
    let foundStart = false;
    for (let i = altIdx; i < gmail.length; i++) {
      if (gmail[i] === '{') { depth++; foundStart = true; }
      if (gmail[i] === '}') { depth--; if (foundStart && depth === 0) { end = i; break; } }
    }
    // Remove from altIdx to end + 3 (for ");")
    const block = gmail.substring(altIdx, end + 3);
    gmail = gmail.replace(block, '');
    console.log('  Removed duplicate /personal route');
  }
} else {
  // Remove from secondIdx to its closing
  let depth = 0, end = secondIdx;
  let foundStart = false;
  for (let i = secondIdx; i < gmail.length; i++) {
    if (gmail[i] === '{') { depth++; foundStart = true; }
    if (gmail[i] === '}') { depth--; if (foundStart && depth === 0) { end = i; break; } }
  }
  const block = gmail.substring(secondIdx, end + 3);
  gmail = gmail.replace(block, '');
  console.log('  Removed duplicate async /personal route');
}

fs.writeFileSync('server/routes/gmail.js', gmail, 'utf8');

// Verify it compiles
try { require('./server/routes/gmail'); console.log('✓ gmail.js compiles OK'); } catch(e) { console.log('ERROR:', e.message); }
