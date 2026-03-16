const fs = require('fs');
let app = fs.readFileSync('client/src/App.jsx', 'utf8');

// Add Updox after Practice Fusion
app = app.replace(
  `if (item.key === '_practice_fusion') return (`,
  `if (item.key === '_updox') return (
              <a key="_updox" href="https://myupdox.com/ui/html/oauth2/practicefusion.html" target="_blank" rel="noopener noreferrer"
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: sidebarCollapsed ? '10px 14px' : '10px 12px',
                  borderRadius: 8, textDecoration: 'none', background: 'transparent', color: '#143d6b',
                  cursor: 'pointer', fontSize: 13, fontWeight: 500, width: '100%', textAlign: 'left',
                  justifyContent: sidebarCollapsed ? 'center' : 'flex-start', marginTop: 2 }}
                onMouseEnter={e => { e.currentTarget.style.background = '#102f54'; e.currentTarget.style.color = '#ffffff'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#143d6b'; }}
                title="Updox">
                <svg width="18" height="18" viewBox="0 0 24 24"><rect width="24" height="24" rx="4" fill="#1a3a5c"/><text x="12" y="16.5" textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff" fontFamily="sans-serif">u</text></svg>
                {!sidebarCollapsed && <span>Updox</span>}
              </a>
            );
            if (item.key === '_practice_fusion') return (`
);

// Add the _updox key to the nav array after _practice_fusion
app = app.replace(
  `{ key: '_practice_fusion' },`,
  `{ key: '_practice_fusion' },
            { key: '_updox' },`
);

fs.writeFileSync('client/src/App.jsx', app, 'utf8');
console.log('✓ Updox added below Practice Fusion');
console.log('  Dark blue "u" logo matching their brand');
console.log('  Opens Practice Fusion OAuth login for Updox');
