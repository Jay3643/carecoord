const fs = require('fs');
let app = fs.readFileSync('client/src/App.jsx', 'utf8');

// Replace the entire nav section with unified styling for all items
// Remove the separate styling for external links - make them identical to internal items

// Replace the external link rendering to match internal button styling exactly
app = app.replace(
  `if (item.url) return (
              <a key={item.key} href={item.url} target="_blank" rel="noopener noreferrer"
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: sidebarCollapsed ? '10px 14px' : '10px 12px',
                  borderRadius: 8, border: 'none', textDecoration: 'none',
                  background: 'transparent',
                  color: '#143d6b',
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
            );`,
  `if (item.url) return (
              <a key={item.key} href={item.url} target="_blank" rel="noopener noreferrer"
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: sidebarCollapsed ? '10px 14px' : '10px 12px',
                  borderRadius: 8, border: 'none', textDecoration: 'none',
                  background: 'transparent',
                  color: '#143d6b',
                  cursor: 'pointer', fontSize: 13, fontWeight: 500, width: '100%', textAlign: 'left',
                  justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = '#102f54'; e.currentTarget.style.color = '#ffffff'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#143d6b'; }}
                title={item.label}>
                {item.gIcon || <Icon name={item.icon} size={18} />}
                {!sidebarCollapsed && <span>{item.label}</span>}
              </a>
            );`
);

// Now replace the Google app entries with proper SVG logos
app = app.replace(
  `{ key: '_divider' },
            { key: 'ext_gmail', icon: 'mail', label: 'Gmail', url: 'https://mail.google.com' },
            { key: 'ext_calendar', icon: 'clock', label: 'Calendar', url: 'https://calendar.google.com' },
            { key: 'ext_drive', icon: 'file', label: 'Drive', url: 'https://drive.google.com' },
            { key: 'ext_docs', icon: 'file', label: 'Docs', url: 'https://docs.google.com' },
            { key: 'ext_sheets', icon: 'barChart', label: 'Sheets', url: 'https://sheets.google.com' },
            { key: 'ext_slides', icon: 'log', label: 'Slides', url: 'https://slides.google.com' },
            { key: 'ext_meet', icon: 'users', label: 'Meet', url: 'https://meet.google.com' },
            { key: 'ext_chat', icon: 'send', label: 'Chat', url: 'https://chat.google.com' },`,
  `{ key: '_divider' },
            { key: 'ext_gmail', label: 'Gmail', url: 'https://mail.google.com', gIcon: <svg width="18" height="18" viewBox="0 0 24 24"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2z" fill="#e0e0e0"/><path d="M2 6l10 7 10-7" fill="none" stroke="#ea4335" strokeWidth="1.5"/><path d="M2 6v12h3V9.5L12 15l7-5.5V18h3V6l-10 7z" fill="#ea4335" opacity=".9"/></svg> },
            { key: 'ext_calendar', label: 'Calendar', url: 'https://calendar.google.com', gIcon: <svg width="18" height="18" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" fill="#fff" stroke="#4285f4" strokeWidth="1.5"/><rect x="3" y="4" width="18" height="5" rx="2" fill="#4285f4"/><text x="12" y="18" textAnchor="middle" fontSize="9" fontWeight="700" fill="#4285f4" fontFamily="sans-serif">{new Date().getDate()}</text></svg> },
            { key: 'ext_drive', label: 'Drive', url: 'https://drive.google.com', gIcon: <svg width="18" height="18" viewBox="0 0 24 24"><path d="M8 2l-6 10.5h6L14 2z" fill="#0f9d58"/><path d="M14 2l6 10.5h-6L8 2z" fill="#ffcd40"/><path d="M2 12.5l3 5.5h14l3-5.5z" fill="#4285f4"/><path d="M8 12.5h8l-3-5.5z" fill="#2d6fdd" opacity=".3"/></svg> },
            { key: 'ext_docs', label: 'Docs', url: 'https://docs.google.com', gIcon: <svg width="18" height="18" viewBox="0 0 24 24"><rect x="4" y="2" width="16" height="20" rx="2" fill="#4285f4"/><path d="M8 8h8M8 11h8M8 14h5" stroke="#fff" strokeWidth="1.2" strokeLinecap="round"/></svg> },
            { key: 'ext_sheets', label: 'Sheets', url: 'https://sheets.google.com', gIcon: <svg width="18" height="18" viewBox="0 0 24 24"><rect x="4" y="2" width="16" height="20" rx="2" fill="#0f9d58"/><rect x="7" y="7" width="4" height="3" fill="#fff"/><rect x="13" y="7" width="4" height="3" fill="#fff"/><rect x="7" y="12" width="4" height="3" fill="#fff"/><rect x="13" y="12" width="4" height="3" fill="#fff"/></svg> },
            { key: 'ext_slides', label: 'Slides', url: 'https://slides.google.com', gIcon: <svg width="18" height="18" viewBox="0 0 24 24"><rect x="4" y="2" width="16" height="20" rx="2" fill="#f4b400"/><rect x="7" y="7" width="10" height="7" rx="1" fill="#fff"/></svg> },
            { key: 'ext_meet', label: 'Meet', url: 'https://meet.google.com', gIcon: <svg width="18" height="18" viewBox="0 0 24 24"><rect x="2" y="6" width="14" height="12" rx="2" fill="#00897b"/><path d="M16 10l6-4v12l-6-4z" fill="#00897b"/><rect x="5" y="9" width="3" height="2" rx="1" fill="#fff"/><rect x="10" y="9" width="3" height="2" rx="1" fill="#fff"/></svg> },
            { key: 'ext_chat', label: 'Chat', url: 'https://chat.google.com', gIcon: <svg width="18" height="18" viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" fill="#1a73e8"/><path d="M7 8h10M7 12h7" stroke="#fff" strokeWidth="1.2" strokeLinecap="round"/></svg> },`
);

fs.writeFileSync('client/src/App.jsx', app, 'utf8');
console.log('✓ All nav items now have identical hover behavior');
console.log('✓ Google apps have custom SVG logos matching their brand colors');
console.log('  Gmail: red envelope');
console.log('  Calendar: blue with today date');
console.log('  Drive: tri-color triangle');
console.log('  Docs: blue document');
console.log('  Sheets: green grid');
console.log('  Slides: yellow with screen');
console.log('  Meet: teal camera');
console.log('  Chat: blue speech bubble');
console.log('Refresh browser.');
