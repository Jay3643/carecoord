const fs = require('fs');
let app = fs.readFileSync('client/src/App.jsx', 'utf8');

// Remove the existing Google Workspace section entirely
app = app.replace(
  /\{\/\* Google Workspace Apps \*\/\}[\s\S]*?\{sidebarCollapsed && \([\s\S]*?\)\}/,
  ''
);

// Now add Google apps as regular nav items that open in new tabs
// They go right after the admin item in the nav array
app = app.replace(
  `...(currentUser.role === 'admin' ? [{ key: 'admin', icon: 'settings', label: 'Admin' }] : []),
          ].map(item => (`,
  `...(currentUser.role === 'admin' ? [{ key: 'admin', icon: 'settings', label: 'Admin' }] : []),
            { key: '_divider' },
            { key: 'ext_gmail', icon: 'mail', label: 'Gmail', url: 'https://mail.google.com' },
            { key: 'ext_calendar', icon: 'clock', label: 'Calendar', url: 'https://calendar.google.com' },
            { key: 'ext_drive', icon: 'file', label: 'Drive', url: 'https://drive.google.com' },
            { key: 'ext_docs', icon: 'file', label: 'Docs', url: 'https://docs.google.com' },
            { key: 'ext_sheets', icon: 'barChart', label: 'Sheets', url: 'https://sheets.google.com' },
            { key: 'ext_slides', icon: 'log', label: 'Slides', url: 'https://slides.google.com' },
            { key: 'ext_meet', icon: 'users', label: 'Meet', url: 'https://meet.google.com' },
            { key: 'ext_chat', icon: 'send', label: 'Chat', url: 'https://chat.google.com' },
          ].map(item => (`
);

// Handle the divider and external links in the render
app = app.replace(
  `].map(item => (
            <button key={item.key} onClick={() => { setScreen(item.key); setSelectedTicketId(null); }}`,
  `].map(item => {
            if (item.key === '_divider') return !sidebarCollapsed ? <div key="_div" style={{ height: 1, background: '#102f54', margin: '8px 12px' }} /> : <div key="_div" style={{ height: 1, background: '#102f54', margin: '8px 4px' }} />;
            if (item.url) return (
              <a key={item.key} href={item.url} target="_blank" rel="noopener noreferrer"
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: sidebarCollapsed ? '10px 14px' : '10px 12px',
                  borderRadius: 8, border: 'none', textDecoration: 'none',
                  background: 'transparent',
                  color: '#a8c8e8',
                  cursor: 'pointer', fontSize: 13, fontWeight: 500, width: '100%', textAlign: 'left',
                  justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = '#1a5e9a'; e.currentTarget.style.color = '#ffffff'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#a8c8e8'; }}
                title={item.label}>
                <Icon name={item.icon} size={18} />
                {!sidebarCollapsed && <span>{item.label}</span>}
                {!sidebarCollapsed && <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft:'auto', opacity:0.4 }}><path d="M19 19H5V5h7V3H5a2 2 0 00-2 2v14a2 2 0 002 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>}
              </a>
            );
            return (
            <button key={item.key} onClick={() => { setScreen(item.key); setSelectedTicketId(null); }}`
);

fs.writeFileSync('client/src/App.jsx', app, 'utf8');
console.log('✓ Google Workspace apps now inline in sidebar nav');
console.log('  Same font, same colors, same hover style as other items');
console.log('  Divider line separates CareCoord items from Google apps');
console.log('  Small external link icon on the right');
console.log('Refresh browser.');
