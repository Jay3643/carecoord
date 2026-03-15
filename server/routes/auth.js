const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const { getDb, saveDb } = require('../database');
const { requireAuth } = require('../middleware');
const router = express.Router();

function getServiceAuth(email) {
  const { google } = require('googleapis');
  let key = null;
  if (process.env.SA_CLIENT_EMAIL && process.env.SA_PRIVATE_KEY) {
    key = { client_email: process.env.SA_CLIENT_EMAIL, private_key: process.env.SA_PRIVATE_KEY };
  } else {
    try { key = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'service-account.json'), 'utf8')); } catch(e) {}
  }
  if (!key) return null;
  return new google.auth.JWT({ email: key.client_email, key: key.private_key, scopes: ['https://www.googleapis.com/auth/gmail.send'], subject: email });
}

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
    return res.json({ step: '2fa' });
  }

  // Check if 2FA needs setup
  const existingSecret = toStr(user.totp_secret);
  const is2FAEnabled = (totp === '1' || totp === 'true');
  if (!is2FAEnabled) {
    // Generate secret now and return QR code inline
    const newSecret = speakeasy.generateSecret({ name: 'CareCoord (' + toStr(user.email) + ')' });
    db.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').run(newSecret.base32, toStr(user.id));
    saveDb();
    console.log('[2FA] Secret generated for', toStr(user.email), newSecret.base32.substring(0,8) + '...');
    setSession(res, toStr(user.id));
    return QRCode.toDataURL(newSecret.otpauth_url, (err, qrUrl) => {
      res.json({ step: 'setup_2fa', qrCode: qrUrl, secret: newSecret.base32 });
    });
  }

  setSession(res, toStr(user.id));
  const regions = db.prepare('SELECT region_id FROM user_regions WHERE user_id = ?').all(toStr(user.id));
  res.json({
    step: 'done',
    user: {
      id: toStr(user.id), name: toStr(user.name), email: toStr(user.email),
      role: toStr(user.role), avatar: toStr(user.avatar),
      regionIds: regions.map(r => r.region_id),
      workStatus: toStr(user.work_status) || 'active',
    }
  });
});

router.post('/verify-2fa', (req, res) => {
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
      workStatus: toStr(user.work_status) || 'active',
    }
  });
});

router.post('/setup-2fa', (req, res) => {
  console.log('[2FA] setup-2fa called, cookies:', req.cookies?.sid ? 'present' : 'MISSING');
  const session = getSession(req);
  if (!session) { console.log('[2FA] No session found for setup'); return res.status(401).json({ error: 'Not authenticated' }); }
  console.log('[2FA] Session found for user:', session.user_id);

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id);
  const secret = speakeasy.generateSecret({ name: 'CareCoord (' + toStr(user.email) + ')' });
  db.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').run(secret.base32, session.user_id);
  saveDb();
  console.log('[2FA] Secret saved for user:', session.user_id, 'secret starts:', secret.base32.substring(0,8));

  QRCode.toDataURL(secret.otpauth_url, (err, url) => {
    res.json({ qrCode: url, secret: secret.base32 });
  });
});

router.post('/confirm-2fa', (req, res) => {
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
      workStatus: toStr(user.work_status) || 'active',
    }
  });
});

// ── Change password (for temp passwords) ─────────────────────────────────────

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
      workStatus: toStr(user.work_status) || 'active',
    }
  });
});

// ── Work Status (coordinator availability) ──
router.post('/work-status', requireAuth, (req, res) => {
  const db = getDb();
  const { status } = req.body;
  if (!['active', 'inactive'].includes(status)) return res.status(400).json({ error: 'Status must be active or inactive' });

  db.prepare('UPDATE users SET work_status = ? WHERE id = ?').run(status, req.user.id);

  // If going inactive, unassign their open tickets back to the regional queue
  if (status === 'inactive') {
    const affected = db.prepare("SELECT id FROM tickets WHERE assignee_user_id = ? AND status != 'CLOSED'").all(req.user.id);
    if (affected.length > 0) {
      db.prepare("UPDATE tickets SET assignee_user_id = NULL, last_activity_at = ? WHERE assignee_user_id = ? AND status != 'CLOSED'")
        .run(Date.now(), req.user.id);
    }
    const { addAudit } = require('../middleware');
    addAudit(db, req.user.id, 'status_inactive', 'user', req.user.id, 'Set status to inactive — ' + affected.length + ' tickets returned to queue');
  } else {
    const { addAudit } = require('../middleware');
    addAudit(db, req.user.id, 'status_active', 'user', req.user.id, 'Set status to active');
  }

  saveDb();
  res.json({ workStatus: status });
});

