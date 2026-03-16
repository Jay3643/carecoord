const fs = require('fs');

// 1. Fix sidebar header — remove logo, keep text
let app = fs.readFileSync('client/src/App.jsx', 'utf8');

app = app.replace(
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
        </div>`,
  `<div style={{ padding: sidebarCollapsed ? '12px 8px' : '12px 16px', borderBottom: '1px solid #102f54', background: '#143d6b', display: 'flex', alignItems: 'center', gap: 10, minHeight: 64 }}>
          {!sidebarCollapsed && (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, lineHeight: 1.2 }}>
              <span style={{ fontWeight: 700, fontSize: 14, color: '#ffffff', whiteSpace: 'nowrap' }}>Seniority Healthcare</span>
              <span style={{ fontSize: 10, color: '#a8c8e8', fontWeight: 400, letterSpacing: 1, textTransform: 'uppercase' }}>Workspace</span>
            </div>
          )}
          {sidebarCollapsed && (
            <span style={{ fontWeight: 700, fontSize: 16, color: '#ffffff', margin: '0 auto' }}>SH</span>
          )}
          <button onClick={() => setSidebarCollapsed(!sidebarCollapsed)} style={{ background: 'none', border: 'none', color: '#a8c8e8', cursor: 'pointer', padding: 4, flexShrink: 0 }}>
            <Icon name={sidebarCollapsed ? 'chevronRight' : 'arrowLeft'} size={16} />
          </button>
        </div>`
);

fs.writeFileSync('client/src/App.jsx', app, 'utf8');
console.log('✓ Sidebar header — logo removed, text branding kept');

// 2. Remove hello@ from seed
let seed = fs.readFileSync('server/seed.js', 'utf8');

// Remove hello user insert
seed = seed.replace(
  `  db.prepare('INSERT INTO users (id, name, email, role, avatar, password_hash, totp_enabled, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?)')
    .run('u2', 'Hello Coordinator', 'hello@seniorityhealthcare.com', 'coordinator', 'HC', pwHash, now);
  db.prepare('INSERT INTO user_regions (user_id, region_id) VALUES (?, ?)').run('u2', 'r1');
  db.prepare('INSERT INTO user_regions (user_id, region_id) VALUES (?, ?)').run('u2', 'r2');
  db.prepare('INSERT INTO user_regions (user_id, region_id) VALUES (?, ?)').run('u2', 'r3');`,
  ``
);

// Remove hello sync state
seed = seed.replace(
  `  // Sync state for hello@ coordinator
  db.prepare('INSERT INTO email_sync_state (user_id, last_sync_at, sync_start_date) VALUES (?, 0, ?)').run('u2', '2026/03/07');`,
  ``
);

fs.writeFileSync('server/seed.js', seed, 'utf8');
console.log('✓ Seed — hello@ removed, DrHopkins only');
console.log('');
console.log('Now push, then run the bulk-pull in browser console to clear tickets.');
