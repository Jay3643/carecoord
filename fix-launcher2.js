const fs = require('fs');

const launcher = `import React, { useState, useRef, useEffect } from 'react';

const APPS = [
  { name: 'Search', url: 'https://google.com', img: 'https://www.gstatic.com/images/branding/product/1x/googleg_48dp.png' },
  { name: 'Gmail', url: 'https://mail.google.com', img: 'https://ssl.gstatic.com/ui/v1/icons/mail/rfr/gmail.ico' },
  { name: 'Calendar', url: 'https://calendar.google.com', img: 'https://calendar.google.com/googlecalendar/images/favicons_2020q4/calendar_31.ico' },
  { name: 'Drive', url: 'https://drive.google.com', img: 'https://ssl.gstatic.com/images/branding/product/1x/drive_2020q4_48dp.png' },
  { name: 'Docs', url: 'https://docs.google.com', img: 'https://ssl.gstatic.com/docs/documents/images/kix-favicon7.ico' },
  { name: 'Sheets', url: 'https://sheets.google.com', img: 'https://ssl.gstatic.com/docs/spreadsheets/favicon3.ico' },
  { name: 'Slides', url: 'https://slides.google.com', img: 'https://ssl.gstatic.com/docs/presentations/images/favicon5.ico' },
  { name: 'Meet', url: 'https://meet.google.com', img: 'https://fonts.gstatic.com/s/i/productlogos/meet_2020q4/v1/web-24dp/logo_meet_2020q4_color_1x_web_24dp.png' },
  { name: 'Chat', url: 'https://chat.google.com', img: 'https://www.gstatic.com/images/branding/product/1x/chat_2020q4_48dp.png' },
  { name: 'Contacts', url: 'https://contacts.google.com', img: 'https://www.gstatic.com/images/branding/product/1x/contacts_2022_48dp.png' },
  { name: 'Forms', url: 'https://forms.google.com', img: 'https://ssl.gstatic.com/docs/spreadsheets/forms/favicon_qp2.png' },
  { name: 'Keep', url: 'https://keep.google.com', img: 'https://www.gstatic.com/images/branding/product/1x/keep_2020q4_48dp.png' },
  { name: 'Sites', url: 'https://sites.google.com', img: 'https://ssl.gstatic.com/atari/images/public/favicon.ico' },
  { name: 'Groups', url: 'https://groups.google.com', img: 'https://www.gstatic.com/images/branding/product/1x/groups_2020q4_48dp.png' },
  { name: 'Admin', url: 'https://admin.google.com', img: 'https://www.gstatic.com/images/branding/product/1x/admin_2020q4_48dp.png' },
  { name: 'Maps', url: 'https://maps.google.com', img: 'https://maps.gstatic.com/mapfiles/maps_lite/images/2x/circle.png' },
  { name: 'YouTube', url: 'https://youtube.com', img: 'https://www.youtube.com/s/desktop/271dfaef/img/favicon_48x48.png' },
  { name: 'Photos', url: 'https://photos.google.com', img: 'https://www.gstatic.com/images/branding/product/1x/photos_2020q4_48dp.png' },
];

function AppIcon({ name, color }) {
  const colors = { Search:'#4285f4', Gmail:'#ea4335', Calendar:'#4285f4', Drive:'#f4b400', Docs:'#4285f4', Sheets:'#0f9d58', Slides:'#f4b400', Meet:'#00897b', Chat:'#1a73e8', Contacts:'#4285f4', Forms:'#673ab7', Keep:'#f4b400', Sites:'#4285f4', Groups:'#4285f4', Admin:'#5f6368', Maps:'#34a853', YouTube:'#ff0000', Photos:'#f4b400' };
  const c = colors[name] || '#4285f4';
  return (
    <div style={{ width: 48, height: 48, borderRadius: 12, background: c + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 700, color: c, fontFamily: "'Google Sans', Roboto, sans-serif" }}>
      {name[0]}
    </div>
  );
}

export default function AppLauncher() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button onClick={() => setOpen(!open)}
        style={{ background: open ? 'rgba(255,255,255,0.2)' : 'none', border: 'none', cursor: 'pointer', padding: 8, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.15s' }}
        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.15)'}
        onMouseLeave={e => { if (!open) e.currentTarget.style.background = 'none'; }}
        title="Google Apps">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="#a8c8e8">
          <rect x="1" y="1" width="6" height="6" rx="1.5"/>
          <rect x="9" y="1" width="6" height="6" rx="1.5"/>
          <rect x="17" y="1" width="6" height="6" rx="1.5"/>
          <rect x="1" y="9" width="6" height="6" rx="1.5"/>
          <rect x="9" y="9" width="6" height="6" rx="1.5"/>
          <rect x="17" y="9" width="6" height="6" rx="1.5"/>
          <rect x="1" y="17" width="6" height="6" rx="1.5"/>
          <rect x="9" y="17" width="6" height="6" rx="1.5"/>
          <rect x="17" y="17" width="6" height="6" rx="1.5"/>
        </svg>
      </button>

      {open && (
        <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 9999, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 60 }}>
          <div onClick={e => e.stopPropagation()} style={{
            width: 380, background: '#fff', borderRadius: 20,
            boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
            padding: '20px 16px 16px', maxHeight: 'calc(100vh - 100px)', overflowY: 'auto',
            animation: 'appIn 0.2s ease'
          }}>
            <style>{\`
              @keyframes appIn { from { opacity:0; transform:scale(0.92) translateY(-12px); } to { opacity:1; transform:scale(1) translateY(0); } }
              .gapp:hover { background: #f1f3f4 !important; }
            \`}</style>
            <div style={{ fontSize: 16, fontWeight: 500, color: '#202124', textAlign: 'center', marginBottom: 16, fontFamily: "'Google Sans', Roboto, sans-serif" }}>
              Google Workspace
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
              {APPS.map(app => (
                <a key={app.name} href={app.url} target="_blank" rel="noopener noreferrer"
                  className="gapp"
                  onClick={() => setOpen(false)}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    gap: 8, padding: '16px 8px', borderRadius: 12, textDecoration: 'none',
                    color: '#3c4043', cursor: 'pointer', background: 'transparent'
                  }}>
                  <img src={app.img} alt={app.name} width="40" height="40"
                    style={{ objectFit: 'contain', borderRadius: 0 }}
                    onError={e => {
                      e.target.style.display = 'none';
                      e.target.nextSibling.style.display = 'flex';
                    }} />
                  <div style={{ display: 'none', width: 40, height: 40, borderRadius: 10,
                    background: '#f1f3f4', alignItems: 'center', justifyContent: 'center',
                    fontSize: 18, fontWeight: 600, color: '#5f6368' }}>
                    {app.name[0]}
                  </div>
                  <span style={{ fontSize: 12, fontFamily: "'Google Sans', Roboto, sans-serif", textAlign: 'center', lineHeight: 1.2, color: '#5f6368' }}>{app.name}</span>
                </a>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
`;

fs.writeFileSync('client/src/components/AppLauncher.jsx', launcher, 'utf8');
console.log('✓ AppLauncher — centered modal, all 18 apps, fallback icons');
console.log('Refresh browser.');
