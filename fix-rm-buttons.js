const fs = require('fs');
let f = fs.readFileSync('client/src/components/GmailPanel.jsx', 'utf8');

// Replace the connected state rendering - remove the supervisor buttons
f = f.replace(
  `{isSupervisor && (
          <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
            <button onClick={() => !syncing && setShowSetup(true)} disabled={syncing}
              style={{ fontSize: 9, padding: '2px 6px', background: syncing ? '#333' : '#1a5e9a', border: '1px solid #2080c0', borderRadius: 4, color: syncing ? '#666' : '#a8c8e8', cursor: syncing ? 'default' : 'pointer' }}>
              {syncing ? 'Syncing...' : 'Sync Date'}
            </button>
            <button onClick={disconnect}
              style={{ fontSize: 9, padding: '2px 6px', background: '#1a5e9a', border: '1px solid #2080c0', borderRadius: 4, color: '#a8c8e8', cursor: 'pointer' }}>
              Disconnect
            </button>
          </div>
        )}`,
  ``
);

fs.writeFileSync('client/src/components/GmailPanel.jsx', f, 'utf8');
console.log('✓ Removed Sync Date and Disconnect buttons from sidebar');
console.log('  Green dot + email + syncing indicator remain');