router.post('/logout', (req, res) => {
  const sid = req.cookies?.sid;
  if (sid) {
    try { getDb().prepare('DELETE FROM sessions WHERE sid = ?').run(sid); saveDb(); } catch(e) {}
  }
  res.clearCookie('sid');
  res.json({ success: true });
});

// ── Invite user (admin + supervisor) ──
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
    const senderEmail = toStr(req.user.email) || 'drhopkins@seniorityhealthcare.com';
    const saAuth = getServiceAuth(senderEmail);
    const gmailTokens = !saAuth ? db.prepare('SELECT * FROM gmail_tokens WHERE user_id = ?').get(req.user.id) : null;
    if (saAuth || gmailTokens) {
      let gm;
      if (saAuth) {
        gm = google.gmail({ version: 'v1', auth: saAuth });
      } else {
        const oauth2 = new google.auth.OAuth2(process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET, process.env.GMAIL_REDIRECT_URI);
        oauth2.setCredentials({ access_token: toStr(gmailTokens.access_token), refresh_token: toStr(gmailTokens.refresh_token) });
        gm = google.gmail({ version: 'v1', auth: oauth2 });
      }

      const emailBody = [
        'From: ' + senderEmail,
        'To: ' + email,
        'Subject: You\'re invited to CareCoord',
        'Content-Type: text/html; charset=utf-8',
        'MIME-Version: 1.0',
        '',
        '<div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px;">',
        '  <h2 style="color: #1e3a4f;">Welcome to CareCoord</h2>',
        '  <p style="color: #5f6368; font-size: 15px; line-height: 1.6;">Hi ' + name + ',</p>',
        '  <p style="color: #5f6368; font-size: 15px; line-height: 1.6;">You\'ve been invited to join CareCoord as a <strong>' + role + '</strong>. Click the button below to set up your account.</p>',
        '  <div style="text-align: center; margin: 32px 0;">',
        '    <a href="' + inviteLink + '" style="background: #1a5e9a; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px;">Set Up My Account</a>',
        '  </div>',
        '  <p style="color: #999; font-size: 13px;">This link expires in 7 days. If you didn\'t expect this invitation, you can ignore this email.</p>',
        '  <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">',
        '  <p style="color: #bbb; font-size: 11px;">Seniority Healthcare — CareCoord</p>',
        '</div>',
      ].join('\r\n');

      const raw = Buffer.from(emailBody).toString('base64url');
      await gm.users.messages.send({ userId: 'me', requestBody: { raw } });
      console.log('[Invite] Email sent to', email);
    } else {
      console.log('[Invite] No auth available — invite created but email not sent');
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
    const senderEmail2 = toStr(req.user.email) || 'drhopkins@seniorityhealthcare.com';
    const saAuth2 = getServiceAuth(senderEmail2);
    const gmailTokens = !saAuth2 ? db.prepare('SELECT * FROM gmail_tokens WHERE user_id = ?').get(req.user.id) : null;
    if (saAuth2 || gmailTokens) {
      let gm;
      if (saAuth2) {
        gm = google.gmail({ version: 'v1', auth: saAuth2 });
      } else {
        const oauth2 = new google.auth.OAuth2(process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET, process.env.GMAIL_REDIRECT_URI);
        oauth2.setCredentials({ access_token: toStr(gmailTokens.access_token), refresh_token: toStr(gmailTokens.refresh_token) });
        gm = google.gmail({ version: 'v1', auth: oauth2 });
      }
      const emailBody = [
        'From: ' + senderEmail2, 'To: ' + toStr(inv.email),
        'Subject: Reminder: Set up your CareCoord account',
        'Content-Type: text/html; charset=utf-8', 'MIME-Version: 1.0', '',
        '<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px;">',
        '<h2 style="color:#1e3a4f;">CareCoord Account Setup Reminder</h2>',
        '<p style="color:#5f6368;font-size:15px;">Hi ' + toStr(inv.name) + ', you still need to set up your CareCoord account.</p>',
        '<div style="text-align:center;margin:32px 0;"><a href="' + inviteLink + '" style="background:#1a5e9a;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;">Set Up My Account</a></div>',
        '<p style="color:#999;font-size:13px;">This link expires in 7 days.</p></div>',
      ].join('\r\n');
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

module.exports = router;
