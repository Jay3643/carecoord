const fs = require('fs');

// 1. Add Gemini to the nav items
let app = fs.readFileSync('client/src/App.jsx', 'utf8');

// Add Gemini nav item after the divider, before Calendar
app = app.replace(
  `{ key: '_divider' },
            { key: 'ext_calendar',`,
  `{ key: '_divider' },
            { key: 'gemini', label: 'Gemini', gIcon: <svg width="18" height="18" viewBox="0 0 24 24"><defs><linearGradient id="gm" x1="0" y1="0" x2="24" y2="24"><stop offset="0%" stopColor="#4285f4"/><stop offset="25%" stopColor="#9b72cb"/><stop offset="50%" stopColor="#d96570"/><stop offset="75%" stopColor="#d96570"/><stop offset="100%" stopColor="#4285f4"/></linearGradient></defs><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" fill="url(#gm)"/><path d="M12 6l1.5 3.5L17 11l-3.5 1.5L12 16l-1.5-3.5L7 11l3.5-1.5z" fill="#fff"/></svg> },
            { key: 'ext_calendar',`
);

// Handle gemini as a toggle for the right panel instead of a screen change
app = app.replace(
  `const [showCompose, setShowCompose] = useState(false);`,
  `const [showCompose, setShowCompose] = useState(false);
  const [showGemini, setShowGemini] = useState(false);`
);

// In the nav item click handler, intercept gemini
app = app.replace(
  `return (
            <button key={item.key} onClick={() => { setScreen(item.key); setSelectedTicketId(null); }}`,
  `return (
            <button key={item.key} onClick={() => { if (item.key === 'gemini') { setShowGemini(g => !g); } else { setScreen(item.key); setSelectedTicketId(null); } }}`
);

// Update the gemini button to show active state when panel is open
app = app.replace(
  `background: (screen === item.key || (screen === 'ticketDetail' && item.key === 'regionQueue')) ? '#102f54' : 'transparent',`,
  `background: (screen === item.key || (screen === 'ticketDetail' && item.key === 'regionQueue') || (item.key === 'gemini' && showGemini)) ? '#102f54' : 'transparent',`
);
app = app.replace(
  `color: screen === item.key ? '#ffffff' : '#143d6b',`,
  `color: (screen === item.key || (item.key === 'gemini' && showGemini)) ? '#ffffff' : '#143d6b',`
);

// Add the Gemini side panel to the main content area
app = app.replace(
  `{/* Toast */}`,
  `{/* Gemini Side Panel */}
        {showGemini && (
          <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 400, background: '#fff',
            borderLeft: '1px solid #e0e0e0', boxShadow: '-4px 0 20px rgba(0,0,0,0.08)',
            display: 'flex', flexDirection: 'column', zIndex: 100, animation: 'gemSlide 0.2s ease' }}>
            <style>{\`@keyframes gemSlide { from { transform: translateX(100%); } to { transform: translateX(0); } }\`}</style>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px',
              borderBottom: '1px solid #e8eaed', background: '#f8f9fa' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <svg width="20" height="20" viewBox="0 0 24 24"><defs><linearGradient id="gm2" x1="0" y1="0" x2="24" y2="24"><stop offset="0%" stopColor="#4285f4"/><stop offset="50%" stopColor="#9b72cb"/><stop offset="100%" stopColor="#d96570"/></linearGradient></defs><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" fill="url(#gm2)"/><path d="M12 6l1.5 3.5L17 11l-3.5 1.5L12 16l-1.5-3.5L7 11l3.5-1.5z" fill="#fff"/></svg>
                <span style={{ fontSize: 15, fontWeight: 600, color: '#202124', fontFamily: "'Google Sans', Roboto, sans-serif" }}>Gemini</span>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <a href="https://gemini.google.com" target="_blank" rel="noopener noreferrer"
                  style={{ padding: 6, borderRadius: '50%', display: 'flex', cursor: 'pointer', textDecoration: 'none', color: '#5f6368' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f1f3f4'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  title="Open in full window">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 19H5V5h7V3H5a2 2 0 00-2 2v14a2 2 0 002 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>
                </a>
                <button onClick={() => setShowGemini(false)}
                  style={{ background: 'none', border: 'none', padding: 6, borderRadius: '50%', cursor: 'pointer', display: 'flex', color: '#5f6368' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f1f3f4'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                </button>
              </div>
            </div>
            {/* Gemini iframe */}
            <iframe
              src="https://gemini.google.com/app"
              style={{ flex: 1, border: 'none', width: '100%' }}
              title="Gemini AI"
              allow="clipboard-write"
            />
          </div>
        )}

        {/* Toast */}`
);

fs.writeFileSync('client/src/App.jsx', app, 'utf8');
console.log('✓ Gemini added to sidebar with gradient icon');
console.log('✓ Opens as right-side panel (400px wide)');
console.log('✓ Slide-in animation');
console.log('✓ Header with expand to full window + close buttons');
console.log('✓ Click Gemini again to toggle closed');
console.log('Refresh browser.');
