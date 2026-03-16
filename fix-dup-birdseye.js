const fs = require('fs');
let f = fs.readFileSync('client/src/components/Dashboard.jsx', 'utf8');

// Find both occurrences
const first = f.indexOf('function BirdsEyeView');
const second = f.indexOf('function BirdsEyeView', first + 1);

if (second > -1) {
  // Find the end of the second BirdsEyeView function (ends with \n}\n)
  let depth = 0, started = false, end = second;
  for (let i = second; i < f.length; i++) {
    if (f[i] === '{') { depth++; started = true; }
    if (f[i] === '}') { depth--; }
    if (started && depth === 0) { end = i + 1; break; }
  }
  f = f.substring(0, second) + f.substring(end);
  console.log('✓ Removed duplicate BirdsEyeView');
} else {
  console.log('No duplicate found');
}

fs.writeFileSync('client/src/components/Dashboard.jsx', f, 'utf8');
