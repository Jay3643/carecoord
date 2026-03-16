const fs = require('fs');
let app = fs.readFileSync('client/src/App.jsx', 'utf8');

// Replace the green P icon with the blue geometric cube logo
app = app.replace(
  /\{ key: 'ext_pf', label: 'Practice Fusion', url: 'https:\/\/www\.practicefusion\.com\/login', gIcon: <svg[^]*?<\/svg> \}/,
  `{ key: 'ext_pf', label: 'Practice Fusion', url: 'https://www.practicefusion.com/login', gIcon: <svg width="18" height="18" viewBox="0 0 24 24"><path d="M12 2L2 8l0 0 10 6 10-6z" fill="#5bb7db"/><path d="M2 8v8l10 6V16z" fill="#2b6a94"/><path d="M22 8v8l-10 6V16z" fill="#3a8fc5"/></svg> }`
);

fs.writeFileSync('client/src/App.jsx', app, 'utf8');
console.log('✓ Practice Fusion logo updated to blue geometric cube');
