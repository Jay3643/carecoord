const fs = require('fs');

// 1. Add sessions table to database.js
let db = fs.readFileSync('server/database.js', 'utf8');
if (!db.includes('sessions')) {
  db = db.replace(
    "r('CREATE TABLE IF NOT EXISTS email_sync_state",
    "r('CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, user_id TEXT, expires INTEGER)');\n  r('CREATE TABLE IF NOT EXISTS email_sync_state"
  );
  fs.writeFileSync('server/database.js', db, 'utf8');
  console.log('  ✓ database.js — sessions table added');
}

// 2. Update auth.js to use DB-backed sessions via a cookie token
let auth = fs.readFileSync('server/routes/auth.js', 'utf8');

// Replace the full auth file with token-based approach
fs.writeFileSync('server/routes/auth.js', `const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const { getDb, saveDb } = require('../database');
const router = express.Router();

function toStr(v) { if (v instanceof Uint8Array) return Buffer.from(v).toString('utf8'); return v == null ? null : String(v); }

function setSession(res, userId) {
  const db = getDb();
  const sid = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
  db.prepare('INSERT OR REPLACE INTO sessions (sid, user_id, expires) VALUES (?, ?, ?)').run(sid, userId, expires);
  saveDb();
  res.cookie('sid', sid, { httpOnly: true, maxAge: 24*60*60*1000, sameSite: 'lax', secure: false });
  return sid;
}

function getSession(req) {
  const sid = req.cookies?.sid;
  if (!sid) return null;
  const db = getDb();
  const session = db.prepare('SELECT * FROM sessions WHERE sid = ? AND expires > ?').get(sid, Date.now());
  if (!session) return null;
  return session;
}

function clearSession(req, res) {
  const sid = req.cookies?.sid;
  if (sid) {
    try { getDb().prepare('DELETE FROM sessions WHERE sid = ?').run(sid); saveDb(); } catch(e) {}
  }
  res.clearCookie('sid');
}

router.post('/login', async (req, res) => {
  const db = getDb();
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1').get(email);
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });

  const hash = toStr(user.password_hash);
  let valid = false;
  if (hash && hash.startsWith('$2')) {
    valid = await bcrypt.compare(password, hash);
  } else {
    valid = (password === hash);
  }
  if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

  const totp = toStr(user.totp_enabled);
  if (totp === '1' || totp === 'true') {
    // Store pending 2FA in a temp session
    const sid = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT OR REPLACE INTO sessions (sid, user_id, expires) VALUES (?, ?, ?)').run('2fa-' + sid, toStr(user.id), Date.now() + 300000);
    saveDb();
    res.cookie('pending2fa', sid, { httpOnly: true, maxAge: 300000, sameSite: 'lax', secure: false });
    return res.json({ requires2FA: true });
  }

  setSession(res, toStr(user.id));
  res.json({ success: true });
});

router.post('/verify-2fa', (req, res) => {
  const db = getDb();
  const pendingId = req.cookies?.pending2fa;
  if (!pendingId) return res.status(401).json({ error: 'No pending 2FA' });

  const session = db.prepare('SELECT * FROM sessions WHERE sid = ? AND expires > ?').get('2fa-' + pendingId, Date.now());
  if (!session) return res.status(401).json({ error: 'Session expired' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id);
  if (!user) return res.status(401).json({ error: 'User not found' });

  const verified = speakeasy.totp.verify({
    secret: toStr(user.totp_secret),
    encoding: 'base32',
    token: String(req.body.code),
    window: 2,
  });

  if (!verified) return res.status(401).json({ error: 'Invalid code' });

  // Clean up pending session
  db.prepare('DELETE FROM sessions WHERE sid = ?').run('2fa-' + pendingId);
  res.clearCookie('pending2fa');

  setSession(res, toStr(user.id));
  const regions = db.prepare('SELECT region_id FROM user_regions WHERE user_id = ?').all(toStr(user.id));
  res.json({
    user: {
      id: toStr(user.id), name: toStr(user.name), email: toStr(user.email),
      role: toStr(user.role), avatar: toStr(user.avatar),
      regionIds: regions.map(r => r.region_id),
    }
  });
});

router.post('/setup-2fa', (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated' });

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id);
  const secret = speakeasy.generateSecret({ name: 'CareCoord (' + toStr(user.email) + ')' });
  db.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').run(secret.base32, session.user_id);
  saveDb();

  QRCode.toDataURL(secret.otpauth_url, (err, url) => {
    res.json({ qrCode: url, secret: secret.base32 });
  });
});

router.post('/confirm-2fa', (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated' });

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id);
  const verified = speakeasy.totp.verify({
    secret: toStr(user.totp_secret),
    encoding: 'base32',
    token: String(req.body.code),
    window: 2,
  });

  if (!verified) return res.status(400).json({ error: 'Invalid code' });
  db.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(session.user_id);
  saveDb();

  const regions = db.prepare('SELECT region_id FROM user_regions WHERE user_id = ?').all(session.user_id);
  res.json({
    user: {
      id: toStr(user.id), name: toStr(user.name), email: toStr(user.email),
      role: toStr(user.role), avatar: toStr(user.avatar),
      regionIds: regions.map(r => r.region_id),
    }
  });
});

router.get('/me', (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated' });

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id);
  if (!user) return res.status(401).json({ error: 'User not found' });

  const regions = db.prepare('SELECT region_id FROM user_regions WHERE user_id = ?').all(session.user_id);
  res.json({
    user: {
      id: toStr(user.id), name: toStr(user.name), email: toStr(user.email),
      role: toStr(user.role), avatar: toStr(user.avatar),
      regionIds: regions.map(r => r.region_id),
    }
  });
});

router.post('/logout', (req, res) => {
  clearSession(req, res);
  res.json({ success: true });
});

router.post('/change-password', async (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated' });

  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const hash = await bcrypt.hash(newPassword, 12);
  getDb().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, session.user_id);
  saveDb();
  res.json({ success: true });
});

module.exports = router;
`, 'utf8');
console.log('  ✓ auth.js — rewritten with DB-backed sessions');

