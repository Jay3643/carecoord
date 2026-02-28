// fix-index.js
const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, 'server', 'index.js');
let indexJs = fs.readFileSync(indexPath, 'utf8');

// Remove the broken startup debug block entirely
indexJs = indexJs.replace(
  /\/\/ STARTUP DEBUG[\s\S]*?console\.log\(''\);\n\n/,
  ''
);

fs.writeFileSync(indexPath, indexJs, 'utf8');
console.log('✓ Removed broken startup debug from index.js');
