// show-nav.js
const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, 'client', 'src', 'App.jsx'), 'utf8');

// Find nav items
const lines = app.split('\n');
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('key:') && (lines[i].includes('Queue') || lines[i].includes('dashboard') || lines[i].includes('gmail') || lines[i].includes('audit') || lines[i].includes('admin'))) {
    console.log('Line ' + (i+1) + ': ' + lines[i].trim());
  }
}

console.log('\n--- Imports ---');
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('import') && lines[i].includes('from')) {
    console.log('Line ' + (i+1) + ': ' + lines[i].trim());
  }
}

console.log('\n--- Screen renders ---');
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('screen ===')) {
    console.log('Line ' + (i+1) + ': ' + lines[i].trim());
  }
}

console.log('\nHas GmailPanel:', app.includes('GmailPanel'));
console.log('Has gmail key:', app.includes("'gmail'"));
