// fix-header2.js
const fs = require('fs');
const path = require('path');

const appPath = path.join(__dirname, 'client', 'src', 'App.jsx');
let app = fs.readFileSync(appPath, 'utf8');
const lines = app.split('\n');

// Show me all lines around the header area (lines with minHeight 64 or Seniority or gradient+borderRadius)
console.log('=== Header area lines ===');
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  if (l.includes('minHeight: 64') || (l.includes('Seniority') && !l.includes('//')) || l.includes('linear-gradient') || (l.includes('borderRadius: 8') && i < 140)) {
    console.log('Line ' + (i+1) + ': ' + l.trim());
  }
}
