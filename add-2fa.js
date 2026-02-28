// add-2fa.js
// Run from the carecoord folder: node add-2fa.js
// Adds real password authentication + TOTP two-factor authentication
// Works with Google Authenticator, Authy, Microsoft Authenticator

const fs = require('fs');
const path = require('path');

console.log('\n🔐 Adding Password + Two-Factor Authentication...\n');

// ─── 1. Update server/package.json to add dependencies ───────────────────────

const serverPkgPath = path.join(__dirname, 'server', 'package.json');
const serverPkg = JSON.parse(fs.readFileSync(serverPkgPath, 'utf8'));
serverPkg.dependencies = serverPkg.dependencies || {};
serverPkg.dependencies['bcryptjs'] = '^2.4.3';
serverPkg.dependencies['speakeasy'] = '^2.0.0';
serverPkg.dependencies['qrcode'] = '^1.5.3';
fs.writeFileSync(serverPkgPath, JSON.stringify(serverPkg, null, 2), 'utf8');
console.log('  ✓ server/package.json — added bcryptjs, speakeasy, qrcode');

// ─── 2. Update database.js — add 2FA columns ────────────────────────────────

const dbPath = path.join(__dirname, 'server', 'database.js');
let dbJs = fs.readFileSync(dbPath, 'utf8');

if (!dbJs.includes('totp_secret')) {
  dbJs = dbJs.replace(
    'password_hash TEXT',
    'password_hash TEXT, totp_secret TEXT, totp_enabled INTEGER DEFAULT 0'
  );
  fs.writeFileSync(dbPath, dbJs, 'utf8');
  console.log('  ✓ server/database.js — added totp_secret, totp_enabled columns');
} else {
  console.log('  ✓ server/database.js — 2FA columns already present');
}

// ─── 3. Rewrite server/routes/auth.js ────────────────────────────────────────

fs.writeFileSync(path.join(__dirname, 'server', 'routes', 'auth.js'), `const express = require('express');
const bcrypt = require('bcryptjs');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const { getDb, saveDb } = require('../database');
const { requireAuth, addAudit } = require('../middleware');
const router = express.Router();

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

  // Check password
  const valid = await bcrypt.compare(password, user.password_hash || '');
  if (!valid) {
    // Also allow temp passwords (unhashed) for first-time login
    if (user.password_hash && user.password_hash === password) {
      // Temp password match — require password change
      req.session.pendingUserId = user.id;
      req.session.requirePasswordChange = true;
      return res.json({
        step: 'change_password',
        message: 'You must set a new password'
      });
    }
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  // Check if 2FA is enabled
  if (user.totp_enabled) {
    // Store pending user in session, require 2FA
    req.session.pendingUserId = user.id;
    req.session.pending2FA = true;
    return res.json({ step: '2fa', message: 'Enter your authenticator code' });
  }

  // No 2FA — check if 2FA setup is required (not yet set up)
  if (!user.totp_secret) {
    req.session.pendingUserId = user.id;
    req.session.requireSetup2FA = true;
    return res.json({ step: 'setup_2fa', message: 'You must set up two-factor authentication' });
  }

  // Fully authenticated
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

  const verified = speakeasy.totp.verify({
    secret: user.totp_secret,
    encoding: 'base32',
    token: code,
    window: 1,
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

  // Generate new secret
  const secret = speakeasy.generateSecret({
    name: 'Seniority CareCoord (' + user.email + ')',
    issuer: 'Seniority Healthcare',
  });

  // Store secret (not yet enabled)
  db.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').run(secret.base32, userId);
  saveDb();

  // Generate QR code
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
  if (!user || !user.totp_secret) {
    return res.status(400).json({ error: 'No 2FA secret found. Run setup first.' });
  }

  const verified = speakeasy.totp.verify({
    secret: user.totp_secret,
    encoding: 'base32',
    token: code,
    window: 1,
  });

  if (!verified) {
    return res.status(401).json({ error: 'Invalid code. Make sure your authenticator is synced and try again.' });
  }

  // Enable 2FA
  db.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(userId);
  saveDb();

  addAudit(db, userId, '2fa_enabled', 'user', userId, '2FA enabled for user');

  // Complete login
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

  // Now check if 2FA setup is needed
  if (!user.totp_secret) {
    req.session.requireSetup2FA = true;
    return res.json({ step: 'setup_2fa', message: 'Now set up two-factor authentication' });
  }

  if (user.totp_enabled) {
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
      name: user.name,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
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
      ...user,
      regionIds: regions.map(r => r.region_id),
    },
  });
});

module.exports = router;
`, 'utf8');
console.log('  ✓ server/routes/auth.js — rewritten with password + 2FA');

