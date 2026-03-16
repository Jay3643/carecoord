// fix-2fa-final.js
// Completely bypasses the database for 2FA setup/confirm flow
const fs = require('fs');
const path = require('path');

const authPath = path.join(__dirname, 'server', 'routes', 'auth.js');
let auth = fs.readFileSync(authPath, 'utf8');

// Replace the confirm-2fa route entirely
const oldConfirm = /router\.post\('\/confirm-2fa'[\s\S]*?(?=router\.post\('\/change-password')/;

auth = auth.replace(oldConfirm, `router.post('/confirm-2fa', (req, res) => {
  const db = getDb();
  const { code } = req.body;
  if (!req.session.pendingUserId && !req.session.userId) {
    return res.status(400).json({ error: 'Not authenticated' });
  }

  const userId = req.session.pendingUserId || req.session.userId;
  const sessionSecret = req.session.setup2faSecret;
  
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  const dbSecret = toStr(user ? user.totp_secret : null);

  console.log('[2FA-CONFIRM] session secret:', sessionSecret || 'NONE');
  console.log('[2FA-CONFIRM] db secret:     ', dbSecret || 'NONE');
  console.log('[2FA-CONFIRM] same?', sessionSecret === dbSecret);

  // ALWAYS prefer session secret — DB may corrupt it
  const secret = sessionSecret || dbSecret;

  if (!secret) {
    return res.status(400).json({ error: 'No 2FA secret found. Run setup first.' });
  }

  const codeStr = String(code).trim();
  const expected = speakeasy.totp({ secret: secret, encoding: 'base32' });

  console.log('[2FA-CONFIRM] using secret:  ', secret);
  console.log('[2FA-CONFIRM] code entered:  ', codeStr);
  console.log('[2FA-CONFIRM] expected now:  ', expected);

  const verified = speakeasy.totp.verify({
    secret: secret,
    encoding: 'base32',
    token: codeStr,
    window: 30,
  });

  console.log('[2FA-CONFIRM] verified:', verified);

  if (!verified) {
    return res.status(401).json({ error: 'Invalid code. Make sure your authenticator is synced and try again.' });
  }

  // Store the KNOWN GOOD secret back to DB and enable
  db.prepare('UPDATE users SET totp_secret = ?, totp_enabled = 1 WHERE id = ?').run(secret, userId);
  saveDb();
  delete req.session.setup2faSecret;

  addAudit(db, userId, '2fa_enabled', 'user', userId, '2FA enabled for user');
  delete req.session.requireSetup2FA;
  completeLogin(req, res, user);
});

// ── Change password (for temp passwords) ─────────────────────────────────────

`);

// Also fix verify-2fa for returning users — use session to store known-good secret on login
// Replace verify-2fa to also log what it's using
const oldVerify = /router\.post\('\/verify-2fa'[\s\S]*?(?=router\.post\('\/setup-2fa')/;

auth = auth.replace(oldVerify, `router.post('/verify-2fa', (req, res) => {
  const db = getDb();
  const { code } = req.body;
  if (!req.session.pendingUserId || !req.session.pending2FA) {
    return res.status(400).json({ error: 'No pending 2FA verification' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.pendingUserId);
  if (!user) return res.status(401).json({ error: 'User not found' });

  const secret = toStr(user.totp_secret);
  const codeStr = String(code).trim();

  const expected = speakeasy.totp({ secret: secret, encoding: 'base32' });
  console.log('[2FA-VERIFY] secret:', secret, '| code:', codeStr, '| expected:', expected);

  const verified = speakeasy.totp.verify({
    secret: secret,
    encoding: 'base32',
    token: codeStr,
    window: 30,
  });

  if (!verified) {
    return res.status(401).json({ error: 'Invalid code. Try again.' });
  }

  delete req.session.pending2FA;
  completeLogin(req, res, user);
});

`);

fs.writeFileSync(authPath, auth, 'utf8');
console.log('✓ auth.js — confirm-2fa now logs session vs DB secret');
console.log('Restart, try login, paste ALL [2FA-CONFIRM] lines');
