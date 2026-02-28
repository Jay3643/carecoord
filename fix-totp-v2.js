// fix-totp-v2.js
const fs = require('fs');
const path = require('path');

const authPath = path.join(__dirname, 'server', 'routes', 'auth.js');
let auth = fs.readFileSync(authPath, 'utf8');

// Add a helper function to safely convert sql.js values to strings
if (!auth.includes('function toStr')) {
  auth = auth.replace(
    "const router = express.Router();",
    `const router = express.Router();

// sql.js can return TEXT columns as Uint8Array instead of string
function toStr(val) {
  if (val == null) return null;
  if (typeof val === 'string') return val;
  if (val instanceof Uint8Array || Buffer.isBuffer(val)) return Buffer.from(val).toString('utf8');
  return String(val);
}
`
  );
  console.log('  ✓ Added toStr() helper');
}

// Now globally replace every use of user.totp_secret with toStr(user.totp_secret)
// But only in speakeasy calls and comparisons, not in DB writes
auth = auth.replace(/secret: user\.totp_secret,/g, 'secret: toStr(user.totp_secret),');
auth = auth.replace(/secret: secret,/g, 'secret: toStr(secret),');

// Also ensure code is trimmed to string
auth = auth.replace(/token: code,/g, 'token: String(code).trim(),');

// Add debug to confirm-2fa
if (!auth.includes('[TOTP-DBG]')) {
  auth = auth.replace(
    "if (!user || !user.totp_secret) {\n    return res.status(400).json({ error: 'No 2FA secret found. Run setup first.' });\n  }",
    `if (!user || !user.totp_secret) {
    return res.status(400).json({ error: 'No 2FA secret found. Run setup first.' });
  }

  const dbSecret = toStr(user.totp_secret);
  const expectedCode = speakeasy.totp({ secret: dbSecret, encoding: 'base32' });
  console.log('[TOTP-DBG] secret type:', typeof user.totp_secret, '| isUint8:', user.totp_secret instanceof Uint8Array);
  console.log('[TOTP-DBG] secret string:', dbSecret);
  console.log('[TOTP-DBG] code entered:', code, '| expected:', expectedCode);`
  );
}

fs.writeFileSync(authPath, auth, 'utf8');
console.log('  ✓ auth.js patched');
console.log('\nRestart npm run dev, try login, paste [TOTP-DBG] lines from server terminal');
