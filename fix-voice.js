const fs = require('fs');
let app = fs.readFileSync('client/src/App.jsx', 'utf8');

// Remove Gmail entry
app = app.replace(
  /\{ key: 'ext_gmail'[^}]*\},\n/,
  ''
);

// Add Google Voice after Chat
app = app.replace(
  `{ key: 'ext_chat', label: 'Chat', url: 'https://chat.google.com', gIcon: <svg width="18" height="18" viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" fill="#1a73e8"/><path d="M7 8h10M7 12h7" stroke="#fff" strokeWidth="1.2" strokeLinecap="round"/></svg> },`,
  `{ key: 'ext_chat', label: 'Chat', url: 'https://chat.google.com', gIcon: <svg width="18" height="18" viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" fill="#1a73e8"/><path d="M7 8h10M7 12h7" stroke="#fff" strokeWidth="1.2" strokeLinecap="round"/></svg> },
            { key: 'ext_voice', label: 'Voice', url: 'https://voice.google.com', gIcon: <svg width="18" height="18" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" fill="#0f9d58"/><path d="M15.5 17.5c-3.6 0-6.5-2.9-6.5-6.5 0-.6.4-1 1-1h1.5c.5 0 .9.4 1 .9l.4 1.7c0 .4-.1.7-.3.9l-1.1 1.1c.8 1.5 2 2.7 3.5 3.5l1.1-1.1c.2-.2.6-.3.9-.3l1.7.4c.5.1.9.5.9 1V16c0 .6-.4 1-1 1h-.6z" fill="#fff"/></svg> },`
);

fs.writeFileSync('client/src/App.jsx', app, 'utf8');
console.log('✓ Removed Gmail (already in Email section)');
console.log('✓ Added Google Voice with green phone icon');
console.log('Refresh browser.');
