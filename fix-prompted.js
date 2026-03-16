const fs = require('fs');
let app = fs.readFileSync('client/src/App.jsx', 'utf8');

// Add _prompted to the nav items array after _carelink
app = app.replace(
  "{ key: '_carelink' },",
  "{ key: '_carelink' },\n            { key: '_prompted' },"
);

// Add the Prompted link handler before the _updox handler
app = app.replace(
  "if (item.key === '_carelink') return (",
  `if (item.key === '_prompted') return (
              <a key="_prompted" href="https://seniority.thinkprompted.ai/signin" target="_blank" rel="noopener noreferrer"
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: sidebarCollapsed ? '10px 14px' : '10px 12px',
                  borderRadius: 8, textDecoration: 'none', background: 'transparent', color: '#143d6b',
                  cursor: 'pointer', fontSize: 13, fontWeight: 500, width: '100%', textAlign: 'left',
                  justifyContent: sidebarCollapsed ? 'center' : 'flex-start', marginTop: 2 }}
                onMouseEnter={e => { e.currentTarget.style.background = '#102f54'; e.currentTarget.style.color = '#ffffff'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#143d6b'; }}
                title="Prompted">
                <svg width="18" height="18" viewBox="0 0 100 100">
                  <rect x="5" y="5" width="35" height="90" rx="8" fill="#2b4c7e"/>
                  <rect x="45" y="25" width="22" height="6" rx="3" fill="#e8673c"/>
                  <rect x="45" y="40" width="22" height="6" rx="3" fill="#e8673c"/>
                  <rect x="45" y="55" width="22" height="6" rx="3" fill="#e8673c"/>
                  <path d="M40 15 Q70 15 70 35 Q70 55 40 55" fill="none" stroke="#2b4c7e" strokeWidth="8" strokeLinecap="round"/>
                </svg>
                {!sidebarCollapsed && <span>Prompted</span>}
              </a>
            );
            if (item.key === '_carelink') return (`
);

fs.writeFileSync('client/src/App.jsx', app, 'utf8');
console.log(app.includes('_prompted') ? '✓ Prompted link added to sidebar' : '✗ Failed');
