const fs = require('fs');
let app = fs.readFileSync('client/src/App.jsx', 'utf8');

// Remove Gemini from current position (after divider, before calendar)
app = app.replace(
  /\{ key: 'gemini'[^}]*\},\n\s*/,
  ''
);

// Add Gemini after Voice (last item)
app = app.replace(
  /(\{ key: 'ext_voice'[^}]*\}),\n/,
  '$1,\n            { key: \'gemini\', label: \'Gemini\', gIcon: <svg width="18" height="18" viewBox="0 0 24 24"><defs><linearGradient id="gm" x1="0" y1="0" x2="24" y2="24"><stop offset="0%" stopColor="#4285f4"/><stop offset="25%" stopColor="#9b72cb"/><stop offset="50%" stopColor="#d96570"/><stop offset="75%" stopColor="#9b72cb"/><stop offset="100%" stopColor="#4285f4"/></linearGradient></defs><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" fill="url(#gm)"/><path d="M12 6l1.5 3.5L17 11l-3.5 1.5L12 16l-1.5-3.5L7 11l3.5-1.5z" fill="#fff"/></svg> },\n'
);

fs.writeFileSync('client/src/App.jsx', app, 'utf8');
console.log('✓ Gemini moved to bottom of Google apps list');
