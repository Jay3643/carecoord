const fs = require('fs');
let app = fs.readFileSync('client/src/App.jsx', 'utf8');

// Add state for workspace submenu
app = app.replace(
  "const [showGemini, setShowGemini] = useState(false);",
  "const [showGemini, setShowGemini] = useState(false);\n  const [showWorkspace, setShowWorkspace] = useState(false);"
);

// Replace the entire section from divider through all ext_ items and gemini
// with a collapsible Google Workspace menu + Practice Fusion below
app = app.replace(
  /\{ key: '_divider' \},\n[\s\S]*?\{ key: 'gemini'[^}]*\},/,
  `{ key: '_workspace_toggle' },
            { key: '_workspace_apps' },
            { key: '_practice_fusion' },`
);

// Now handle these special keys in the map renderer
app = app.replace(
  `if (item.key === '_divider') return !sidebarCollapsed ? <div key="_div" style={{ height: 1, background: '#102f54', margin: '8px 12px' }} /> : <div key="_div" style={{ height: 1, background: '#102f54', margin: '8px 4px' }} />;`,
  `if (item.key === '_divider') return !sidebarCollapsed ? <div key="_div" style={{ height: 1, background: '#102f54', margin: '8px 12px' }} /> : <div key="_div" style={{ height: 1, background: '#102f54', margin: '8px 4px' }} />;
            if (item.key === '_workspace_toggle') return (
              <React.Fragment key="_wst">
                {!sidebarCollapsed ? <div style={{ height: 1, background: '#102f54', margin: '8px 12px' }} /> : <div style={{ height: 1, background: '#102f54', margin: '8px 4px' }} />}
                <button onClick={() => setShowWorkspace(w => !w)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: sidebarCollapsed ? '10px 14px' : '10px 12px',
                    borderRadius: 8, border: 'none', background: showWorkspace ? '#102f54' : 'transparent',
                    color: showWorkspace ? '#ffffff' : '#143d6b', cursor: 'pointer', fontSize: 13, fontWeight: 500,
                    width: '100%', textAlign: 'left', justifyContent: sidebarCollapsed ? 'center' : 'flex-start' }}
                  onMouseEnter={e => { if (!showWorkspace) { e.currentTarget.style.background = '#102f54'; e.currentTarget.style.color = '#ffffff'; } }}
                  onMouseLeave={e => { if (!showWorkspace) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#143d6b'; } }}
                  title="Google Workspace">
                  <svg width="18" height="18" viewBox="0 0 24 24"><circle cx="5" cy="5" r="2" fill={showWorkspace ? '#fff' : '#4285f4'}/><circle cx="12" cy="5" r="2" fill={showWorkspace ? '#fff' : '#ea4335'}/><circle cx="19" cy="5" r="2" fill={showWorkspace ? '#fff' : '#fbbc04'}/><circle cx="5" cy="12" r="2" fill={showWorkspace ? '#fff' : '#34a853'}/><circle cx="12" cy="12" r="2" fill={showWorkspace ? '#fff' : '#4285f4'}/><circle cx="19" cy="12" r="2" fill={showWorkspace ? '#fff' : '#ea4335'}/><circle cx="5" cy="19" r="2" fill={showWorkspace ? '#fff' : '#fbbc04'}/><circle cx="12" cy="19" r="2" fill={showWorkspace ? '#fff' : '#34a853'}/><circle cx="19" cy="19" r="2" fill={showWorkspace ? '#fff' : '#4285f4'}/></svg>
                  {!sidebarCollapsed && <span>Google Workspace</span>}
                  {!sidebarCollapsed && <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: 'auto', transform: showWorkspace ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s' }}><path d="M7 10l5 5 5-5z"/></svg>}
                </button>
              </React.Fragment>
            );
            if (item.key === '_workspace_apps') {
              if (!showWorkspace) return null;
              const apps = [
                { label: 'Calendar', url: 'https://calendar.google.com', icon: <svg width="16" height="16" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" fill="#fff" stroke="#4285f4" strokeWidth="1.5"/><rect x="3" y="4" width="18" height="5" rx="2" fill="#4285f4"/><text x="12" y="18" textAnchor="middle" fontSize="9" fontWeight="700" fill="#4285f4" fontFamily="sans-serif">{new Date().getDate()}</text></svg> },
                { label: 'Drive', url: 'https://drive.google.com', icon: <svg width="16" height="16" viewBox="0 0 24 24"><path d="M8 2l-6 10.5h6L14 2z" fill="#0f9d58"/><path d="M14 2l6 10.5h-6L8 2z" fill="#ffcd40"/><path d="M2 12.5l3 5.5h14l3-5.5z" fill="#4285f4"/></svg> },
                { label: 'Docs', url: 'https://docs.google.com', icon: <svg width="16" height="16" viewBox="0 0 24 24"><rect x="4" y="2" width="16" height="20" rx="2" fill="#4285f4"/><path d="M8 8h8M8 11h8M8 14h5" stroke="#fff" strokeWidth="1.2" strokeLinecap="round"/></svg> },
                { label: 'Sheets', url: 'https://sheets.google.com', icon: <svg width="16" height="16" viewBox="0 0 24 24"><rect x="4" y="2" width="16" height="20" rx="2" fill="#0f9d58"/><rect x="7" y="7" width="4" height="3" fill="#fff"/><rect x="13" y="7" width="4" height="3" fill="#fff"/><rect x="7" y="12" width="4" height="3" fill="#fff"/><rect x="13" y="12" width="4" height="3" fill="#fff"/></svg> },
                { label: 'Meet', url: 'https://meet.google.com', icon: <svg width="16" height="16" viewBox="0 0 24 24"><rect x="2" y="6" width="14" height="12" rx="2" fill="#00897b"/><path d="M16 10l6-4v12l-6-4z" fill="#00897b"/><rect x="5" y="9" width="3" height="2" rx="1" fill="#fff"/><rect x="10" y="9" width="3" height="2" rx="1" fill="#fff"/></svg> },
                { label: 'Chat', url: 'https://chat.google.com', icon: <svg width="16" height="16" viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" fill="#1a73e8"/><path d="M7 8h10M7 12h7" stroke="#fff" strokeWidth="1.2" strokeLinecap="round"/></svg> },
                { label: 'Voice', url: 'https://voice.google.com', icon: <svg width="16" height="16" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" fill="#0f9d58"/><path d="M15.5 17.5c-3.6 0-6.5-2.9-6.5-6.5 0-.6.4-1 1-1h1.5c.5 0 .9.4 1 .9l.4 1.7c0 .4-.1.7-.3.9l-1.1 1.1c.8 1.5 2 2.7 3.5 3.5l1.1-1.1c.2-.2.6-.3.9-.3l1.7.4c.5.1.9.5.9 1V16c0 .6-.4 1-1 1h-.6z" fill="#fff"/></svg> },
                { label: 'Gemini', url: 'gemini', icon: <svg width="16" height="16" viewBox="0 0 24 24"><defs><linearGradient id="gmSub" x1="0" y1="0" x2="24" y2="24"><stop offset="0%" stopColor="#4285f4"/><stop offset="25%" stopColor="#9b72cb"/><stop offset="50%" stopColor="#d96570"/><stop offset="75%" stopColor="#9b72cb"/><stop offset="100%" stopColor="#4285f4"/></linearGradient></defs><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" fill="url(#gmSub)"/><path d="M12 6l1.5 3.5L17 11l-3.5 1.5L12 16l-1.5-3.5L7 11l3.5-1.5z" fill="#fff"/></svg> },
              ];
              return (
                <div key="_wsa" style={{ display: 'flex', flexDirection: 'column', gap: 1, paddingLeft: sidebarCollapsed ? 0 : 12 }}>
                  {apps.map(a => (
                    <a key={a.label} href={a.url === 'gemini' ? '#' : a.url} target={a.url === 'gemini' ? undefined : '_blank'} rel="noopener noreferrer"
                      onClick={a.url === 'gemini' ? (e) => { e.preventDefault(); const w=420,h=window.innerHeight-40,left=window.screenX+window.innerWidth-w-10,top=window.screenY+20; window.open('https://gemini.google.com/app','gemini-ai','width='+w+',height='+h+',left='+left+',top='+top+',menubar=no,toolbar=no,location=yes,scrollbars=yes,resizable=yes'); } : undefined}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: sidebarCollapsed ? '8px 14px' : '8px 12px',
                        borderRadius: 8, textDecoration: 'none', background: 'transparent', color: '#143d6b',
                        cursor: 'pointer', fontSize: 12, fontWeight: 400, justifyContent: sidebarCollapsed ? 'center' : 'flex-start' }}
                      onMouseEnter={e => { e.currentTarget.style.background = '#102f54'; e.currentTarget.style.color = '#ffffff'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#143d6b'; }}
                      title={a.label}>
                      {a.icon}
                      {!sidebarCollapsed && <span>{a.label}</span>}
                    </a>
                  ))}
                </div>
              );
            }
            if (item.key === '_practice_fusion') return (
              <a key="_pf" href="https://www.practicefusion.com/login" target="_blank" rel="noopener noreferrer"
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: sidebarCollapsed ? '10px 14px' : '10px 12px',
                  borderRadius: 8, textDecoration: 'none', background: 'transparent', color: '#143d6b',
                  cursor: 'pointer', fontSize: 13, fontWeight: 500, width: '100%', textAlign: 'left',
                  justifyContent: sidebarCollapsed ? 'center' : 'flex-start', marginTop: 2 }}
                onMouseEnter={e => { e.currentTarget.style.background = '#102f54'; e.currentTarget.style.color = '#ffffff'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#143d6b'; }}
                title="Practice Fusion">
                <svg width="18" height="18" viewBox="0 0 24 24"><path d="M12 2L2 8l0 0 10 6 10-6z" fill="#5bb7db"/><path d="M2 8v8l10 6V16z" fill="#2b6a94"/><path d="M22 8v8l-10 6V16z" fill="#3a8fc5"/></svg>
                {!sidebarCollapsed && <span>Practice Fusion</span>}
              </a>
            );`
);

// Remove the old external link handler for ext_ items since they're now in the submenu
// The if (item.url) block should only handle items that still exist outside the submenu
// Actually, all ext_ items are now gone from the array, so the url handler won't match anything
// But let's keep it for safety

fs.writeFileSync('client/src/App.jsx', app, 'utf8');
console.log('✓ Google Workspace is now a collapsible submenu');
console.log('✓ Practice Fusion sits below it');
console.log('');
console.log('Sidebar order:');
console.log('  Region Queue');
console.log('  My Queue');
console.log('  Dashboard');
console.log('  Audit Log');
console.log('  Email');
console.log('  Admin');
console.log('  ──────────');
console.log('  ▼ Google Workspace (click to expand)');
console.log('     Calendar');
console.log('     Drive');
console.log('     Docs');
console.log('     Sheets');
console.log('     Meet');
console.log('     Chat');
console.log('     Voice');
console.log('     Gemini');
console.log('  Practice Fusion');
console.log('');
console.log('Refresh browser.');
