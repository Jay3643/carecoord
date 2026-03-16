const fs = require('fs');
let app = fs.readFileSync('client/src/App.jsx', 'utf8');

// Replace the sidebar header section
app = app.replace(
  `<div style={{ padding: sidebarCollapsed ? '16px 12px' : '16px 20px', borderBottom: '1px solid #102f54', background: '#143d6b', display: 'flex', alignItems: 'center', gap: 10, minHeight: 64 }}>
          {!sidebarCollapsed && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
              
              <span style={{ fontWeight: 700, fontSize: 14, letterSpacing: -0.3, whiteSpace: 'nowrap', color: '#ffffff' }}>Seniority</span>
            </div>
          )}
          <button onClick={() => setSidebarCollapsed(!sidebarCollapsed)} style={{ background: 'none', border: 'none', color: '#a8c8e8', cursor: 'pointer', padding: 4 }}>
            <Icon name={sidebarCollapsed ? 'chevronRight' : 'arrowLeft'} size={16} />
          </button>
        </div>`,
  `<div style={{ padding: sidebarCollapsed ? '12px 8px' : '12px 16px', borderBottom: '1px solid #102f54', background: '#143d6b', display: 'flex', alignItems: 'center', gap: 10, minHeight: 64 }}>
          {!sidebarCollapsed && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
              <img src="/logo.png" alt="Seniority Healthcare" style={{ height: 32, objectFit: 'contain' }} />
              <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
                <span style={{ fontWeight: 700, fontSize: 13, color: '#ffffff', whiteSpace: 'nowrap' }}>Seniority Healthcare</span>
                <span style={{ fontSize: 10, color: '#a8c8e8', fontWeight: 400, letterSpacing: 0.5 }}>WORKSPACE</span>
              </div>
            </div>
          )}
          {sidebarCollapsed && (
            <img src="/logo.png" alt="SH" style={{ height: 28, objectFit: 'contain', margin: '0 auto' }} />
          )}
          <button onClick={() => setSidebarCollapsed(!sidebarCollapsed)} style={{ background: 'none', border: 'none', color: '#a8c8e8', cursor: 'pointer', padding: 4, flexShrink: 0 }}>
            <Icon name={sidebarCollapsed ? 'chevronRight' : 'arrowLeft'} size={16} />
          </button>
        </div>`
);

fs.writeFileSync('client/src/App.jsx', app, 'utf8');
console.log('✓ Sidebar header updated — Seniority Healthcare / WORKSPACE + logo');
console.log('');
console.log('Now copy the logo to the client public folder:');
console.log('  copy logo.png client\\public\\logo.png');
console.log('  (create client\\public if it doesnt exist)');
