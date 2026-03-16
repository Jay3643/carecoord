const fs = require('fs');

// 1. Update GmailConnectButton to show date picker for supervisors
let panel = fs.readFileSync('client/src/components/GmailPanel.jsx', 'utf8');

// Rewrite the GmailConnectButton component
const newPanel = `import React, { useState } from 'react';
import { api } from '../api';

export function GmailConnectButton({ showToast, currentUser }) {
  const [connecting, setConnecting] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [syncDate, setSyncDate] = useState('2026-03-01');
  const [connected, setConnected] = useState(null);
  const [connectedEmail, setConnectedEmail] = useState('');

  const isSupervisor = currentUser?.role === 'supervisor' || currentUser?.role === 'admin';

  React.useEffect(() => {
    api.gmailStatus().then(s => {
      setConnected(s.connected);
      setConnectedEmail(s.email || '');
    }).catch(() => {});
  }, []);

  const startConnect = () => {
    if (!isSupervisor) {
      showToast?.('Only supervisors can connect Google Workspace');
      return;
    }
    setShowSetup(true);
  };

  const doConnect = async () => {
    setConnecting(true);
    try {
      // Save the sync start date first
      await fetch('/api/gmail/set-sync-date', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ syncDate: syncDate.replace(/-/g, '/') })
      });
      
      // Then start OAuth
      const data = await api.gmailAuth();
      const w = window.open(data.authUrl, 'gmail-auth', 'width=500,height=600');
      const check = setInterval(() => {
        if (w?.closed) {
          clearInterval(check);
          setConnecting(false);
          setShowSetup(false);
          api.gmailStatus().then(s => {
            setConnected(s.connected);
            setConnectedEmail(s.email || '');
            if (s.connected) {
              showToast?.('Google Workspace connected! Syncing emails from ' + syncDate + '...');
              // Trigger initial sync
              fetch('/api/gmail/sync', { method: 'POST', credentials: 'include' });
            }
          });
        }
      }, 500);
    } catch (e) {
      showToast?.(e.message);
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    if (!isSupervisor) { showToast?.('Only supervisors can disconnect'); return; }
    try { await api.gmailDisconnect(); setConnected(false); setConnectedEmail(''); showToast?.('Disconnected'); }
    catch (e) { showToast?.(e.message); }
  };

  const updateSyncDate = async () => {
    if (!isSupervisor) { showToast?.('Only supervisors can change sync date'); return; }
    try {
      await fetch('/api/gmail/set-sync-date', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ syncDate: syncDate.replace(/-/g, '/'), resetSync: true })
      });
      showToast?.('Sync date updated to ' + syncDate + '. Re-syncing...');
      fetch('/api/gmail/sync', { method: 'POST', credentials: 'include' });
    } catch (e) { showToast?.(e.message); }
  };

  if (connected === null) return null;

  if (connected) {
    return (
      <div style={{ fontSize: 10, marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#a8c8e8' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ade80', flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{connectedEmail}</span>
        </div>
        {isSupervisor && (
          <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
            <button onClick={() => setShowSetup(true)}
              style={{ fontSize: 9, padding: '2px 6px', background: '#1a5e9a', border: '1px solid #2080c0', borderRadius: 4, color: '#a8c8e8', cursor: 'pointer' }}>
              Sync Date
            </button>
            <button onClick={disconnect}
              style={{ fontSize: 9, padding: '2px 6px', background: '#1a5e9a', border: '1px solid #2080c0', borderRadius: 4, color: '#a8c8e8', cursor: 'pointer' }}>
              Disconnect
            </button>
          </div>
        )}
        {showSetup && isSupervisor && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}
            onClick={() => setShowSetup(false)}>
            <div onClick={e => e.stopPropagation()}
              style={{ background: '#fff', borderRadius: 12, padding: 24, width: 380, boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, color: '#1e3a4f', margin: '0 0 16px' }}>Change Sync Start Date</h3>
              <p style={{ fontSize: 13, color: '#5f6368', margin: '0 0 12px' }}>
                Emails after this date will be synced to the Regional Queue. Emails before this date stay in the personal inbox only.
              </p>
              <input type="date" value={syncDate} onChange={e => setSyncDate(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', border: '1px solid #dadce0', borderRadius: 8, fontSize: 14, marginBottom: 16, boxSizing: 'border-box' }} />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => setShowSetup(false)}
                  style={{ padding: '8px 20px', background: '#f0f4f9', border: '1px solid #dadce0', borderRadius: 8, cursor: 'pointer', fontSize: 13, color: '#5f6368' }}>
                  Cancel
                </button>
                <button onClick={updateSyncDate}
                  style={{ padding: '8px 20px', background: '#1a73e8', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, color: '#fff', fontWeight: 600 }}>
                  Update & Re-sync
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <button onClick={startConnect} disabled={connecting || !isSupervisor}
        style={{ fontSize: 10, padding: '3px 8px', background: isSupervisor ? '#102f54' : '#333', border: '1px solid #2080c0', borderRadius: 4, color: isSupervisor ? '#a8c8e8' : '#888', cursor: isSupervisor ? 'pointer' : 'default', marginBottom: 4 }}>
        {isSupervisor ? 'Connect Workspace' : 'Supervisor Required'}
      </button>
      {showSetup && isSupervisor && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}
          onClick={() => setShowSetup(false)}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 12, padding: 24, width: 400, boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
            <h3 style={{ fontSize: 18, fontWeight: 600, color: '#1e3a4f', margin: '0 0 8px' }}>Connect Google Workspace</h3>
            <p style={{ fontSize: 13, color: '#5f6368', margin: '0 0 20px', lineHeight: 1.5 }}>
              Choose a start date for email syncing. All emails received <strong>after</strong> this date will automatically route to the Regional Queue as tickets. Emails before this date will remain in the personal inbox.
            </p>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#1e3a4f', display: 'block', marginBottom: 6 }}>Sync emails starting from:</label>
            <input type="date" value={syncDate} onChange={e => setSyncDate(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', border: '1px solid #dadce0', borderRadius: 8, fontSize: 14, marginBottom: 20, boxSizing: 'border-box' }} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowSetup(false)}
                style={{ padding: '10px 20px', background: '#f0f4f9', border: '1px solid #dadce0', borderRadius: 8, cursor: 'pointer', fontSize: 13, color: '#5f6368' }}>
                Cancel
              </button>
              <button onClick={doConnect} disabled={connecting}
                style={{ padding: '10px 20px', background: '#1a73e8', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, color: '#fff', fontWeight: 600, opacity: connecting ? 0.7 : 1 }}>
                {connecting ? 'Connecting...' : 'Connect & Sync'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
`;

