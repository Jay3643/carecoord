const fs = require('fs');
let auth = fs.readFileSync('server/routes/auth.js', 'utf8');

// Fix: the check for 2FA setup was wrong
// toStr(0) = '0' which is truthy, so !totp was false
auth = auth.replace(
  `// Check if 2FA needs setup (no totp_secret)
  const secret = toStr(user.totp_secret);
  if (!secret && !totp) {
    setSession(res, toStr(user.id));
    return res.json({ step: 'setup_2fa' });
  }`,
  `// Check if 2FA needs setup
  const secret = toStr(user.totp_secret);
  const is2FAEnabled = (totp === '1' || totp === 'true');
  if (!is2FAEnabled) {
    // 2FA not yet set up — require setup
    setSession(res, toStr(user.id));
    return res.json({ step: 'setup_2fa' });
  }`
);

fs.writeFileSync('server/routes/auth.js', auth, 'utf8');
console.log('✓ 2FA now required for all users');
console.log('Refresh browser and log in — it will prompt for 2FA setup.');
