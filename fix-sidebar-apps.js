const fs = require('fs');

// 1. Remove the AppLauncher component import and usage from App.jsx
let app = fs.readFileSync('client/src/App.jsx', 'utf8');

// Remove AppLauncher import
app = app.replace("import AppLauncher from './components/AppLauncher';\n", '');

// Remove AppLauncher from header
app = app.replace(
  `<div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <AppLauncher />
              <button onClick={() => setSidebarCollapsed(!sidebarCollapsed)} style={{ background: 'none', border: 'none', color: '#a8c8e8', cursor: 'pointer', padding: 4 }}>
                <Icon name={sidebarCollapsed ? 'chevronRight' : 'arrowLeft'} size={16} />
              </button>
            </div>`,
  `<button onClick={() => setSidebarCollapsed(!sidebarCollapsed)} style={{ background: 'none', border: 'none', color: '#a8c8e8', cursor: 'pointer', padding: 4 }}>
            <Icon name={sidebarCollapsed ? 'chevronRight' : 'arrowLeft'} size={16} />
          </button>`
);

// Remove CalendarPanel and DrivePanel imports
app = app.replace("import CalendarPanel from './components/CalendarPanel';\n", '');
app = app.replace("import DrivePanel from './components/DrivePanel';\n", '');

// Remove calendar and drive screen renders
app = app.replace(
  `{screen === 'calendar' && (
          <CalendarPanel currentUser={currentUser} showToast={showToast} />
        )}`,
  ''
);
app = app.replace(
  `{screen === 'drive' && (
          <DrivePanel currentUser={currentUser} showToast={showToast} />
        )}`,
  ''
);

// Replace the nav items - remove calendar and drive internal screens,
// add Google Workspace apps as external links
app = app.replace(
  `{ key: 'personalEmail', icon: 'mail', label: 'Email' },
            { key: 'calendar', icon: 'clock', label: 'Calendar' },
            { key: 'drive', icon: 'file', label: 'Drive' },`,
  `{ key: 'personalEmail', icon: 'mail', label: 'Email' },`
);

// Add Google Workspace apps section after the nav buttons, before the bottom user section
app = app.replace(
  `</nav>

        <div style={{ padding: sidebarCollapsed ? '12px 8px' : '12px 16px', borderTop: '1px solid #102f54', background: '#143d6b' }}>`,
  `</nav>

        {/* Google Workspace Apps */}
        {!sidebarCollapsed && (
          <div style={{ padding: '8px 12px', borderTop: '1px solid #102f54' }}>
            <div style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, color: '#5a8ab5', padding: '4px 0 6px 12px' }}>Google Workspace</div>
            {[
              { label: 'Gmail', url: 'https://mail.google.com', color: '#ea4335', letter: 'M' },
              { label: 'Calendar', url: 'https://calendar.google.com', color: '#4285f4', letter: 'C' },
              { label: 'Drive', url: 'https://drive.google.com', color: '#f4b400', letter: 'D' },
              { label: 'Docs', url: 'https://docs.google.com', color: '#4285f4', letter: 'D' },
              { label: 'Sheets', url: 'https://sheets.google.com', color: '#0f9d58', letter: 'S' },
              { label: 'Slides', url: 'https://slides.google.com', color: '#f4b400', letter: 'S' },
              { label: 'Meet', url: 'https://meet.google.com', color: '#00897b', letter: 'M' },
              { label: 'Chat', url: 'https://chat.google.com', color: '#1a73e8', letter: 'C' },
            ].map(g => (
              <a key={g.label} href={g.url} target="_blank" rel="noopener noreferrer"
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px', borderRadius: 8,
                  textDecoration: 'none', color: '#a8c8e8', fontSize: 13, fontWeight: 400, cursor: 'pointer',
                  transition: 'background 0.1s' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#1a5e9a'; e.currentTarget.style.color = '#fff'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#a8c8e8'; }}>
                <img src={'https://www.google.com/s2/favicons?domain=' + new URL(g.url).hostname + '&sz=32'}
                  width="18" height="18" alt={g.label}
                  style={{ borderRadius: 2, flexShrink: 0 }}
                  onError={e => { e.target.style.display='none'; e.target.nextSibling.style.display='flex'; }} />
                <div style={{ display:'none', width:18, height:18, borderRadius:4, background:g.color, alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:700, color:'#fff', flexShrink:0 }}>{g.letter}</div>
                <span>{g.label}</span>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft:'auto', opacity:0.4 }}><path d="M19 19H5V5h7V3H5a2 2 0 00-2 2v14a2 2 0 002 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>
              </a>
            ))}
          </div>
        )}
        {sidebarCollapsed && (
          <div style={{ padding: '8px 4px', borderTop: '1px solid #102f54', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            {[
              { label: 'Gmail', url: 'https://mail.google.com' },
              { label: 'Calendar', url: 'https://calendar.google.com' },
              { label: 'Drive', url: 'https://drive.google.com' },
              { label: 'Docs', url: 'https://docs.google.com' },
              { label: 'Sheets', url: 'https://sheets.google.com' },
              { label: 'Meet', url: 'https://meet.google.com' },
              { label: 'Chat', url: 'https://chat.google.com' },
            ].map(g => (
              <a key={g.label} href={g.url} target="_blank" rel="noopener noreferrer" title={g.label}
                style={{ padding: 6, borderRadius: 8, display: 'flex' }}
                onMouseEnter={e => e.currentTarget.style.background = '#1a5e9a'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <img src={'https://www.google.com/s2/favicons?domain=' + new URL(g.url).hostname + '&sz=32'}
                  width="18" height="18" alt={g.label} style={{ borderRadius: 2 }} />
              </a>
            ))}
          </div>
        )}

        <div style={{ padding: sidebarCollapsed ? '12px 8px' : '12px 16px', borderTop: '1px solid #102f54', background: '#143d6b' }}>`
);

fs.writeFileSync('client/src/App.jsx', app, 'utf8');
console.log('  ✓ App.jsx — Google Workspace apps in sidebar');
console.log('    Removed: Calendar panel, Drive panel, AppLauncher');
console.log('    Added: Gmail, Calendar, Drive, Docs, Sheets, Slides, Meet, Chat links');
console.log('    Each opens in new browser tab with Google favicon');
console.log('');
console.log('Refresh browser.');
