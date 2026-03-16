const fs = require('fs');
let auth = fs.readFileSync('server/routes/auth.js', 'utf8');

// Replace verify-2fa entirely
auth = auth.replace(
  /router\.post\('\/verify-2fa'[\s\S]*?^\}\);/m,
  `router.post('/verify-2fa', (req, res) => {
  const db = getDb();
  const { code, email } = req.body;
  console.log('[2FA] verify called, email:', email, 'code:', code);

  let user;
  if (email) user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) {
    const pendingId = req.cookies?.pending2fa;
    if (pendingId) {
      const sess = db.prepare('SELECT * FROM sessions WHERE sid = ? AND expires > ?').get('2fa-' + pendingId, Date.now());
      if (sess) user = db.prepare('SELECT * FROM users WHERE id = ?').get(sess.user_id);
    }
  }
  if (!user) return res.status(401).json({ error: 'User not found' });

  let secret = user.totp_secret;
  if (secret instanceof Uint8Array) secret = Buffer.from(secret).toString('utf8');
  else if (Buffer.isBuffer(secret)) secret = secret.toString('utf8');
  else if (secret != null) secret = String(secret);

  if (!secret) return res.status(400).json({ error: 'No 2FA secret set' });

  const verified = speakeasy.totp.verify({
    secret: secret, encoding: 'base32', token: String(code).trim(), window: 4,
  });
  console.log('[2FA] verify result:', verified);
  if (!verified) return res.status(401).json({ error: 'Invalid code' });

  setSession(res, toStr(user.id));
  res.clearCookie('pending2fa');
  const regions = db.prepare('SELECT region_id FROM user_regions WHERE user_id = ?').all(toStr(user.id));
  res.json({
    step: 'done',
    user: {
      id: toStr(user.id), name: toStr(user.name), email: toStr(user.email),
      role: toStr(user.role), avatar: toStr(user.avatar),
      regionIds: regions.map(r => r.region_id),
    }
  });
});`
);

// Replace confirm-2fa entirely
auth = auth.replace(
  /router\.post\('\/confirm-2fa'[\s\S]*?^\}\);/m,
  `router.post('/confirm-2fa', (req, res) => {
  const db = getDb();
  const { code, email } = req.body;
  console.log('[2FA] confirm called, email:', email, 'code:', code);

  let user;
  if (email) user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) {
    const session = getSession(req);
    if (session) user = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id);
  }
  if (!user) return res.status(401).json({ error: 'User not found' });

  let secret = user.totp_secret;
  if (secret instanceof Uint8Array) secret = Buffer.from(secret).toString('utf8');
  else if (Buffer.isBuffer(secret)) secret = secret.toString('utf8');
  else if (secret != null) secret = String(secret);

  console.log('[2FA] secret exists:', !!secret, 'starts:', secret?.substring(0,8));
  if (!secret) return res.status(400).json({ error: 'No 2FA secret set' });

  const verified = speakeasy.totp.verify({
    secret: secret, encoding: 'base32', token: String(code).trim(), window: 4,
  });
  console.log('[2FA] confirm result:', verified);
  if (!verified) return res.status(401).json({ error: 'Invalid code' });

  db.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(toStr(user.id));
  saveDb();

  setSession(res, toStr(user.id));
  const regions = db.prepare('SELECT region_id FROM user_regions WHERE user_id = ?').all(toStr(user.id));
  res.json({
    step: 'done',
    user: {
      id: toStr(user.id), name: toStr(user.name), email: toStr(user.email),
      role: toStr(user.role), avatar: toStr(user.avatar),
      regionIds: regions.map(r => r.region_id),
    }
  });
});`
);

// Also remove the addAudit reference that doesn't exist in this file
auth = auth.replace(/addAudit\([^)]*\);?\n?/g, '');

// Remove completeLogin references
auth = auth.replace(/completeLogin\([^)]*\);?\n?/g, '');

fs.writeFileSync('server/routes/auth.js', auth, 'utf8');

// Verify
const r = require('./server/routes/auth');
const paths = r.stack.map(l => l.route?.path).filter(Boolean);
console.log('routes:', paths);
console.log('done — reset 2FA and try again');
