const fs = require('fs');
let app = fs.readFileSync('client/src/App.jsx', 'utf8');

// Add Practice Fusion after Voice, before Gemini
app = app.replace(
  "{ key: 'gemini',",
  `{ key: 'ext_pf', label: 'Practice Fusion', url: 'https://www.practicefusion.com/login', gIcon: <svg width="18" height="18" viewBox="0 0 24 24"><rect width="24" height="24" rx="4" fill="#00a651"/><text x="12" y="17" textAnchor="middle" fontSize="14" fontWeight="700" fill="#fff" fontFamily="sans-serif">P</text></svg> },
            { key: 'gemini',`
);

fs.writeFileSync('client/src/App.jsx', app, 'utf8');
console.log('✓ Practice Fusion added to sidebar');
console.log('  Opens https://www.practicefusion.com/login in new tab');
console.log('Refresh browser.');
