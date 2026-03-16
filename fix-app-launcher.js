const fs = require('fs');

// 1. Create the AppLauncher component
const launcher = `import React, { useState, useRef, useEffect } from 'react';

const APPS = [
  { name: 'Gmail', url: 'https://mail.google.com', color: '#ea4335',
    icon: <svg viewBox="0 0 24 24" width="32" height="32"><path fill="#4285f4" d="M2 6l8 5 2-1.5L22 6v-.5C22 4.67 21.33 4 20.5 4h-17C2.67 4 2 4.67 2 5.5V6z"/><path fill="#ea4335" d="M2 6l8 5 2 1.5V20H3.5C2.67 20 2 19.33 2 18.5V6z"/><path fill="#34a853" d="M22 6l-8 5-2 1.5V20h8.5c.83 0 1.5-.67 1.5-1.5V6z"/><path fill="#fbbc04" d="M12 12.5l-2-1.5-8-5v12.5C2 19.33 2.67 20 3.5 20H12v-7.5z" opacity=".8"/></svg> },
  { name: 'Calendar', url: 'https://calendar.google.com', color: '#4285f4',
    icon: <svg viewBox="0 0 24 24" width="32" height="32"><path fill="#4285f4" d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zm0-12H5V6h14v2z"/><path fill="#1a73e8" d="M9 14h2v2H9zm4 0h2v2h-2zm-4-4h2v2H9zm4 0h2v2h-2z"/></svg> },
  { name: 'Drive', url: 'https://drive.google.com', color: '#0f9d58',
    icon: <svg viewBox="0 0 24 24" width="32" height="32"><path fill="#4285f4" d="M14.5 8L8 19.5l-2.2-3.8L12.3 4.2z"/><path fill="#0f9d58" d="M8 19.5h12.5l-2.2-3.8H5.8z"/><path fill="#f4b400" d="M22.5 15.7L16 4.2h-4.5l6.5 11.5z"/></svg> },
  { name: 'Docs', url: 'https://docs.google.com', color: '#4285f4',
    icon: <svg viewBox="0 0 24 24" width="32" height="32"><rect fill="#4285f4" x="4" y="2" width="16" height="20" rx="2"/><path fill="#fff" d="M7 7h10v1.5H7zM7 10.5h10V12H7zM7 14h7v1.5H7z"/></svg> },
  { name: 'Sheets', url: 'https://sheets.google.com', color: '#0f9d58',
    icon: <svg viewBox="0 0 24 24" width="32" height="32"><rect fill="#0f9d58" x="4" y="2" width="16" height="20" rx="2"/><path fill="#fff" d="M7 7h4v3H7zM13 7h4v3h-4zM7 12h4v3H7zM13 12h4v3h-4z"/></svg> },
  { name: 'Slides', url: 'https://slides.google.com', color: '#f4b400',
    icon: <svg viewBox="0 0 24 24" width="32" height="32"><rect fill="#f4b400" x="4" y="2" width="16" height="20" rx="2"/><rect fill="#fff" x="7" y="7" width="10" height="8" rx="1"/></svg> },
  { name: 'Meet', url: 'https://meet.google.com', color: '#00897b',
    icon: <svg viewBox="0 0 24 24" width="32" height="32"><path fill="#00897b" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/><path fill="#fff" d="M15 8l-3 2.5L9 8H7v8h2l3-2.5L15 16h2V8h-2z"/></svg> },
  { name: 'Chat', url: 'https://chat.google.com', color: '#1a73e8',
    icon: <svg viewBox="0 0 24 24" width="32" height="32"><path fill="#1a73e8" d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/><path fill="#fff" d="M7 9h10v1.5H7zM7 12h7v1.5H7z"/></svg> },
  { name: 'Contacts', url: 'https://contacts.google.com', color: '#4285f4',
    icon: <svg viewBox="0 0 24 24" width="32" height="32"><path fill="#4285f4" d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg> },
  { name: 'Forms', url: 'https://forms.google.com', color: '#673ab7',
    icon: <svg viewBox="0 0 24 24" width="32" height="32"><rect fill="#673ab7" x="4" y="2" width="16" height="20" rx="2"/><circle fill="#fff" cx="9" cy="9" r="1.5"/><path fill="#fff" d="M12 8h5v1.5h-5zM12 12h5v1.5h-5z"/><circle fill="#fff" cx="9" cy="13" r="1.5"/></svg> },
  { name: 'Keep', url: 'https://keep.google.com', color: '#f4b400',
    icon: <svg viewBox="0 0 24 24" width="32" height="32"><path fill="#f4b400" d="M5 2h14a2 2 0 012 2v16a2 2 0 01-2 2H5a2 2 0 01-2-2V4a2 2 0 012-2z"/><path fill="#fff" d="M12 3a5 5 0 00-2 9.58V15h4v-2.42A5 5 0 0012 3zm-1 14h2v2h-2v-2z"/></svg> },
  { name: 'Admin', url: 'https://admin.google.com', color: '#5f6368',
    icon: <svg viewBox="0 0 24 24" width="32" height="32"><path fill="#5f6368" d="M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z"/></svg> },
];

export default function AppLauncher() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(!open)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 8, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.15)'}
        onMouseLeave={e => e.currentTarget.style.background = 'none'}
        title="Google Apps">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="#a8c8e8">
          <circle cx="5" cy="5" r="2.5"/>
          <circle cx="12" cy="5" r="2.5"/>
          <circle cx="19" cy="5" r="2.5"/>
          <circle cx="5" cy="12" r="2.5"/>
          <circle cx="12" cy="12" r="2.5"/>
          <circle cx="19" cy="12" r="2.5"/>
          <circle cx="5" cy="19" r="2.5"/>
          <circle cx="12" cy="19" r="2.5"/>
          <circle cx="19" cy="19" r="2.5"/>
        </svg>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 44, right: 0, width: 320, background: '#fff',
          borderRadius: 16, boxShadow: '0 8px 32px rgba(0,0,0,0.25)', border: '1px solid #e0e0e0',
          padding: '16px 8px', zIndex: 300, animation: 'fadeIn 0.15s ease'
        }}>
          <style>{\`@keyframes fadeIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }\`}</style>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
            {APPS.map(app => (
              <a key={app.name} href={app.url} target="_blank" rel="noopener noreferrer"
                onClick={() => setOpen(false)}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                  padding: '12px 8px', borderRadius: 12, textDecoration: 'none',
                  color: '#3c4043', cursor: 'pointer', transition: 'background 0.1s'
                }}
                onMouseEnter={e => e.currentTarget.style.background = '#f1f3f4'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                {app.icon}
                <span style={{ fontSize: 12, textAlign: 'center', lineHeight: 1.2 }}>{app.name}</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
`;

