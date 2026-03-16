const fs = require('fs');

// ═══════════════════════════════════════════════════
// 1. DATABASE — Add invitations table
// ═══════════════════════════════════════════════════
let db = fs.readFileSync('server/database.js', 'utf8');
if (!db.includes('invitations')) {
  db = db.replace(
    "r('CREATE TABLE IF NOT EXISTS email_sync_state",
    `r('CREATE TABLE IF NOT EXISTS invitations (id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL, region_ids TEXT, token TEXT UNIQUE NOT NULL, invited_by TEXT, created_at INTEGER, expires_at INTEGER, accepted_at INTEGER)');\n  r('CREATE TABLE IF NOT EXISTS email_sync_state`
  );
  fs.writeFileSync('server/database.js', db, 'utf8');
  console.log('  ✓ database.js — invitations table');
}

// ═══════════════════════════════════════════════════
// 2. SERVER — Invite routes
// ═══════════════════════════════════════════════════
let auth = fs.readFileSync('server/routes/auth.js', 'utf8');

if (!auth.includes('/invite')) {
  auth = auth.replace(
    "module.exports = router;",
    `// ── Invite user (admin + supervisor) ──
router.post('/invite', requireAuth, async (req, res) => {
  // Only admin and supervisors can invite
  if (req.user.role !== 'admin' && req.user.role !== 'supervisor') {
    return res.status(403).json({ error: 'Not authorized to invite users' });
  }
  // Supervisors can only invite coordinators
  if (req.user.role === 'supervisor' && req.body.role !== 'coordinator') {
    return res.status(403).json({ error: 'Supervisors can only invite coordinators' });
  }
  const { name, email, role, regionIds } = req.body;
  if (!name || !email || !role) return res.status(400).json({ error: 'Name, email, and role are required' });

  // Must be @seniorityhealthcare.com
  if (!email.toLowerCase().endsWith('@seniorityhealthcare.com')) {
    return res.status(400).json({ error: 'Email must be @seniorityhealthcare.com' });
  }

  const db = getDb();

  // Check if user already exists
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase())) {
    return res.status(400).json({ error: 'User with this email already exists' });
  }

  // Check if pending invite exists
  const existing = db.prepare('SELECT id FROM invitations WHERE email = ? AND accepted_at IS NULL AND expires_at > ?').get(email.toLowerCase(), Date.now());
  if (existing) {
    return res.status(400).json({ error: 'A pending invitation already exists for this email' });
  }

  // Generate invite token
  const crypto = require('crypto');
  const token = crypto.randomBytes(32).toString('hex');
  const id = 'inv-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days

  db.prepare('INSERT INTO invitations (id, email, name, role, region_ids, token, invited_by, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, email.toLowerCase(), name, role, JSON.stringify(regionIds || []), token, req.user.id, Date.now(), expiresAt);
  saveDb();

  // Send invite email via Gmail API
  const appUrl = process.env.APP_URL || 'http://localhost:5173';
  const inviteLink = appUrl + '/setup?token=' + token;

  try {
    const { google } = require('googleapis');
    const gmailTokens = db.prepare('SELECT * FROM gmail_tokens WHERE user_id = ?').get(req.user.id);
    if (gmailTokens) {
      const oauth2 = new google.auth.OAuth2(process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET, process.env.GMAIL_REDIRECT_URI);
      oauth2.setCredentials({ access_token: toStr(gmailTokens.access_token), refresh_token: toStr(gmailTokens.refresh_token) });
      const gm = google.gmail({ version: 'v1', auth: oauth2 });

      const emailBody = [
        'From: ' + toStr(gmailTokens.email),
        'To: ' + email,
        'Subject: You\\'re invited to CareCoord',
        'Content-Type: text/html; charset=utf-8',
        'MIME-Version: 1.0',
        '',
        '<div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px;">',
        '  <h2 style="color: #1e3a4f;">Welcome to CareCoord</h2>',
        '  <p style="color: #5f6368; font-size: 15px; line-height: 1.6;">Hi ' + name + ',</p>',
        '  <p style="color: #5f6368; font-size: 15px; line-height: 1.6;">You\\'ve been invited to join CareCoord as a <strong>' + role + '</strong>. Click the button below to set up your account.</p>',
        '  <div style="text-align: center; margin: 32px 0;">',
        '    <a href="' + inviteLink + '" style="background: #1a5e9a; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px;">Set Up My Account</a>',
        '  </div>',
        '  <p style="color: #999; font-size: 13px;">This link expires in 7 days. If you didn\\'t expect this invitation, you can ignore this email.</p>',
        '  <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">',
        '  <p style="color: #bbb; font-size: 11px;">Seniority Healthcare — CareCoord</p>',
        '</div>',
      ].join('\\r\\n');

      const raw = Buffer.from(emailBody).toString('base64url');
      await gm.users.messages.send({ userId: 'me', requestBody: { raw } });
      console.log('[Invite] Email sent to', email);
    } else {
      console.log('[Invite] No Gmail tokens — invite created but email not sent');
    }
  } catch (e) {
    console.log('[Invite] Email send failed:', e.message);
    // Invite is still created, admin can share the link manually
  }

  res.json({ id, token, inviteLink, email, expiresIn: '7 days' });
});

// ── Verify invite token ──
router.get('/invite/:token', (req, res) => {
  const db = getDb();
  const inv = db.prepare('SELECT * FROM invitations WHERE token = ?').get(req.params.token);
  if (!inv) return res.status(404).json({ error: 'Invalid invitation' });
  if (inv.accepted_at) return res.status(400).json({ error: 'Invitation already used' });
  if (inv.expires_at < Date.now()) return res.status(400).json({ error: 'Invitation expired' });
  res.json({ name: toStr(inv.name), email: toStr(inv.email), role: toStr(inv.role) });
});

// ── Accept invite — create account ──
router.post('/invite/:token/accept', (req, res) => {
  const db = getDb();
  const inv = db.prepare('SELECT * FROM invitations WHERE token = ?').get(req.params.token);
  if (!inv) return res.status(404).json({ error: 'Invalid invitation' });
  if (inv.accepted_at) return res.status(400).json({ error: 'Invitation already used' });
  if (inv.expires_at < Date.now()) return res.status(400).json({ error: 'Invitation expired' });

  const { password } = req.body;
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const bcrypt = require('bcryptjs');
  const userId = 'u' + Date.now();
  const hash = bcrypt.hashSync(password, 10);
  const email = toStr(inv.email);
  const name = toStr(inv.name);
  const role = toStr(inv.role);
  const regionIds = JSON.parse(toStr(inv.region_ids) || '[]');

  // Create user
  db.prepare('INSERT INTO users (id, name, email, password_hash, role, created_at) VALUES (?,?,?,?,?,?)')
    .run(userId, name, email, hash, role, Date.now());

  // Assign regions
  for (const rid of regionIds) {
    db.prepare('INSERT OR IGNORE INTO user_regions (user_id, region_id) VALUES (?,?)').run(userId, rid);
  }

  // Mark invitation as accepted
  db.prepare('UPDATE invitations SET accepted_at = ? WHERE token = ?').run(Date.now(), req.params.token);
  saveDb();

  console.log('[Invite] Account created:', email, 'as', role);

  // Generate TOTP secret for 2FA setup
  const speakeasy = require('speakeasy');
  const QRCode = require('qrcode');
  const secret = speakeasy.generateSecret({ name: 'CareCoord (' + email + ')' });
  db.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').run(secret.base32, userId);
  saveDb();

  QRCode.toDataURL(secret.otpauth_url, (err, qr) => {
    res.json({ userId, email, name, role, qrCode: qr, totpSecret: secret.base32 });
  });
});

// ── Confirm 2FA during setup ──
router.post('/invite/confirm-2fa', (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ error: 'Email and code required' });

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user) return res.status(404).json({ error: 'User not found' });

  const speakeasy = require('speakeasy');
  const secret = toStr(user.totp_secret);
  if (!secret) return res.status(400).json({ error: '2FA not set up' });

  const valid = speakeasy.totp.verify({ secret, encoding: 'base32', token: code, window: 2 });
  if (!valid) return res.status(400).json({ error: 'Invalid code' });

  // Mark 2FA as enabled
  db.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(user.id);
  saveDb();

  console.log('[Invite] 2FA confirmed for', toStr(user.email));
  res.json({ ok: true, message: 'Account setup complete. You can now log in.' });
});

// ── List invitations (admin/supervisor) ──
router.get('/invitations', requireAuth, (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'supervisor') {
    return res.status(403).json({ error: 'Not authorized' });
  }
  const invs = getDb().prepare('SELECT * FROM invitations ORDER BY created_at DESC').all();
  res.json({ invitations: invs.map(i => ({
    id: toStr(i.id), email: toStr(i.email), name: toStr(i.name), role: toStr(i.role),
    createdAt: i.created_at, expiresAt: i.expires_at, acceptedAt: i.accepted_at,
    expired: !i.accepted_at && i.expires_at < Date.now()
  }))});
});

// ── Resend invite ──
router.post('/invite/:id/resend', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'supervisor') {
    return res.status(403).json({ error: 'Not authorized' });
  }
  const db = getDb();
  const inv = db.prepare('SELECT * FROM invitations WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invitation not found' });
  if (inv.accepted_at) return res.status(400).json({ error: 'Already accepted' });

  // Extend expiry
  const newExpiry = Date.now() + 7 * 24 * 60 * 60 * 1000;
  db.prepare('UPDATE invitations SET expires_at = ? WHERE id = ?').run(newExpiry, req.params.id);
  saveDb();

  // Resend email (same logic as invite)
  const appUrl = process.env.APP_URL || 'http://localhost:5173';
  const inviteLink = appUrl + '/setup?token=' + toStr(inv.token);
  
  try {
    const { google } = require('googleapis');
    const gmailTokens = db.prepare('SELECT * FROM gmail_tokens WHERE user_id = ?').get(req.user.id);
    if (gmailTokens) {
      const oauth2 = new google.auth.OAuth2(process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET, process.env.GMAIL_REDIRECT_URI);
      oauth2.setCredentials({ access_token: toStr(gmailTokens.access_token), refresh_token: toStr(gmailTokens.refresh_token) });
      const gm = google.gmail({ version: 'v1', auth: oauth2 });
      const emailBody = [
        'From: ' + toStr(gmailTokens.email), 'To: ' + toStr(inv.email),
        'Subject: Reminder: Set up your CareCoord account',
        'Content-Type: text/html; charset=utf-8', 'MIME-Version: 1.0', '',
        '<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px;">',
        '<h2 style="color:#1e3a4f;">CareCoord Account Setup Reminder</h2>',
        '<p style="color:#5f6368;font-size:15px;">Hi ' + toStr(inv.name) + ', you still need to set up your CareCoord account.</p>',
        '<div style="text-align:center;margin:32px 0;"><a href="' + inviteLink + '" style="background:#1a5e9a;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;">Set Up My Account</a></div>',
        '<p style="color:#999;font-size:13px;">This link expires in 7 days.</p></div>',
      ].join('\\r\\n');
      const raw = Buffer.from(emailBody).toString('base64url');
      await gm.users.messages.send({ userId: 'me', requestBody: { raw } });
    }
  } catch(e) { console.log('[Invite] Resend failed:', e.message); }

  res.json({ ok: true });
});

// ── Revoke invite ──
router.delete('/invite/:id', requireAuth, (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'supervisor') {
    return res.status(403).json({ error: 'Not authorized' });
  }
  getDb().prepare('DELETE FROM invitations WHERE id = ? AND accepted_at IS NULL').run(req.params.id);
  saveDb();
  res.json({ ok: true });
});

module.exports = router;`
  );
  fs.writeFileSync('server/routes/auth.js', auth, 'utf8');
  console.log('  ✓ auth.js — invite, accept, confirm-2fa, list, resend, revoke routes');
}

