// add-logout-btn.js
// Run from the carecoord folder: node add-logout-btn.js

const fs = require('fs');
const path = require('path');

console.log('\n🔧 Adding logout button under username...\n');

const appPath = path.join(__dirname, 'client', 'src', 'App.jsx');
let app = fs.readFileSync(appPath, 'utf8');

// Replace the existing user profile section at bottom of sidebar
// Old: name + role side by side with tiny X button
// New: name + role stacked, with a "Log out" text button underneath

app = app.replace(
  /<div style={{ padding: sidebarCollapsed \? '12px 8px' : '12px 16px', borderTop: '1px solid #1e2030' }}>[\s\S]*?<\/aside>/,
  `<div style={{ padding: sidebarCollapsed ? '12px 8px' : '12px 16px', borderTop: '1px solid #1e2030' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: sidebarCollapsed ? 'center' : 'flex-start', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: sidebarCollapsed ? 'center' : 'flex-start' }}>
              <Avatar user={currentUser} size={28} />
              {!sidebarCollapsed && (
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentUser.name}</div>
                  <div style={{ fontSize: 10, color: '#64748b', textTransform: 'capitalize' }}>{currentUser.role}</div>
                </div>
              )}
            </div>
            {!sidebarCollapsed && (
              <button onClick={handleLogout}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: '#1e2030', border: '1px solid #2a2d3e', borderRadius: 6, color: '#94a3b8', cursor: 'pointer', fontSize: 11, fontWeight: 500, width: '100%', justifyContent: 'center' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#2a2d3e'; e.currentTarget.style.color = '#ef4444'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#1e2030'; e.currentTarget.style.color = '#94a3b8'; }}>
                <Icon name="x" size={12} />
                Log out
              </button>
            )}
            {sidebarCollapsed && (
              <button onClick={handleLogout} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: 4 }} title="Log out">
                <Icon name="x" size={14} />
              </button>
            )}
          </div>
        </div>
      </aside>`
);

fs.writeFileSync(appPath, app, 'utf8');
console.log('  ✓ client/src/App.jsx — logout button added under username');

console.log('\n✅ Done! Restart: Ctrl+C then npm run dev\n');
