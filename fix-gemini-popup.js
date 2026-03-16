const fs = require('fs');
let app = fs.readFileSync('client/src/App.jsx', 'utf8');

// Change the Gemini click handler to open a popup window instead of the side panel
app = app.replace(
  "if (item.key === 'gemini') { setShowGemini(prev => !prev); return; }",
  `if (item.key === 'gemini') {
                const w = 420, h = window.innerHeight - 40;
                const left = window.screenX + window.innerWidth - w - 10;
                const top = window.screenY + 20;
                window.open('https://gemini.google.com/app', 'gemini-ai', 'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top + ',menubar=no,toolbar=no,location=yes,status=no,scrollbars=yes,resizable=yes');
                return;
              }`
);

// Remove the iframe side panel since we're using popup now
app = app.replace(
  /\{\/\* Gemini Side Panel \*\/\}[\s\S]*?\{\/\* Toast \*\/\}/,
  '{/* Toast */}'
);

fs.writeFileSync('client/src/App.jsx', app, 'utf8');
console.log('✓ Gemini opens as popup window docked to the right of CareCoord');
console.log('Refresh browser.');