// ═══════════════════════════════════════════════════
// 3. CLIENT — API methods
// ═══════════════════════════════════════════════════
let api = fs.readFileSync('client/src/api.js', 'utf8');
if (!api.includes('sendInvite')) {
  api = api.replace(
    "gmailAuth:",
    `sendInvite: (data) => request('/auth/invite', { method: 'POST', body: data }),
  verifyInvite: (token) => request('/auth/invite/' + token),
  acceptInvite: (token, password) => request('/auth/invite/' + token + '/accept', { method: 'POST', body: { password } }),
  confirmSetup2fa: (email, code) => request('/auth/invite/confirm-2fa', { method: 'POST', body: { email, code } }),
  getInvitations: () => request('/auth/invitations'),
  resendInvite: (id) => request('/auth/invite/' + id + '/resend', { method: 'POST' }),
  revokeInvite: (id) => request('/auth/invite/' + id, { method: 'DELETE' }),
  gmailAuth:`
  );
  fs.writeFileSync('client/src/api.js', api, 'utf8');
  console.log('  ✓ api.js — invite methods');
}

// ═══════════════════════════════════════════════════
// 4. CLIENT — Setup page component
// ═══════════════════════════════════════════════════
const setupPage = `import React, { useState, useEffect } from 'react';
import { api } from '../api';

export default function SetupAccount({ onComplete }) {
  const [step, setStep] = useState('loading'); // loading, setPassword, setup2fa, confirm2fa, done, error
  const [invite, setInvite] = useState(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [qrCode, setQrCode] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (!token) { setStep('error'); setError('No invitation token found'); return; }

    api.verifyInvite(token).then(data => {
      setInvite({ ...data, token });
      setEmail(data.email);
      setStep('setPassword');
    }).catch(e => {
      setStep('error');
      setError(e.message || 'Invalid or expired invitation');
    });
  }, []);

  const handleSetPassword = async () => {
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match'); return; }
    setError(''); setLoading(true);
    try {
      const data = await api.acceptInvite(invite.token, password);
      setQrCode(data.qrCode);
      setEmail(data.email);
      setStep('setup2fa');
    } catch (e) { setError(e.message || 'Failed to create account'); }
    setLoading(false);
  };

  const handleConfirm2fa = async () => {
    if (totpCode.length !== 6) { setError('Enter the 6-digit code from your authenticator app'); return; }
    setError(''); setLoading(true);
    try {
      await api.confirmSetup2fa(email, totpCode);
      setStep('done');
    } catch (e) { setError(e.message || 'Invalid code'); }
    setLoading(false);
  };

  const cardStyle = { background: '#fff', borderRadius: 16, padding: 40, width: 440, boxShadow: '0 8px 40px rgba(0,0,0,0.1)' };
  const inputStyle = { width: '100%', padding: '12px 16px', border: '1px solid #dadce0', borderRadius: 8, fontSize: 15, boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit' };
  const btnStyle = { width: '100%', padding: '14px', background: '#1a5e9a', color: '#fff', border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: 'pointer' };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #0d2137 0%, #143d6b 50%, #1a5e9a 100%)', fontFamily: "'IBM Plex Sans', -apple-system, sans-serif" }}>
      <div style={cardStyle}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#1e3a4f', marginBottom: 4 }}>CareCoord</div>
          <div style={{ fontSize: 13, color: '#8a9fb0' }}>Seniority Healthcare</div>
        </div>

        {step === 'loading' && (
          <div style={{ textAlign: 'center', padding: 40, color: '#8a9fb0' }}>Verifying invitation...</div>
        )}

        {step === 'error' && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
            <div style={{ color: '#d94040', fontSize: 15, marginBottom: 24 }}>{error}</div>
            <p style={{ color: '#8a9fb0', fontSize: 13 }}>Contact your administrator for a new invitation.</p>
          </div>
        )}

        {step === 'setPassword' && invite && (
          <div>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div style={{ fontSize: 18, fontWeight: 600, color: '#1e3a4f' }}>Welcome, {invite.name}!</div>
              <div style={{ fontSize: 13, color: '#8a9fb0', marginTop: 4 }}>Set up your account as <strong>{invite.role}</strong></div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#1e3a4f', display: 'block', marginBottom: 6 }}>Email</label>
              <input type="email" value={invite.email} disabled style={{ ...inputStyle, background: '#f6f8fa', color: '#8a9fb0' }} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#1e3a4f', display: 'block', marginBottom: 6 }}>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Minimum 8 characters" style={inputStyle} />
            </div>
            <div style={{ marginBottom: 24 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#1e3a4f', display: 'block', marginBottom: 6 }}>Confirm Password</label>
              <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSetPassword(); }} placeholder="Re-enter password" style={inputStyle} />
            </div>
            {error && <div style={{ color: '#d94040', fontSize: 13, marginBottom: 16, textAlign: 'center' }}>{error}</div>}
            <button onClick={handleSetPassword} disabled={loading} style={{ ...btnStyle, opacity: loading ? 0.7 : 1 }}>
              {loading ? 'Creating account...' : 'Continue'}
            </button>
          </div>
        )}

        {step === 'setup2fa' && (
          <div>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div style={{ fontSize: 18, fontWeight: 600, color: '#1e3a4f' }}>Set Up Two-Factor Authentication</div>
              <div style={{ fontSize: 13, color: '#8a9fb0', marginTop: 4 }}>Scan the QR code with Google Authenticator or Authy</div>
            </div>
            {qrCode && <div style={{ textAlign: 'center', marginBottom: 24 }}><img src={qrCode} alt="2FA QR Code" style={{ width: 200, height: 200 }} /></div>}
            <div style={{ marginBottom: 24 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#1e3a4f', display: 'block', marginBottom: 6 }}>Enter 6-digit code</label>
              <input type="text" value={totpCode} onChange={e => setTotpCode(e.target.value.replace(/\\D/g, '').slice(0, 6))}
                onKeyDown={e => { if (e.key === 'Enter') handleConfirm2fa(); }}
                placeholder="000000" maxLength={6}
                style={{ ...inputStyle, textAlign: 'center', fontSize: 24, letterSpacing: 8, fontFamily: "'IBM Plex Mono', monospace" }} />
            </div>
            {error && <div style={{ color: '#d94040', fontSize: 13, marginBottom: 16, textAlign: 'center' }}>{error}</div>}
            <button onClick={handleConfirm2fa} disabled={loading} style={{ ...btnStyle, opacity: loading ? 0.7 : 1 }}>
              {loading ? 'Verifying...' : 'Complete Setup'}
            </button>
          </div>
        )}

        {step === 'done' && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: '#1e3a4f', marginBottom: 8 }}>Account Created!</div>
            <p style={{ color: '#8a9fb0', fontSize: 14, marginBottom: 24 }}>Your account is ready. You can now log in with your email and password.</p>
            <button onClick={() => { window.location.href = '/'; }} style={btnStyle}>Go to Login</button>
          </div>
        )}
      </div>
    </div>
  );
}
`;
fs.writeFileSync('client/src/components/SetupAccount.jsx', setupPage, 'utf8');
console.log('  ✓ SetupAccount.jsx — setup page for new users');