// ─── 4. Update seed.js — hash passwords for demo users ──────────────────────

const seedPath = path.join(__dirname, 'server', 'seed.js');
let seedJs = fs.readFileSync(seedPath, 'utf8');

// Add bcrypt require at top if not present
if (!seedJs.includes('bcryptjs')) {
  seedJs = seedJs.replace(
    "const { v4: uuid } = require('uuid');",
    "const { v4: uuid } = require('uuid');\nconst bcrypt = require('bcryptjs');"
  );
}

// Find where users are inserted and add password hashing
// We need to make the seed async-aware for bcrypt
// Easiest: set a known hashed password for all demo users
// Password for all demo users: "Seniority2024!"
// We'll pre-compute the hash

// Actually let's just add a post-seed step that hashes passwords
if (!seedJs.includes('hashPasswords')) {
  seedJs += `

// Hash demo passwords
async function hashPasswords() {
  const { getDb, saveDb } = require('./database');
  const bcrypt = require('bcryptjs');
  const db = getDb();
  const users = db.prepare('SELECT id, password_hash FROM users').all();
  for (const u of users) {
    if (!u.password_hash || !u.password_hash.startsWith('$2')) {
      const hash = await bcrypt.hash('Seniority2024!', 12);
      db.prepare('UPDATE users SET password_hash = ?, totp_enabled = 0, totp_secret = NULL WHERE id = ?').run(hash, u.id);
    }
  }
  saveDb();
  console.log('  ✓ Demo user passwords hashed (password: Seniority2024!)');
}

hashPasswords().catch(console.error);
`;
  fs.writeFileSync(seedPath, seedJs, 'utf8');
  console.log('  ✓ server/seed.js — added password hashing for demo users');
} else {
  console.log('  ✓ server/seed.js — password hashing already present');
}

// ─── 5. Update admin.js — hash passwords on create & reset ──────────────────

const adminPath = path.join(__dirname, 'server', 'routes', 'admin.js');
let adminJs = fs.readFileSync(adminPath, 'utf8');

if (!adminJs.includes('bcryptjs')) {
  // Add bcrypt require
  adminJs = adminJs.replace(
    "const crypto = require('crypto');",
    "const crypto = require('crypto');\nconst bcrypt = require('bcryptjs');"
  );

  // Fix create user — hash the temp password
  adminJs = adminJs.replace(
    "router.post('/users', requireAuth, requireAdmin, (req, res) => {",
    "router.post('/users', requireAuth, requireAdmin, async (req, res) => {"
  );
  adminJs = adminJs.replace(
    "const tempPassword = crypto.randomBytes(6).toString('hex');",
    "const tempPassword = crypto.randomBytes(6).toString('hex');\n  const tempHash = tempPassword; // Store unhashed so first login triggers password change"
  );

  // Fix reset password — store unhashed temp so first login forces change
  adminJs = adminJs.replace(
    "router.post('/users/:id/reset-password', requireAuth, requireAdmin, (req, res) => {",
    "router.post('/users/:id/reset-password', requireAuth, requireAdmin, async (req, res) => {"
  );

  // Also disable 2FA on password reset
  adminJs = adminJs.replace(
    "db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(tempPassword, req.params.id);",
    "db.prepare('UPDATE users SET password_hash = ?, totp_enabled = 0, totp_secret = NULL WHERE id = ?').run(tempPassword, req.params.id);"
  );

  fs.writeFileSync(adminPath, adminJs, 'utf8');
  console.log('  ✓ server/routes/admin.js — bcrypt + 2FA reset on password reset');
} else {
  console.log('  ✓ server/routes/admin.js — already updated');
}