fs.writeFileSync('client/src/components/AppLauncher.jsx', launcher, 'utf8');
console.log('  ✓ AppLauncher.jsx created');

// 2. Add AppLauncher to App.jsx sidebar header
let app = fs.readFileSync('client/src/App.jsx', 'utf8');

// Add import
if (!app.includes('AppLauncher')) {
  app = app.replace(
    "import { GmailConnectButton } from './components/GmailPanel';",
    "import { GmailConnectButton } from './components/GmailPanel';\nimport AppLauncher from './components/AppLauncher';"
  );

  // Add to the top-right of the sidebar header
  app = app.replace(
    `<button onClick={() => setSidebarCollapsed(!sidebarCollapsed)} style={{ background: 'none', border: 'none', color: '#a8c8e8', cursor: 'pointer', padding: 4 }}>
            <Icon name={sidebarCollapsed ? 'chevronRight' : 'arrowLeft'} size={16} />
          </button>`,
    `<div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <AppLauncher />
              <button onClick={() => setSidebarCollapsed(!sidebarCollapsed)} style={{ background: 'none', border: 'none', color: '#a8c8e8', cursor: 'pointer', padding: 4 }}>
                <Icon name={sidebarCollapsed ? 'chevronRight' : 'arrowLeft'} size={16} />
              </button>
            </div>`
  );
}

fs.writeFileSync('client/src/App.jsx', app, 'utf8');
console.log('  ✓ App.jsx — AppLauncher added to sidebar header');

console.log('');
console.log('Done. Refresh browser.');
console.log('  Click the 3x3 grid icon in the top-right of the sidebar');
console.log('  Opens a dropdown with all Google Workspace apps');