// ═══════════════════════════════════════════════════
// 5. CLIENT — Route the /setup URL
// ═══════════════════════════════════════════════════
let app = fs.readFileSync('client/src/App.jsx', 'utf8');
if (!app.includes('SetupAccount')) {
  app = app.replace(
    "import { GmailConnectButton } from './components/GmailPanel';",
    "import { GmailConnectButton } from './components/GmailPanel';\nimport SetupAccount from './components/SetupAccount';"
  );
  // Add setup route check before auth check
  app = app.replace(
    "if (!authChecked) {",
    `// Handle /setup route for new user account setup
  if (window.location.search.includes('token=') && window.location.pathname === '/setup') {
    return <SetupAccount />;
  }

  if (!authChecked) {`
  );
  fs.writeFileSync('client/src/App.jsx', app, 'utf8');
  console.log('  ✓ App.jsx — /setup route for new users');
}

// ═══════════════════════════════════════════════════
// 6. ADMIN PANEL — Invite UI
// ═══════════════════════════════════════════════════
let admin = fs.readFileSync('client/src/components/AdminPanel.jsx', 'utf8');
if (!admin.includes('InviteUser')) {
  // Add invite section to admin panel
  // Find the end of the component and add invite tab
  admin = admin.replace(
    "export default function AdminPanel",
    `function InviteSection({ currentUser, showToast, regions }) {
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [role, setRole] = React.useState('coordinator');
  const [selectedRegions, setSelectedRegions] = React.useState([]);
  const [invitations, setInvitations] = React.useState([]);
  const [sending, setSending] = React.useState(false);

  React.useEffect(() => { loadInvitations(); }, []);
  const loadInvitations = () => {
    api.getInvitations().then(d => setInvitations(d.invitations || [])).catch(() => {});
  };

  const sendInvite = async () => {
    if (!name.trim() || !email.trim()) { showToast('Name and email required'); return; }
    if (!email.endsWith('@seniorityhealthcare.com')) { showToast('Must be @seniorityhealthcare.com'); return; }
    if (selectedRegions.length === 0) { showToast('Select at least one region'); return; }
    setSending(true);
    try {
      const d = await api.sendInvite({ name, email: email.toLowerCase(), role, regionIds: selectedRegions });
      showToast('Invitation sent to ' + email);
      setName(''); setEmail(''); setSelectedRegions([]);
      loadInvitations();
    } catch (e) { showToast(e.message || 'Failed to send'); }
    setSending(false);
  };

  const isSupervisor = currentUser.role === 'supervisor';
  const fmt = (ts) => ts ? new Date(ts).toLocaleDateString() : '-';

  return (
    <div>
      <h3 style={{ fontSize: 15, fontWeight: 700, color: '#1e3a4f', marginBottom: 16 }}>Invite New User</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: '#5a7a8a', display: 'block', marginBottom: 4 }}>Full Name</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Jane Smith"
            style={{ width: '100%', padding: '10px 12px', border: '1px solid #c0d0e4', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} />
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: '#5a7a8a', display: 'block', marginBottom: 4 }}>Email</label>
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder="jane@seniorityhealthcare.com"
            style={{ width: '100%', padding: '10px 12px', border: '1px solid #c0d0e4', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} />
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: '#5a7a8a', display: 'block', marginBottom: 4 }}>Role</label>
          <select value={role} onChange={e => setRole(e.target.value)}
            style={{ width: '100%', padding: '10px 12px', border: '1px solid #c0d0e4', borderRadius: 8, fontSize: 13, background: '#fff' }}>
            <option value="coordinator">Coordinator</option>
            {!isSupervisor && <option value="supervisor">Supervisor</option>}
            {!isSupervisor && <option value="admin">Admin</option>}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: '#5a7a8a', display: 'block', marginBottom: 4 }}>Region(s)</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {(regions || []).map(r => (
              <label key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer' }}>
                <input type="checkbox" checked={selectedRegions.includes(r.id)}
                  onChange={e => setSelectedRegions(prev => e.target.checked ? [...prev, r.id] : prev.filter(x => x !== r.id))} />
                {r.name}
              </label>
            ))}
          </div>
        </div>
      </div>
      <button onClick={sendInvite} disabled={sending}
        style={{ padding: '10px 24px', background: '#1a5e9a', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: sending ? 0.7 : 1 }}>
        {sending ? 'Sending...' : 'Send Invitation'}
      </button>

      <h3 style={{ fontSize: 15, fontWeight: 700, color: '#1e3a4f', margin: '32px 0 12px' }}>Pending Invitations</h3>
      <div style={{ border: '1px solid #dde8f2', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: '#f0f4f9' }}>
              <th style={{ padding: '8px 12px', textAlign: 'left', color: '#5a7a8a', fontWeight: 600 }}>Name</th>
              <th style={{ padding: '8px 12px', textAlign: 'left', color: '#5a7a8a', fontWeight: 600 }}>Email</th>
              <th style={{ padding: '8px 12px', textAlign: 'left', color: '#5a7a8a', fontWeight: 600 }}>Role</th>
              <th style={{ padding: '8px 12px', textAlign: 'left', color: '#5a7a8a', fontWeight: 600 }}>Status</th>
              <th style={{ padding: '8px 12px', textAlign: 'left', color: '#5a7a8a', fontWeight: 600 }}>Sent</th>
              <th style={{ padding: '8px 12px', textAlign: 'right', color: '#5a7a8a', fontWeight: 600 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {invitations.map(inv => (
              <tr key={inv.id} style={{ borderTop: '1px solid #e8f0f8' }}>
                <td style={{ padding: '8px 12px' }}>{inv.name}</td>
                <td style={{ padding: '8px 12px', color: '#5a7a8a' }}>{inv.email}</td>
                <td style={{ padding: '8px 12px' }}><span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: inv.role === 'admin' ? '#fce4e4' : inv.role === 'supervisor' ? '#e4f0fc' : '#e4fce8', color: inv.role === 'admin' ? '#d94040' : inv.role === 'supervisor' ? '#1a5e9a' : '#2e7d32' }}>{inv.role}</span></td>
                <td style={{ padding: '8px 12px' }}>
                  {inv.acceptedAt ? <span style={{ color: '#2e7d32', fontWeight: 600 }}>Accepted</span>
                    : inv.expired ? <span style={{ color: '#d94040' }}>Expired</span>
                    : <span style={{ color: '#f59e0b' }}>Pending</span>}
                </td>
                <td style={{ padding: '8px 12px', color: '#8a9fb0' }}>{fmt(inv.createdAt)}</td>
                <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                  {!inv.acceptedAt && (
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                      <button onClick={() => { api.resendInvite(inv.id).then(() => { showToast('Resent'); loadInvitations(); }); }}
                        style={{ padding: '4px 10px', background: '#e4f0fc', border: '1px solid #c0d0e4', borderRadius: 4, fontSize: 11, cursor: 'pointer', color: '#1a5e9a' }}>Resend</button>
                      <button onClick={() => { api.revokeInvite(inv.id).then(() => { showToast('Revoked'); loadInvitations(); }); }}
                        style={{ padding: '4px 10px', background: '#fce4e4', border: '1px solid #e8c0c0', borderRadius: 4, fontSize: 11, cursor: 'pointer', color: '#d94040' }}>Revoke</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {invitations.length === 0 && (
              <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: '#8a9fb0' }}>No invitations sent yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function AdminPanel`
  );

  // Add InviteSection as a tab in AdminPanel
  // Find where tabs are defined and add Invitations
  if (admin.includes("'users'") && admin.includes("'regions'")) {
    admin = admin.replace(
      "{ key: 'users', label: 'Users' },",
      "{ key: 'users', label: 'Users' },\n      { key: 'invitations', label: 'Invitations' },"
    );
    // Add the render for invitations tab
    admin = admin.replace(
      "{activeTab === 'users' && (",
      `{activeTab === 'invitations' && (
        <InviteSection currentUser={currentUser} showToast={showToast} regions={regions} />
      )}
      {activeTab === 'users' && (`
    );
    // Pass regions to AdminPanel - check if it accepts regions prop
    if (!admin.includes('regions')) {
      admin = admin.replace(
        "export default function AdminPanel({ currentUser, showToast })",
        "export default function AdminPanel({ currentUser, showToast, regions })"
      );
    }
  }

  fs.writeFileSync('client/src/components/AdminPanel.jsx', admin, 'utf8');
  console.log('  ✓ AdminPanel.jsx — Invitations tab with invite form + table');
}

