const fs = require('fs');
let app = fs.readFileSync('client/src/App.jsx', 'utf8');

// Add CareLink after the Updox link
app = app.replace(
  `if (item.key === '_updox') return (
              <a key="_updox" href="https://myupdox.com/ui/html/oauth2/practicefusion.html" target="_blank" rel="noopener noreferrer"`,
  `if (item.key === '_carelink') return (
              <a key="_carelink" href="https://seniority.xcelerait.ai/sign-in" target="_blank" rel="noopener noreferrer"
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: sidebarCollapsed ? '10px 14px' : '10px 12px',
                  borderRadius: 8, textDecoration: 'none', background: 'transparent', color: '#143d6b',
                  cursor: 'pointer', fontSize: 13, fontWeight: 500, width: '100%', textAlign: 'left',
                  justifyContent: sidebarCollapsed ? 'center' : 'flex-start', marginTop: 2 }}
                onMouseEnter={e => { e.currentTarget.style.background = '#102f54'; e.currentTarget.style.color = '#ffffff'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#143d6b'; }}
                title="CareLink">
                <svg width="18" height="18" viewBox="0 0 24 24"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z" fill="#1a73e8"/></svg>
                {!sidebarCollapsed && <span>CareLink</span>}
              </a>
            );
            if (item.key === '_updox') return (
              <a key="_updox" href="https://myupdox.com/ui/html/oauth2/practicefusion.html" target="_blank" rel="noopener noreferrer"`
);

// Add _carelink to the nav items array
app = app.replace(
  "{ key: '_updox' },",
  "{ key: '_updox' },\n            { key: '_carelink' },"
);

fs.writeFileSync('client/src/App.jsx', app, 'utf8');
console.log(app.includes('_carelink') ? '✓ CareLink added to sidebar' : '✗ Failed');
