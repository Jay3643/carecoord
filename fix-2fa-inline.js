const fs = require('fs');
let auth = fs.readFileSync('server/routes/auth.js', 'utf8');

// Replace the setup_2fa step in login to generate and save the secret right there
auth = auth.replace(
  `// Check if 2FA needs setup
  const secret = toStr(user.totp_secret);
  const is2FAEnabled = (totp === '1' || totp === 'true');
  if (!is2FAEnabled) {
    // 2FA not yet set up — require setup
    setSession(res, toStr(user.id));
    return res.json({ step: 'setup_2fa' });
  }`,
  `// Check if 2FA needs setup
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
  }`
);

fs.writeFileSync('server/routes/auth.js', auth, 'utf8');
console.log('  ✓ auth.js — 2FA secret generated during login');

// Now fix LoginScreen to use the QR code from login response instead of calling setup-2fa
let login = fs.readFileSync('client/src/components/LoginScreen.jsx', 'utf8');

login = login.replace(
  `} else if (data.step === 'setup_2fa') {
        await startSetup2fa();`,
  `} else if (data.step === 'setup_2fa') {
        setQrCode(data.qrCode);
        setManualKey(data.secret);
        setStep('setup_2fa');`
);

fs.writeFileSync('client/src/components/LoginScreen.jsx', login, 'utf8');
console.log('  ✓ LoginScreen.jsx — uses QR code from login response');

console.log('\nRefresh browser and log in. QR code will appear directly.');
