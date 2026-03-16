const fs = require('fs');
let f = fs.readFileSync('client/src/components/GmailPanel.jsx', 'utf8');

// Add syncing state
f = f.replace(
  "const [connectedEmail, setConnectedEmail] = useState('');",
  "const [connectedEmail, setConnectedEmail] = useState('');\n  const [syncing, setSyncing] = useState(false);"
);

// Update the updateSyncDate function to track sync progress
f = f.replace(
  `const updateSyncDate = async () => {
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
  };`,
  `const updateSyncDate = async () => {
    if (!isSupervisor) { showToast?.('Only supervisors can change sync date'); return; }
    setSyncing(true);
    try {
      await fetch('/api/gmail/set-sync-date', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ syncDate: syncDate.replace(/-/g, '/'), resetSync: true })
      });
      showToast?.('Sync started from ' + syncDate);
      const res = await fetch('/api/gmail/sync', { method: 'POST', credentials: 'include' });
      const data = await res.json();
      showToast?.(data.synced + ' emails synced to queue');
    } catch (e) { showToast?.(e.message); }
    finally { setSyncing(false); }
  };`
);

// Also track syncing state in the initial connect flow
f = f.replace(
  `if (s.connected) {
              showToast?.('Google Workspace connected! Syncing emails from ' + syncDate + '...');
              // Trigger initial sync
              fetch('/api/gmail/sync', { method: 'POST', credentials: 'include' });
            }`,
  `if (s.connected) {
              showToast?.('Google Workspace connected! Syncing emails from ' + syncDate + '...');
              setSyncing(true);
              fetch('/api/gmail/sync', { method: 'POST', credentials: 'include' })
                .then(r => r.json())
                .then(d => { showToast?.(d.synced + ' emails synced to queue'); })
                .catch(() => {})
                .finally(() => setSyncing(false));
            }`
);

// Update the modal "Update & Re-sync" button to show syncing state
f = f.replace(
  `<button onClick={updateSyncDate}
                  style={{ padding: '8px 20px', background: '#1a73e8', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, color: '#fff', fontWeight: 600 }}>
                  Update & Re-sync
                </button>`,
  `<button onClick={updateSyncDate} disabled={syncing}
                  style={{ padding: '8px 20px', background: syncing ? '#94a3b8' : '#1a73e8', border: 'none', borderRadius: 8, cursor: syncing ? 'default' : 'pointer', fontSize: 13, color: '#fff', fontWeight: 600, opacity: syncing ? 0.7 : 1 }}>
                  {syncing ? 'Syncing in progress...' : 'Update & Re-sync'}
                </button>`
);

// Add syncing indicator next to connected email
f = f.replace(
  `<span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{connectedEmail}</span>`,
  `<span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{connectedEmail}</span>
          {syncing && <span style={{ fontSize: 9, color: '#4ade80', animation: 'pulse 1.5s infinite' }}>syncing...</span>}`
);

// Add pulse animation
f = f.replace(
  'export function GmailConnectButton',
  `const pulseStyle = document.createElement('style');
pulseStyle.textContent = '@keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.4 } }';
if (!document.querySelector('[data-pulse]')) { pulseStyle.setAttribute('data-pulse', ''); document.head.appendChild(pulseStyle); }

export function GmailConnectButton`
);

// Disable the "Sync Date" button while syncing
f = f.replace(
  `<button onClick={() => setShowSetup(true)}
              style={{ fontSize: 9, padding: '2px 6px', background: '#1a5e9a', border: '1px solid #2080c0', borderRadius: 4, color: '#a8c8e8', cursor: 'pointer' }}>
              Sync Date`,
  `<button onClick={() => !syncing && setShowSetup(true)} disabled={syncing}
              style={{ fontSize: 9, padding: '2px 6px', background: syncing ? '#333' : '#1a5e9a', border: '1px solid #2080c0', borderRadius: 4, color: syncing ? '#666' : '#a8c8e8', cursor: syncing ? 'default' : 'pointer' }}>
              {syncing ? 'Syncing...' : 'Sync Date'}`
);

// Add syncing message in the modal
f = f.replace(
  `<p style={{ fontSize: 13, color: '#5f6368', margin: '0 0 12px' }}>
                Emails after this date will be synced to the Regional Queue as tickets. Emails before this date stay in the personal inbox only.
              </p>`,
  `<p style={{ fontSize: 13, color: '#5f6368', margin: '0 0 12px' }}>
                Emails after this date will be synced to the Regional Queue as tickets. Emails before this date stay in the personal inbox only.
              </p>
              {syncing && (
                <div style={{ padding: '10px 12px', background: '#e8f5e9', borderRadius: 8, marginBottom: 12, fontSize: 13, color: '#2e7d32', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ animation: 'pulse 1.5s infinite' }}>●</span>
                  Sync in progress — this may take several minutes for large mailboxes. Please wait...
                </div>
              )}`
);

fs.writeFileSync('client/src/components/GmailPanel.jsx', f, 'utf8');
console.log('✓ GmailPanel — sync-in-progress UI added');
console.log('  • "Update & Re-sync" greys out during sync');
console.log('  • "Sync Date" button shows "Syncing..." and is disabled');
console.log('  • Green "syncing..." indicator next to email');
console.log('  • Progress message in modal');
console.log('  • Cancel button stays active');
console.log('Refresh browser.');
