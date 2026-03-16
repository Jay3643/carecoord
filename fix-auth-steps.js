const fs = require('fs');
let auth = fs.readFileSync('server/routes/auth.js', 'utf8');

// Fix login: add step field to user response
auth = auth.replace(
  `setSession(res, toStr(user.id));
  const regions = db.prepare('SELECT region_id FROM user_regions WHERE user_id = ?').all(toStr(user.id));
  res.json({
    user: {
      id: toStr(user.id), name: toStr(user.name), email: toStr(user.email),
      role: toStr(user.role), avatar: toStr(user.avatar),
      regionIds: regions.map(r => r.region_id),
    }
  });`,
  `// Check if 2FA needs setup (no totp_secret)
  const secret = toStr(user.totp_secret);
  if (!secret && !totp) {
    setSession(res, toStr(user.id));
    return res.json({ step: 'setup_2fa' });
  }

  setSession(res, toStr(user.id));
  const regions = db.prepare('SELECT region_id FROM user_regions WHERE user_id = ?').all(toStr(user.id));
  res.json({
    step: 'done',
    user: {
      id: toStr(user.id), name: toStr(user.name), email: toStr(user.email),
      role: toStr(user.role), avatar: toStr(user.avatar),
      regionIds: regions.map(r => r.region_id),
    }
  });`
);

// Fix 2FA required response
auth = auth.replace(
  "return res.json({ requires2FA: true });",
  "return res.json({ step: '2fa' });"
);

// Fix verify-2fa response
auth = auth.replace(
  `if (!verified) return res.status(401).json({ error: 'Invalid code' });

  // Clean up pending session
  db.prepare('DELETE FROM sessions WHERE sid = ?').run('2fa-' + pendingId);
  res.clearCookie('pending2fa');

  setSession(res, toStr(user.id));
  const regions = db.prepare('SELECT region_id FROM user_regions WHERE user_id = ?').all(session.user_id);
  res.json({
    user: {
      id: toStr(user.id), name: toStr(user.name), email: toStr(user.email),
      role: toStr(user.role), avatar: toStr(user.avatar),
      regionIds: regions.map(r => r.region_id),
    }
  });`,
  `if (!verified) return res.status(401).json({ error: 'Invalid code' });

  // Clean up pending session
  db.prepare('DELETE FROM sessions WHERE sid = ?').run('2fa-' + pendingId);
  res.clearCookie('pending2fa');

  setSession(res, toStr(user.id));
  const regions = db.prepare('SELECT region_id FROM user_regions WHERE user_id = ?').all(session.user_id);
  res.json({
    step: 'done',
    user: {
      id: toStr(user.id), name: toStr(user.name), email: toStr(user.email),
      role: toStr(user.role), avatar: toStr(user.avatar),
      regionIds: regions.map(r => r.region_id),
    }
  });`
);

// Fix confirm-2fa response
auth = auth.replace(
  `db.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(session.user_id);
  saveDb();

  const regions = db.prepare('SELECT region_id FROM user_regions WHERE user_id = ?').all(session.user_id);
  res.json({
    user: {
      id: toStr(user.id), name: toStr(user.name), email: toStr(user.email),
      role: toStr(user.role), avatar: toStr(user.avatar),
      regionIds: regions.map(r => r.region_id),
    }
  });`,
  `db.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(session.user_id);
  saveDb();

  const regions = db.prepare('SELECT region_id FROM user_regions WHERE user_id = ?').all(session.user_id);
  res.json({
    step: 'done',
    user: {
      id: toStr(user.id), name: toStr(user.name), email: toStr(user.email),
      role: toStr(user.role), avatar: toStr(user.avatar),
      regionIds: regions.map(r => r.region_id),
    }
  });`
);

fs.writeFileSync('server/routes/auth.js', auth, 'utf8');
console.log('✓ Auth responses now match LoginScreen expectations');
console.log('  - Login returns { step: "done", user } or { step: "2fa" } or { step: "setup_2fa" }');
console.log('  - 2FA verify returns { step: "done", user }');
console.log('  - 2FA confirm returns { step: "done", user }');
console.log('Refresh browser and log in.');