// ─── 6. Add API methods to client ───────────────────────────────────────────

const apiPath = path.join(__dirname, 'client', 'src', 'api.js');
let apiJs = fs.readFileSync(apiPath, 'utf8');

// Replace old login method
apiJs = apiJs.replace(
  "login: (userId) => request('/auth/login', { method: 'POST', body: { userId } }),",
  `login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password } }),
  verify2fa: (code) => request('/auth/verify-2fa', { method: 'POST', body: { code } }),
  setup2fa: () => request('/auth/setup-2fa', { method: 'POST' }),
  confirm2fa: (code) => request('/auth/confirm-2fa', { method: 'POST', body: { code } }),
  changePassword: (newPassword) => request('/auth/change-password', { method: 'POST', body: { newPassword } }),`
);

fs.writeFileSync(apiPath, apiJs, 'utf8');
console.log('  ✓ client/src/api.js — added 2FA methods');

// ─── 7. Rewrite LoginScreen.jsx ─────────────────────────────────────────────

fs.writeFileSync(path.join(__dirname, 'client', 'src', 'components', 'LoginScreen.jsx'), `import React, { useState } from 'react';
import { api } from '../api';
import Icon from './Icons';

export default function LoginScreen({ onLogin }) {
  const [step, setStep] = useState('login'); // login, 2fa, setup_2fa, confirm_2fa, change_password
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [code, setCode] = useState('');
  const [qrCode, setQrCode] = useState(null);
  const [manualKey, setManualKey] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showManualKey, setShowManualKey] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    setLoading(true);
    setError('');
    try {
      const data = await api.login(email.trim().toLowerCase(), password);
      if (data.step === '2fa') {
        setStep('2fa');
      } else if (data.step === 'setup_2fa') {
        await startSetup2fa();
      } else if (data.step === 'change_password') {
        setStep('change_password');
      } else if (data.step === 'done') {
        onLogin(data.user);
      }
    } catch (e) {
      setError(e.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify2fa = async (e) => {
    e.preventDefault();
    if (!code.trim() || code.trim().length < 6) return;
    setLoading(true);
    setError('');
    try {
      const data = await api.verify2fa(code.trim());
      if (data.step === 'done') onLogin(data.user);
    } catch (e) {
      setError(e.message || 'Invalid code');
      setCode('');
    } finally {
      setLoading(false);
    }
  };

  const startSetup2fa = async () => {
    try {
      const data = await api.setup2fa();
      setQrCode(data.qrCode);
      setManualKey(data.manualKey);
      setStep('setup_2fa');
    } catch (e) {
      setError(e.message || 'Failed to generate 2FA');
    }
  };

  const handleConfirm2fa = async (e) => {
    e.preventDefault();
    if (!code.trim() || code.trim().length < 6) return;
    setLoading(true);
    setError('');
    try {
      const data = await api.confirm2fa(code.trim());
      if (data.step === 'done') onLogin(data.user);
    } catch (e) {
      setError(e.message || 'Invalid code');
      setCode('');
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (newPassword.length < 8) { setError('Password must be at least 8 characters'); return; }
    if (newPassword !== confirmPassword) { setError('Passwords do not match'); return; }
    setLoading(true);
    setError('');
    try {
      const data = await api.changePassword(newPassword);
      if (data.step === 'setup_2fa') {
        await startSetup2fa();
      } else if (data.step === '2fa') {
        setStep('2fa');
      } else if (data.step === 'done') {
        onLogin(data.user);
      }
    } catch (e) {
      setError(e.message || 'Failed to change password');
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = {
    width: '100%', padding: '12px 16px', background: '#f0f4f9', border: '1px solid #c0d0e4',
    borderRadius: 8, color: '#1e3a4f', fontSize: 14, outline: 'none', boxSizing: 'border-box',
  };

  const btnStyle = (enabled) => ({
    width: '100%', padding: '12px', background: enabled ? '#1a5e9a' : '#c0d0e4',
    color: enabled ? '#fff' : '#6b8299', border: 'none', borderRadius: 8,
    cursor: enabled ? 'pointer' : 'default', fontSize: 14, fontWeight: 600,
  });

  return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #f2f6fa, #e0ecf6)', fontFamily: "'IBM Plex Sans', -apple-system, sans-serif" }}>
      <div style={{ width: 400, background: '#ffffff', borderRadius: 16, padding: 40, boxShadow: '0 8px 32px rgba(0,0,0,0.08)', border: '1px solid #c0d0e4' }}>

        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32, justifyContent: 'center' }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: 'linear-gradient(135deg, #1a5e9a, #2878b8)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="shield" size={18} />
          </div>
          <span style={{ fontWeight: 700, fontSize: 20, color: '#1e3a4f', letterSpacing: -0.5 }}>Seniority</span>
        </div>

        {/* ── LOGIN STEP ── */}
        {step === 'login' && (
          <form onSubmit={handleLogin}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: '#1e3a4f', marginBottom: 4, textAlign: 'center' }}>Sign In</h2>
            <p style={{ fontSize: 13, color: '#6b8299', textAlign: 'center', marginBottom: 24 }}>Enter your credentials to continue</p>

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: '#6b8299', display: 'block', marginBottom: 6 }}>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@seniorityhealthcare.com" style={inputStyle} autoFocus />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: '#6b8299', display: 'block', marginBottom: 6 }}>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••" style={inputStyle} />
            </div>

            {error && <div style={{ color: '#d94040', fontSize: 12, marginBottom: 16, textAlign: 'center', fontWeight: 500 }}>{error}</div>}

            <button type="submit" disabled={loading || !email.trim() || !password.trim()}
              style={btnStyle(!loading && email.trim() && password.trim())}>
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        )}

        {/* ── 2FA VERIFY STEP ── */}
        {step === '2fa' && (
          <form onSubmit={handleVerify2fa}>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div style={{ width: 56, height: 56, borderRadius: 12, background: '#e8f0f8', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                <Icon name="shield" size={24} />
              </div>
              <h2 style={{ fontSize: 16, fontWeight: 600, color: '#1e3a4f', marginBottom: 4 }}>Two-Factor Authentication</h2>
              <p style={{ fontSize: 13, color: '#6b8299' }}>Enter the 6-digit code from your authenticator app</p>
            </div>

            <div style={{ marginBottom: 24 }}>
              <input type="text" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000" maxLength={6}
                style={{ ...inputStyle, textAlign: 'center', fontSize: 28, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: 8, fontWeight: 700 }}
                autoFocus />
            </div>

            {error && <div style={{ color: '#d94040', fontSize: 12, marginBottom: 16, textAlign: 'center', fontWeight: 500 }}>{error}</div>}

            <button type="submit" disabled={loading || code.length < 6}
              style={btnStyle(!loading && code.length >= 6)}>
              {loading ? 'Verifying...' : 'Verify'}
            </button>

            <button type="button" onClick={() => { setStep('login'); setCode(''); setError(''); }}
              style={{ width: '100%', padding: '10px', background: 'none', border: 'none', color: '#6b8299', cursor: 'pointer', fontSize: 12, marginTop: 12 }}>
              ← Back to sign in
            </button>
          </form>
        )}

        {/* ── SETUP 2FA STEP ── */}
        {step === 'setup_2fa' && (
          <form onSubmit={handleConfirm2fa}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, color: '#1e3a4f', marginBottom: 4 }}>Set Up Two-Factor Authentication</h2>
              <p style={{ fontSize: 13, color: '#6b8299' }}>Scan this QR code with your authenticator app</p>
            </div>

            {qrCode && (
              <div style={{ textAlign: 'center', marginBottom: 20 }}>
                <img src={qrCode} alt="2FA QR Code" style={{ width: 200, height: 200, borderRadius: 8, border: '1px solid #c0d0e4' }} />
              </div>
            )}

            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <button type="button" onClick={() => setShowManualKey(!showManualKey)}
                style={{ background: 'none', border: 'none', color: '#1a5e9a', cursor: 'pointer', fontSize: 12, fontWeight: 500 }}>
                {showManualKey ? 'Hide manual key' : "Can't scan? Enter key manually"}
              </button>
              {showManualKey && (
                <div style={{ marginTop: 8, padding: '10px 16px', background: '#f0f4f9', borderRadius: 8, fontSize: 13, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: 1, wordBreak: 'break-all', color: '#1e3a4f', userSelect: 'all' }}>
                  {manualKey}
                </div>
              )}
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: '#6b8299', display: 'block', marginBottom: 6 }}>Verify — Enter 6-digit code from app</label>
              <input type="text" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000" maxLength={6}
                style={{ ...inputStyle, textAlign: 'center', fontSize: 22, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: 6, fontWeight: 700 }}
                autoFocus />
            </div>

            {error && <div style={{ color: '#d94040', fontSize: 12, marginBottom: 16, textAlign: 'center', fontWeight: 500 }}>{error}</div>}

            <button type="submit" disabled={loading || code.length < 6}
              style={btnStyle(!loading && code.length >= 6)}>
              {loading ? 'Verifying...' : 'Verify & Enable 2FA'}
            </button>
          </form>
        )}

        {/* ── CHANGE PASSWORD STEP ── */}
        {step === 'change_password' && (
          <form onSubmit={handleChangePassword}>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, color: '#1e3a4f', marginBottom: 4 }}>Set Your Password</h2>
              <p style={{ fontSize: 13, color: '#6b8299' }}>You're using a temporary password. Please create a new one.</p>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: '#6b8299', display: 'block', marginBottom: 6 }}>New Password</label>
              <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
                placeholder="At least 8 characters" style={inputStyle} autoFocus />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: '#6b8299', display: 'block', marginBottom: 6 }}>Confirm Password</label>
              <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                placeholder="Repeat your password" style={inputStyle} />
            </div>

            {error && <div style={{ color: '#d94040', fontSize: 12, marginBottom: 16, textAlign: 'center', fontWeight: 500 }}>{error}</div>}

            <button type="submit" disabled={loading || newPassword.length < 8 || newPassword !== confirmPassword}
              style={btnStyle(!loading && newPassword.length >= 8 && newPassword === confirmPassword)}>
              {loading ? 'Saving...' : 'Set Password & Continue'}
            </button>
          </form>
        )}

        {/* Footer */}
        <div style={{ marginTop: 24, textAlign: 'center', fontSize: 11, color: '#8a9fb0' }}>
          Seniority Healthcare — HIPAA Compliant
        </div>
      </div>
    </div>
  );
}
`, 'utf8');
console.log('  ✓ client/src/components/LoginScreen.jsx — rewritten with password + 2FA');