// 3. Update middleware.js to use cookie-based auth
let mw = fs.readFileSync('server/middleware.js', 'utf8');
fs.writeFileSync('server/middleware.js', `const { getDb, saveDb } = require('./database');

function toStr(v) { if (v instanceof Uint8Array) return Buffer.from(v).toString('utf8'); return v == null ? null : String(v); }

function requireAuth(req, res, next) {
  const sid = req.cookies?.sid;
  if (!sid) return res.status(401).json({ error: 'Not authenticated' });

  const db = getDb();
  const session = db.prepare('SELECT * FROM sessions WHERE sid = ? AND expires > ?').get(sid, Date.now());
  if (!session) return res.status(401).json({ error: 'Session expired' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id);
  if (!user) return res.status(401).json({ error: 'User not found' });

  const regions = db.prepare('SELECT region_id FROM user_regions WHERE user_id = ?').all(session.user_id);
  req.user = {
    id: toStr(user.id), name: toStr(user.name), email: toStr(user.email),
    role: toStr(user.role), regionIds: regions.map(r => r.region_id),
  };
  next();
}

function requireSupervisor(req, res, next) {
  if (req.user && (req.user.role === 'supervisor' || req.user.role === 'admin')) return next();
  res.status(403).json({ error: 'Forbidden' });
}

function addAudit(db, userId, action, entityType, entityId, detail) {
  try {
    const { v4: uuid } = require('uuid');
    db.prepare('INSERT INTO audit_log (id, actor_user_id, action_type, entity_type, entity_id, ts, detail) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(uuid(), userId, action, entityType, entityId, Date.now(), detail);
    saveDb();
  } catch(e) { console.error('[Audit]', e.message); }
}

module.exports = { requireAuth, requireSupervisor, addAudit, toStr };
`, 'utf8');
console.log('  ✓ middleware.js — uses cookie-based auth');

// 4. Add cookie-parser to index.js
let index = fs.readFileSync('server/index.js', 'utf8');
if (!index.includes('cookie-parser')) {
  index = index.replace(
    "const cors = require('cors');",
    "const cors = require('cors');\nconst cookieParser = require('cookie-parser');"
  );
  index = index.replace(
    "app.use(express.json({ limit: '10mb' }));",
    "app.use(express.json({ limit: '10mb' }));\napp.use(cookieParser());"
  );
  fs.writeFileSync('server/index.js', index, 'utf8');
  console.log('  ✓ index.js — cookie-parser added');
}

console.log('\nNow install cookie-parser:');
console.log('  cd server && npm install cookie-parser && cd ..');
console.log('Then: del server\\carecoord.db && npm run seed && npm run dev');
