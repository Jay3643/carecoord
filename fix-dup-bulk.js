const fs = require('fs');
let f = fs.readFileSync('client/src/components/PersonalInbox.jsx', 'utf8');

// Find the second occurrence of bulkPushToQueue and remove that entire block
const first = f.indexOf('const bulkPushToQueue');
const second = f.indexOf('const bulkPushToQueue', first + 1);

if (second > -1) {
  // Find the end of the second block (up to the next const or function)
  let end = second;
  let depth = 0;
  let foundBody = false;
  for (let i = second; i < f.length; i++) {
    if (f[i] === '{') { depth++; foundBody = true; }
    if (f[i] === '}') { depth--; }
    if (foundBody && depth === 0) {
      // Find the semicolon after
      end = f.indexOf(';', i) + 1;
      break;
    }
  }
  
  // Also remove bulkPullFromQueue if duplicated right after
  let blockEnd = end;
  const nextChunk = f.substring(end, end + 200);
  if (nextChunk.includes('const bulkPullFromQueue')) {
    let d2 = 0, fb2 = false;
    for (let i = end; i < f.length; i++) {
      if (f.substring(i).startsWith('const bulkPullFromQueue')) fb2 = false;
      if (f[i] === '{') { d2++; fb2 = true; }
      if (f[i] === '}') { d2--; }
      if (fb2 && d2 === 0) { blockEnd = f.indexOf(';', i) + 1; break; }
    }
  }
  
  f = f.substring(0, second) + f.substring(blockEnd);
  console.log('✓ Removed duplicate bulkPushToQueue block');
} else {
  console.log('No duplicate found');
}

fs.writeFileSync('client/src/components/PersonalInbox.jsx', f, 'utf8');