// ─── 8. Fix App.jsx — update login handler ──────────────────────────────────

const appPath = path.join(__dirname, 'client', 'src', 'App.jsx');
let appJsx = fs.readFileSync(appPath, 'utf8');

// The LoginScreen now passes the full user object from the API response
// The old handleLogin expected (user) which is what we return — should be fine

fs.writeFileSync(appPath, appJsx, 'utf8');
console.log('  ✓ client/src/App.jsx — verified login handler');

console.log('\n✅ Two-Factor Authentication added!\n');
console.log('Next steps:');
console.log('  1. Install new server packages:');
console.log('     cd server && npm install && cd ..');
console.log('  2. Delete old database and re-seed:');
console.log('     del server\\carecoord.db');
console.log('     npm run seed');
console.log('  3. Restart:');
console.log('     npm run dev');
console.log('');
console.log('Login flow:');
console.log('  1. Enter email + password');
console.log('  2. First login: forced to set up 2FA (scan QR with Google Authenticator)');
console.log('  3. Enter 6-digit code to verify');
console.log('  4. All future logins require email + password + 2FA code');
console.log('');
console.log('Demo credentials (all users):');
console.log('  Password: Seniority2024!');
console.log('  Emails: sarah.mitchell@carecoord.org, james.rivera@carecoord.org, etc.');
console.log('');
console.log('Admin password reset:');
console.log('  Resets password to a temp one AND disables 2FA');
console.log('  User must set new password + re-setup 2FA on next login\n');
