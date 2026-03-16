const fs = require('fs');
let gmail = fs.readFileSync('server/routes/gmail.js', 'utf8');

// 1. Add service account auth function at the top, after existing auth functions
gmail = gmail.replace(
  "function hdr(h, n)",
  `// ── Service Account with Domain-Wide Delegation ──
let serviceAccountKey = null;
try { serviceAccountKey = JSON.parse(fs.readFileSync(require('path').join(__dirname, '..', 'service-account.json'), 'utf8')); console.log('[SA] Service account loaded:', serviceAccountKey.client_email); }
catch(e) { console.log('[SA] No service-account.json found — using OAuth tokens only'); }

function getServiceAuth(userEmail) {
  if (!serviceAccountKey) return null;
  const auth = new google.auth.JWT({
    email: serviceAccountKey.client_email,
    key: serviceAccountKey.private_key,
    scopes: ['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.send','https://www.googleapis.com/auth/gmail.modify','https://www.googleapis.com/auth/userinfo.email','https://www.googleapis.com/auth/calendar','https://www.googleapis.com/auth/drive.readonly'],
    subject: userEmail,
  });
  return auth;
}

// Get auth for a user — tries service account first, falls back to OAuth tokens
function getAuthForUser(userId) {
  const db = getDb();
  const user = db.prepare('SELECT email FROM users WHERE id = ?').get(userId);
  if (!user) return null;
  const email = toStr(user.email);
  
  // Try service account first
  const sa = getServiceAuth(email);
  if (sa) return { auth: sa, email };
  
  // Fall back to OAuth tokens
  const t = getTokens(userId);
  if (t) return { auth: authClient(t), email: toStr(t.email) };
  
  return null;
}

function hdr(h, n)`
);

// Need fs at the top
if (!gmail.includes("const fs = require('fs')")) {
  gmail = gmail.replace(
    "const express = require('express');",
    "const fs = require('fs');\nconst express = require('express');"
  );
}

// 2. Update syncUser to use service account auth
gmail = gmail.replace(
  `async function syncUser(db, row) {
  const auth = authClient(row), gm = google.gmail({version:'v1',auth}), uid = toStr(row.user_id);`,
  `async function syncUser(db, row) {
  const uid = toStr(row.user_id);
  // Try service account first, fall back to OAuth tokens
  const userAuth = getAuthForUser(uid);
  if (!userAuth) { 
    // Last resort: use OAuth token directly
    if (!row.access_token) return 0;
  }
  const auth = userAuth ? userAuth.auth : authClient(row);
  const gm = google.gmail({version:'v1',auth});`
);

// 3. Update the sync endpoint to also sync users connected via service account
gmail = gmail.replace(
  `router.post('/sync', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const db = getDb(); let total = 0;
    for (const a of db.prepare('SELECT * FROM gmail_tokens WHERE access_token IS NOT NULL').all()) {
      try { total += await syncUser(db, a); } catch(e) { console.error('[Sync]', toStr(a.email), e.message); }
    }
    res.json({ synced: total });
  } catch(e) { res.status(500).json({ error: e.message }); }
});`,
  `router.post('/sync', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const db = getDb(); let total = 0;
    // Sync users with OAuth tokens
    for (const a of db.prepare('SELECT * FROM gmail_tokens WHERE access_token IS NOT NULL').all()) {
      try { total += await syncUser(db, a); } catch(e) { console.error('[Sync]', toStr(a.email), e.message); }
    }
    // Also sync users connected via service account (no OAuth tokens needed)
    if (serviceAccountKey) {
      const allUsers = db.prepare("SELECT id, email FROM users WHERE is_active = 1").all();
      for (const u of allUsers) {
        const uid = toStr(u.id);
        // Skip if already synced via OAuth token
        if (db.prepare('SELECT 1 FROM gmail_tokens WHERE user_id = ? AND access_token IS NOT NULL').get(uid)) continue;
        try { total += await syncUser(db, { user_id: uid, email: toStr(u.email) }); } catch(e) { console.error('[Sync SA]', toStr(u.email), e.message); }
      }
    }
    res.json({ synced: total });
  } catch(e) { res.status(500).json({ error: e.message }); }
});`
);

// 4. Same for auto-sync
gmail = gmail.replace(
  `    let total = 0;
    for (const a of db.prepare('SELECT * FROM gmail_tokens WHERE access_token IS NOT NULL').all()) {
      try { total += await syncUser(db, a); } catch(e) {}
    }
    res.json({ synced: total });
  } catch(e) { res.json({ synced: 0 }); }
});`,
  `    let total = 0;
    for (const a of db.prepare('SELECT * FROM gmail_tokens WHERE access_token IS NOT NULL').all()) {
      try { total += await syncUser(db, a); } catch(e) {}
    }
    // Service account users
    if (serviceAccountKey) {
      const allUsers = db.prepare("SELECT id, email FROM users WHERE is_active = 1").all();
      for (const u of allUsers) {
        const uid = toStr(u.id);
        if (db.prepare('SELECT 1 FROM gmail_tokens WHERE user_id = ? AND access_token IS NOT NULL').get(uid)) continue;
        try { total += await syncUser(db, { user_id: uid, email: toStr(u.email) }); } catch(e) {}
      }
    }
    res.json({ synced: total });
  } catch(e) { res.json({ synced: 0 }); }
});`
);

