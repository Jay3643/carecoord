// fix-auth-clean.js
// Rewrites auth.js from scratch with clean 2FA flow

const fs = require('fs');
const path = require('path');

const authPath = path.join(__dirname, 'server', 'routes', 'auth.js');

fs.writeFileSync(authPath, `const express = require('express');
const bcrypt = require('bcryptjs');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const { getDb, saveDb } = require('../database');
const { requireAuth, addAudit } = require('../middleware');
const router = express.Router();

// sql.js can return TEXT columns as Uint8Array — always convert to string
function toStr(val) {
  if (val == null) return null;
  if (typeof val === 'string') return val;
  if (val instanceof Uint8Array || Buffer.isBuffer(val)) return Buffer.from(val).toString('utf8');
  return String(val);
}

// ── Login Step 1: email + password ───────────────────────────────────────────

router.post('/login', async (req, res) => {
  const db = getDb();
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1').get(email.trim().toLowerCase());
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const pwHash = toStr(user.password_hash);

  // Check hashed password
  let passwordValid = false;
  if (pwHash && pwHash.startsWith('$2')) {
    passwordValid = await bcrypt.compare(password, pwHash);
  }

  // Also allow unhashed temp passwords (from admin reset)
  if (!passwordValid && pwHash === password) {
    req.session.pendingUserId = user.id;
    req.session.requirePasswordChange = true;
    return res.json({ step: 'change_password', message: 'You must set a new password' });
  }

  if (!passwordValid) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  // Password is valid — now check 2FA status
  const totpSecret = toStr(user.totp_secret);
  const totpEnabled = Number(user.totp_enabled);

  console.log('[AUTH] Login OK for', email, '| 2FA enabled:', totpEnabled, '| has secret:', !!totpSecret);

  if (totpEnabled && totpSecret) {
    // 2FA is set up and enabled — require code
    req.session.pendingUserId = user.id;
    req.session.pending2FA = true;
    return res.json({ step: '2fa', message: 'Enter your authenticator code' });
  }

  if (!totpSecret) {
    // No 2FA secret at all — require setup
    req.session.pendingUserId = user.id;
    req.session.requireSetup2FA = true;
    return res.json({ step: 'setup_2fa', message: 'You must set up two-factor authentication' });
  }

  // Has secret but not enabled (shouldn't normally happen) — complete login
  completeLogin(req, res, user);
});

// ── Login Step 2: Verify 2FA code ────────────────────────────────────────────

router.post('/verify-2fa', (req, res) => {
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
  console.log('[2FA-VERIFY] code:', codeStr, '| expected:', expected, '| secret:', secret);

  const verified = speakeasy.totp.verify({
    secret: secret,
    encoding: 'base32',
    token: codeStr,
    window: 3,
  });

  if (!verified) {
    return res.status(401).json({ error: 'Invalid code. Try again.' });
  }

  delete req.session.pending2FA;
  completeLogin(req, res, user);
});

// ── Setup 2FA: Generate secret + QR code ─────────────────────────────────────

router.post('/setup-2fa', async (req, res) => {
  const db = getDb();
  if (!req.session.pendingUserId && !req.session.userId) {
    return res.status(400).json({ error: 'Not authenticated' });
  }

  const userId = req.session.pendingUserId || req.session.userId;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(401).json({ error: 'User not found' });

  const secret = speakeasy.generateSecret({
    name: 'Seniority CareCoord (' + toStr(user.email) + ')',
    issuer: 'Seniority Healthcare',
  });

  console.log('[2FA-SETUP] Generated secret for', toStr(user.email), ':', secret.base32);

  db.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').run(secret.base32, userId);
  saveDb();

  const qrUrl = await QRCode.toDataURL(secret.otpauth_url);

  res.json({
    qrCode: qrUrl,
    manualKey: secret.base32,
    message: 'Scan the QR code with your authenticator app',
  });
});

// ── Confirm 2FA setup: verify first code then enable ─────────────────────────

router.post('/confirm-2fa', (req, res) => {
  const db = getDb();
  const { code } = req.body;
  if (!req.session.pendingUserId && !req.session.userId) {
    return res.status(400).json({ error: 'Not authenticated' });
  }

  const userId = req.session.pendingUserId || req.session.userId;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  const secret = toStr(user.totp_secret);

  if (!user || !secret) {
    return res.status(400).json({ error: 'No 2FA secret found. Run setup first.' });
  }

  const codeStr = String(code).trim();
  const expected = speakeasy.totp({ secret: secret, encoding: 'base32' });

  console.log('[2FA-CONFIRM] userId:', userId);
  console.log('[2FA-CONFIRM] secret:', secret);
  console.log('[2FA-CONFIRM] code entered:', codeStr);
  console.log('[2FA-CONFIRM] expected now:', expected);
  console.log('[2FA-CONFIRM] match:', codeStr === expected);

  const verified = speakeasy.totp.verify({
    secret: secret,
    encoding: 'base32',
    token: codeStr,
    window: 3,
  });

  console.log('[2FA-CONFIRM] speakeasy verified:', verified);

  if (!verified) {
    return res.status(401).json({ error: 'Invalid code. Make sure your authenticator is synced and try again.' });
  }

  db.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(userId);
  saveDb();

  addAudit(db, userId, '2fa_enabled', 'user', userId, '2FA enabled for user');

  delete req.session.requireSetup2FA;
  completeLogin(req, res, user);
});

// ── Change password (for temp passwords) ─────────────────────────────────────

router.post('/change-password', async (req, res) => {
  const db = getDb();
  const { newPassword } = req.body;
  if (!req.session.pendingUserId || !req.session.requirePasswordChange) {
    return res.status(400).json({ error: 'No pending password change' });
  }
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const userId = req.session.pendingUserId;
  const hash = await bcrypt.hash(newPassword, 12);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId);
  saveDb();

  delete req.session.requirePasswordChange;
  addAudit(db, userId, 'password_changed', 'user', userId, 'Password changed on first login');

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  const totpSecret = toStr(user.totp_secret);

  if (!totpSecret) {
    req.session.requireSetup2FA = true;
    return res.json({ step: 'setup_2fa', message: 'Now set up two-factor authentication' });
  }

  if (Number(user.totp_enabled)) {
    req.session.pending2FA = true;
    return res.json({ step: '2fa', message: 'Enter your authenticator code' });
  }

  completeLogin(req, res, user);
});

// ── Helper: complete login ───────────────────────────────────────────────────

function completeLogin(req, res, user) {
  const db = getDb();
  const regions = db.prepare('SELECT region_id FROM user_regions WHERE user_id = ?').all(user.id);
  delete req.session.pendingUserId;
  delete req.session.pending2FA;
  delete req.session.requireSetup2FA;
  delete req.session.requirePasswordChange;

  req.session.userId = user.id;
  addAudit(db, user.id, 'login', 'user', user.id, 'User logged in');

  res.json({
    step: 'done',
    user: {
      id: user.id,
      name: toStr(user.name),
      email: toStr(user.email),
      role: toStr(user.role),
      avatar: toStr(user.avatar),
      regionIds: regions.map(r => r.region_id),
    },
  });
}

// ── Logout ───────────────────────────────────────────────────────────────────

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

// ── Me (session check) ──────────────────────────────────────────────────────

router.get('/me', requireAuth, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id, name, email, role, avatar, totp_enabled FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(401).json({ error: 'Not found' });

  const regions = db.prepare('SELECT region_id FROM user_regions WHERE user_id = ?').all(user.id);
  res.json({
    user: {
      id: user.id,
      name: toStr(user.name),
      email: toStr(user.email),
      role: toStr(user.role),
      avatar: toStr(user.avatar),
      totp_enabled: Number(user.totp_enabled),
      regionIds: regions.map(r => r.region_id),
    },
  });
});

module.exports = router;
`, 'utf8');

console.log('✓ server/routes/auth.js — clean rewrite with toStr() everywhere');
console.log('\nRestart: npm run dev');
console.log('Login, then watch server terminal for [AUTH], [2FA-SETUP], [2FA-CONFIRM] logs');