fs.writeFileSync('client/src/components/GmailPanel.jsx', newPanel, 'utf8');
console.log('  ✓ GmailPanel.jsx — supervisor-only with date picker');

// 2. Pass currentUser to GmailConnectButton in App.jsx
let app = fs.readFileSync('client/src/App.jsx', 'utf8');
app = app.replace(
  '<GmailConnectButton showToast={showToast} />',
  '<GmailConnectButton showToast={showToast} currentUser={currentUser} />'
);
fs.writeFileSync('client/src/App.jsx', app, 'utf8');
console.log('  ✓ App.jsx — passes currentUser to GmailConnectButton');

// 3. Add server endpoint to set sync date
let gmail = fs.readFileSync('server/routes/gmail.js', 'utf8');

if (!gmail.includes('set-sync-date')) {
  gmail = gmail.replace(
    "// ── Sync into regional queue ──",
    `// ── Set sync start date (supervisor only) ──
router.post('/set-sync-date', requireAuth, (req, res) => {
  if (req.user.role !== 'supervisor' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Supervisor access required' });
  }
  const { syncDate, resetSync } = req.body;
  if (!syncDate) return res.status(400).json({ error: 'syncDate required' });
  
  const db = getDb();
  const existing = db.prepare('SELECT * FROM email_sync_state WHERE user_id=?').get(req.user.id);
  if (existing) {
    if (resetSync) {
      db.prepare('UPDATE email_sync_state SET sync_start_date=?, last_sync_at=0 WHERE user_id=?').run(syncDate, req.user.id);
    } else {
      db.prepare('UPDATE email_sync_state SET sync_start_date=? WHERE user_id=?').run(syncDate, req.user.id);
    }
  } else {
    db.prepare('INSERT INTO email_sync_state (user_id, last_sync_at, sync_start_date) VALUES (?, 0, ?)').run(req.user.id, syncDate);
  }
  saveDb();
  console.log('[Sync] Start date set to', syncDate, 'for user', req.user.id, resetSync ? '(reset)' : '');
  res.json({ ok: true, syncDate });
});

// ── Sync into regional queue ──`
  );
  fs.writeFileSync('server/routes/gmail.js', gmail, 'utf8');
  console.log('  ✓ gmail.js — /set-sync-date endpoint added');
}

// 4. Also update the personal inbox cutoff to use the dynamic sync_start_date
gmail = fs.readFileSync('server/routes/gmail.js', 'utf8');
gmail = gmail.replace(
  "// Only show emails from before 3/1/2026 in personal inbox — newer ones go to queue\n    const cutoffDate = '2026/03/01';",
  "// Only show emails before the sync start date in personal inbox\n    const syncState = getDb().prepare('SELECT sync_start_date FROM email_sync_state WHERE user_id=?').get(req.user.id);\n    const cutoffDate = syncState?.sync_start_date || '2026/03/01';"
);
fs.writeFileSync('server/routes/gmail.js', gmail, 'utf8');
console.log('  ✓ gmail.js — personal inbox cutoff uses dynamic sync date');

// Verify
try { require('./server/routes/gmail'); console.log('  ✓ gmail.js compiles OK'); }
catch(e) { console.log('  ERROR:', e.message); }

console.log('');
console.log('Done. Restart server and refresh browser.');
console.log('');
console.log('Flow:');
console.log('  1. Supervisor clicks "Connect Workspace"');
console.log('  2. Date picker appears: "Sync emails starting from: [date]"');
console.log('  3. Click "Connect & Sync" → OAuth → auto-sync starts');
console.log('  4. Supervisor can change date later via "Sync Date" button');
console.log('  5. Non-supervisors see "Supervisor Required" (greyed out)');
