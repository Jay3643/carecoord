const fs = require('fs');

// ═══════════════════════════════════════════════════
// 1. SERVER — Add admin-connect endpoint
// ═══════════════════════════════════════════════════
let gmail = fs.readFileSync('server/routes/gmail.js', 'utf8');

if (!gmail.includes('/admin-connect')) {
  gmail = gmail.replace(
    "router.get('/status', requireAuth,",
    `// ── Admin connects workspace for another user ──
router.get('/admin-auth/:userId', requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const targetUserId = req.params.userId;
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(targetUserId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ authUrl: oauth2().generateAuthUrl({ access_type:'offline', prompt:'consent', state: targetUserId,
    scope:['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.send','https://www.googleapis.com/auth/gmail.modify','https://www.googleapis.com/auth/userinfo.email','https://www.googleapis.com/auth/calendar','https://www.googleapis.com/auth/drive.readonly'] }) });
});

// ── Admin checks workspace status for any user ──
router.get('/admin-status/:userId', requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const t = getTokens(req.params.userId);
  res.json({ connected: !!(t && t.access_token), email: t ? toStr(t.email) : null });
});

// ── Admin disconnects workspace for any user ──
router.post('/admin-disconnect/:userId', requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  getDb().prepare('DELETE FROM gmail_tokens WHERE user_id=?').run(req.params.userId); saveDb();
  res.json({ ok: true });
});

router.get('/status', requireAuth,`
  );
  fs.writeFileSync('server/routes/gmail.js', gmail, 'utf8');
  console.log('  ✓ gmail.js — admin-auth, admin-status, admin-disconnect endpoints');
}

// ═══════════════════════════════════════════════════
// 2. CLIENT API — Add admin workspace methods
// ═══════════════════════════════════════════════════
let api = fs.readFileSync('client/src/api.js', 'utf8');
if (!api.includes('adminConnectWorkspace')) {
  api = api.replace(
    'gmailAuth:',
    `adminConnectWorkspace: (userId) => request('/gmail/admin-auth/' + userId),
  adminWorkspaceStatus: (userId) => request('/gmail/admin-status/' + userId),
  adminDisconnectWorkspace: (userId) => request('/gmail/admin-disconnect/' + userId, { method: 'POST' }),
  gmailAuth:`
  );
  fs.writeFileSync('client/src/api.js', api, 'utf8');
  console.log('  ✓ api.js — admin workspace methods');
}

// ═══════════════════════════════════════════════════
// 3. ADMIN PANEL — Add Connect/Disconnect buttons per user
// ═══════════════════════════════════════════════════
let admin = fs.readFileSync('client/src/components/AdminPanel.jsx', 'utf8');

// Add workspace status tracking
if (!admin.includes('workspaceStatus')) {
  // Add state for tracking workspace status per user
  admin = admin.replace(
    "const [showInactive, setShowInactive] = useState(false);",
    "const [showInactive, setShowInactive] = useState(false);\n  const [workspaceStatus, setWorkspaceStatus] = useState({});"
  );

  // Load workspace status for all users after fetchData
  admin = admin.replace(
    "useEffect(() => { fetchData(); }, []);",
    `useEffect(() => { fetchData(); }, []);

  // Load workspace connection status for all users
  useEffect(() => {
    if (currentUser.role !== 'admin') return;
    users.forEach(u => {
      api.adminWorkspaceStatus(u.id).then(s => {
        setWorkspaceStatus(prev => ({ ...prev, [u.id]: s }));
      }).catch(() => {});
    });
  }, [users]);

  const connectWorkspace = async (userId) => {
    try {
      const data = await api.adminConnectWorkspace(userId);
      const w = window.open(data.authUrl, 'gmail-auth-' + userId, 'width=500,height=600');
      const check = setInterval(() => {
        if (w?.closed) {
          clearInterval(check);
          api.adminWorkspaceStatus(userId).then(s => {
            setWorkspaceStatus(prev => ({ ...prev, [userId]: s }));
            if (s.connected) showToast('Workspace connected for ' + s.email);
          });
        }
      }, 500);
    } catch (e) { showToast(e.message); }
  };

  const disconnectWorkspace = async (userId) => {
    try {
      await api.adminDisconnectWorkspace(userId);
      setWorkspaceStatus(prev => ({ ...prev, [userId]: { connected: false, email: null } }));
      showToast('Workspace disconnected');
    } catch (e) { showToast(e.message); }
  };`
  );

  // Add workspace status indicator and connect/disconnect button to each user card
  // Insert after the Regions button and before Reset PW
  admin = admin.replace(
    `<button onClick={() => setShowRegionAssign(u)} style={s.btnOutline}>Regions</button>
                      <button onClick={() => resetPassword(u)} style={{ ...s.btnOutline, color: '#c9963b', borderColor: '#c9963b40' }}>Reset PW</button>`,
    `<button onClick={() => setShowRegionAssign(u)} style={s.btnOutline}>Regions</button>
                      {currentUser.role === 'admin' && (
                        workspaceStatus[u.id]?.connected ? (
                          <button onClick={() => disconnectWorkspace(u.id)}
                            style={{ ...s.btnOutline, color: '#2e7d32', borderColor: '#2e7d3240', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ade80' }} />
                            {workspaceStatus[u.id]?.email ? workspaceStatus[u.id].email.split('@')[0] : 'Connected'}
                          </button>
                        ) : (
                          <button onClick={() => connectWorkspace(u.id)}
                            style={{ ...s.btnOutline, color: '#1a73e8', borderColor: '#1a73e840' }}>
                            Connect Workspace
                          </button>
                        )
                      )}
                      <button onClick={() => resetPassword(u)} style={{ ...s.btnOutline, color: '#c9963b', borderColor: '#c9963b40' }}>Reset PW</button>`
  );

  fs.writeFileSync('client/src/components/AdminPanel.jsx', admin, 'utf8');
  console.log('  ✓ AdminPanel — Connect/Disconnect Workspace per user');
}

// Verify server
try { require('./server/routes/gmail'); console.log('  ✓ gmail.js compiles OK'); }
catch(e) { console.log('  ERROR:', e.message); }

console.log('');
console.log('✅ Admin Workspace Connection:');
console.log('');
console.log('  In Admin → Users tab, each user now shows:');
console.log('  • Green dot + email prefix if connected');
console.log('  • "Connect Workspace" button if not connected');
console.log('  • Click Connect → OAuth popup → admin signs in AS that user');
console.log('  • Click connected button → disconnects');
console.log('');
console.log('  Only admins see these buttons.');
console.log('  The GmailConnectButton in sidebar still works for self-connect.');
console.log('');
console.log('Restart server and refresh browser.');