// Pass regions to AdminPanel in App.jsx
app = fs.readFileSync('client/src/App.jsx', 'utf8');
if (!app.includes('AdminPanel') || !app.match(/AdminPanel[^/]*regions/)) {
  app = app.replace(
    '<AdminPanel currentUser={currentUser} showToast={showToast} />',
    '<AdminPanel currentUser={currentUser} showToast={showToast} regions={regions} />'
  );
  fs.writeFileSync('client/src/App.jsx', app, 'utf8');
  console.log('  ✓ App.jsx — regions passed to AdminPanel');
}

// Verify server compiles
try { require('./server/routes/auth'); console.log('  ✓ auth.js compiles OK'); }
catch(e) { console.log('  ERROR:', e.message); }

console.log('');
console.log('✅ Invitation system complete:');
console.log('');
console.log('  ADMIN/SUPERVISOR:');
console.log('    Admin → Invitations tab → fill in name, email, role, regions');
console.log('    Click "Send Invitation" → email sent via Gmail API');
console.log('    Can resend or revoke pending invitations');
console.log('    Supervisors can only invite coordinators');
console.log('    Email must be @seniorityhealthcare.com');
console.log('');
console.log('  NEW USER:');
console.log('    1. Receives email with "Set Up My Account" button');
console.log('    2. Clicks link → /setup?token=xxx');
console.log('    3. Sets password');
console.log('    4. Scans 2FA QR code');
console.log('    5. Enters 6-digit code to confirm');
console.log('    6. Account active → redirected to login');
console.log('');
console.log('  Invite links expire after 7 days');
console.log('');
console.log('Restart server and refresh browser.');
