// fix-2fa-verify.js
const fs = require('fs');
const path = require('path');

const authPath = path.join(__dirname, 'server', 'routes', 'auth.js');
let auth = fs.readFileSync(authPath, 'utf8');

// Replace the confirm-2fa route with one that handles Buffer secrets and logs
auth = auth.replace(
  `router.post('/confirm-2fa', (req, res) => {
  const db = getDb();
  const { code } = req.body;
  if (!req.session.pendingUserId && !req.session.userId) {
    return res.status(400).json({ error: 'No pending 2FA verification' });
  }

  const userId = req.session.pendingUserId || req.session.userId;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user || !user.totp_secret) {
    return res.status(400).json({ error: 'No 2FA secret found. Run setup first.' });
  }

  const verified = speakeasy.totp.verify({
    secret: user.totp_secret,
    encoding: 'base32',
    token: code,
    window: 2,
  });

  if (!verified) {
    return res.status(401).json({ error: 'Invalid code. Make sure your authenticator is synced and try again.' });
  }`,
  `router.post('/confirm-2fa', (req, res) => {
  const db = getDb();
  const { code } = req.body;
  if (!req.session.pendingUserId && !req.session.userId) {
    return res.status(400).json({ error: 'No pending 2FA verification' });
  }

  const userId = req.session.pendingUserId || req.session.userId;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user || !user.totp_secret) {
    return res.status(400).json({ error: 'No 2FA secret found. Run setup first.' });
  }

  // Fix: sql.js may return Buffer/Uint8Array instead of string
  let secret = user.totp_secret;
  if (typeof secret !== 'string') {
    secret = Buffer.from(secret).toString('utf8');
  }

  console.log('[2FA DEBUG] userId:', userId);
  console.log('[2FA DEBUG] secret type:', typeof user.totp_secret, '-> string:', secret);
  console.log('[2FA DEBUG] code entered:', code);
  
  // Generate what the current valid code should be
  const expected = speakeasy.totp({ secret: secret, encoding: 'base32' });
  console.log('[2FA DEBUG] expected code right now:', expected);

  const verified = speakeasy.totp.verify({
    secret: secret,
    encoding: 'base32',
    token: code,
    window: 2,
  });
  console.log('[2FA DEBUG] verified:', verified);

  if (!verified) {
    return res.status(401).json({ error: 'Invalid code. Make sure your authenticator is synced and try again.' });
  }`
);

// Also fix the verify-2fa route (for returning users)
auth = auth.replace(
  `router.post('/verify-2fa', (req, res) => {
  const db = getDb();
  const { code } = req.body;
  if (!req.session.pendingUserId || !req.session.pending2FA) {
    return res.status(400).json({ error: 'No pending 2FA verification' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.pendingUserId);
  if (!user) return res.status(401).json({ error: 'User not found' });

  const verified = speakeasy.totp.verify({
    secret: user.totp_secret,
    encoding: 'base32',
    token: code,
    window: 2,
  });`,
  `router.post('/verify-2fa', (req, res) => {
  const db = getDb();
  const { code } = req.body;
  if (!req.session.pendingUserId || !req.session.pending2FA) {
    return res.status(400).json({ error: 'No pending 2FA verification' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.pendingUserId);
  if (!user) return res.status(401).json({ error: 'User not found' });

  let secret = user.totp_secret;
  if (typeof secret !== 'string') {
    secret = Buffer.from(secret).toString('utf8');
  }

  const verified = speakeasy.totp.verify({
    secret: secret,
    encoding: 'base32',
    token: code,
    window: 2,
  });`
);

fs.writeFileSync(authPath, auth, 'utf8');
console.log('✓ auth.js patched with Buffer fix + debug logging');
console.log('Restart: npm run dev');
console.log('Then try logging in — check the SERVER terminal for [2FA DEBUG] lines');