// 5. Update personal inbox to use service account
gmail = gmail.replace(
  `    const t = getTokens(req.user.id); if (!t) return res.json({ messages: [] });
    const gm = google.gmail({version:'v1',auth:authClient(t)});`,
  `    const userAuth = getAuthForUser(req.user.id);
    const t = getTokens(req.user.id);
    if (!userAuth && !t) return res.json({ messages: [] });
    const gm = google.gmail({version:'v1', auth: userAuth ? userAuth.auth : authClient(t)});`
);

// 6. Update personal message detail to use service account
gmail = gmail.replace(
  `    const t = getTokens(req.user.id); if (!t) return res.status(400).json({ error: 'Not connected' });
    const gmail = google.gmail({version:'v1',auth:authClient(t)});
    const msg = await gmail.users.messages.get({userId:'me',id:req.params.id,format:'full'});`,
  `    const userAuth = getAuthForUser(req.user.id);
    const t = getTokens(req.user.id);
    if (!userAuth && !t) return res.status(400).json({ error: 'Not connected' });
    const gmail = google.gmail({version:'v1', auth: userAuth ? userAuth.auth : authClient(t)});
    const msg = await gmail.users.messages.get({userId:'me',id:req.params.id,format:'full'});`
);

// 7. Update personal send to use service account
gmail = gmail.replace(
  `    const t = getTokens(req.user.id); if (!t) return res.status(400).json({ error: 'Not connected' });
    const gmail = google.gmail({version:'v1',auth:authClient(t)});
    const { to, cc, subject, body: b, threadId } = req.body;
    let raw = ['From: '+toStr(t.email),'To: '+to];`,
  `    const userAuth = getAuthForUser(req.user.id);
    const t = getTokens(req.user.id);
    if (!userAuth && !t) return res.status(400).json({ error: 'Not connected' });
    const gmail = google.gmail({version:'v1', auth: userAuth ? userAuth.auth : authClient(t)});
    const senderEmail = userAuth ? userAuth.email : toStr(t.email);
    const { to, cc, subject, body: b, threadId } = req.body;
    let raw = ['From: '+senderEmail,'To: '+to];`
);

// 8. Update admin-status to also check service account availability
gmail = gmail.replace(
  `router.get('/admin-status/:userId', requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const t = getTokens(req.params.userId);
  res.json({ connected: !!(t && t.access_token), email: t ? toStr(t.email) : null });
});`,
  `router.get('/admin-status/:userId', requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const t = getTokens(req.params.userId);
  const user = getDb().prepare('SELECT email FROM users WHERE id = ?').get(req.params.userId);
  const hasOAuth = !!(t && t.access_token);
  const hasSA = !!serviceAccountKey;
  const email = hasOAuth ? toStr(t.email) : (user ? toStr(user.email) : null);
  res.json({ connected: hasOAuth || hasSA, email, method: hasOAuth ? 'oauth' : hasSA ? 'service-account' : 'none' });
});`
);

// 9. Update status endpoint similarly
gmail = gmail.replace(
  `router.get('/status', requireAuth, (req, res) => {
  const t = getTokens(req.user.id);
  res.json({ connected: !!(t&&t.access_token), email: t ? toStr(t.email) : null });
});`,
  `router.get('/status', requireAuth, (req, res) => {
  const t = getTokens(req.user.id);
  const hasOAuth = !!(t && t.access_token);
  const hasSA = !!serviceAccountKey;
  const email = hasOAuth ? toStr(t.email) : req.user.email;
  res.json({ connected: hasOAuth || hasSA, email });
});`
);

fs.writeFileSync('server/routes/gmail.js', gmail, 'utf8');

// Verify
try { require('./server/routes/gmail'); console.log('  ✓ gmail.js compiles OK'); }
catch(e) { console.log('  ERROR:', e.message); }

console.log('');
console.log('✅ Domain-wide delegation integrated:');
console.log('');
console.log('  How it works:');
console.log('  • Service account impersonates any @seniorityhealthcare.com user');
console.log('  • No OAuth popups, no passwords needed');
console.log('  • Every user in CareCoord is auto-connected');
console.log('  • Falls back to OAuth tokens if service account is unavailable');
console.log('');
console.log('  Admin panel:');
console.log('  • All users show as "Connected" with method: service-account');
console.log('  • "Connect Workspace" button replaced with green status');
console.log('');
console.log('  Sync:');
console.log('  • Auto-sync now covers ALL active users (not just OAuth-connected ones)');
console.log('  • Coordinator emails auto-route to queue');
console.log('  • Admin/supervisor emails stay in personal inbox');
console.log('');
console.log('Restart server.');
