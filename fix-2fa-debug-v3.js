// fix-2fa-debug-v3.js
const fs = require('fs');
const path = require('path');

// ── Patch auth.js: add current code to setup response ────────────────────────

const authPath = path.join(__dirname, 'server', 'routes', 'auth.js');
let auth = fs.readFileSync(authPath, 'utf8');

// Add debug info to setup-2fa response
auth = auth.replace(
  `res.json({
    qrCode: qrUrl,
    manualKey: secret.base32,
    message: 'Scan the QR code with your authenticator app',
  });`,
  `// Debug: generate current valid code so user can verify
  const currentCode = speakeasy.totp({ secret: secret.base32, encoding: 'base32' });
  console.log('[2FA-SETUP] secret:', secret.base32);
  console.log('[2FA-SETUP] otpauth_url:', secret.otpauth_url);
  console.log('[2FA-SETUP] current valid code:', currentCode);
  console.log('[2FA-SETUP] server time:', new Date().toISOString());

  res.json({
    qrCode: qrUrl,
    manualKey: secret.base32,
    currentCode: currentCode,
    serverTime: new Date().toISOString(),
    message: 'Scan the QR code with your authenticator app',
  });`
);

fs.writeFileSync(authPath, auth, 'utf8');
console.log('  ✓ auth.js — setup now returns currentCode + serverTime');

// ── Patch LoginScreen: show debug info during 2FA setup ──────────────────────

const loginPath = path.join(__dirname, 'client', 'src', 'components', 'LoginScreen.jsx');
let login = fs.readFileSync(loginPath, 'utf8');

// Add state for debug info
if (!login.includes('serverCode')) {
  login = login.replace(
    "const [showManualKey, setShowManualKey] = useState(false);",
    "const [showManualKey, setShowManualKey] = useState(false);\n  const [serverCode, setServerCode] = useState('');\n  const [serverTime, setServerTime] = useState('');"
  );

  // Capture debug info from setup response
  login = login.replace(
    "setManualKey(data.manualKey);",
    "setManualKey(data.manualKey);\n      if (data.currentCode) setServerCode(data.currentCode);\n      if (data.serverTime) setServerTime(data.serverTime);"
  );

  // Show debug info on setup screen - add after the manual key section
  login = login.replace(
    `<div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: '#6b8299', display: 'block', marginBottom: 6 }}>Verify — Enter 6-digit code from app</label>`,
    `{serverCode && (
              <div style={{ marginBottom: 16, padding: 12, background: '#fff3e0', borderRadius: 8, border: '1px solid #ffb74d' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#e65100', marginBottom: 4 }}>DEBUG — Server expects this code right now:</div>
                <div style={{ fontSize: 24, fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, color: '#e65100', letterSpacing: 4 }}>{serverCode}</div>
                <div style={{ fontSize: 10, color: '#bf360c', marginTop: 4 }}>Server time: {serverTime}</div>
                <div style={{ fontSize: 10, color: '#bf360c' }}>If your authenticator shows a different code, your phone clock is off.</div>
              </div>
            )}

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: '#6b8299', display: 'block', marginBottom: 6 }}>Verify — Enter 6-digit code from app</label>`
  );
}

fs.writeFileSync(loginPath, login, 'utf8');
console.log('  ✓ LoginScreen.jsx — shows server expected code during setup');

console.log('\n✅ Done! Restart: npm run dev');
console.log('When you see the QR code screen, it will also show the code the SERVER expects.');
console.log('Compare that with what your authenticator app shows.');
console.log('This will tell us if the problem is the secret or the time.\n');
