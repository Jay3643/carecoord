// fix-2fa-session.js
const fs = require('fs');
const path = require('path');

const authPath = path.join(__dirname, 'server', 'routes', 'auth.js');
let auth = fs.readFileSync(authPath, 'utf8');

// Fix setup-2fa: also store secret in session
auth = auth.replace(
  "db.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').run(secret.base32, userId);\n  saveDb();",
  "db.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').run(secret.base32, userId);\n  saveDb();\n\n  // Also store in session so confirm doesn't depend on DB round-trip\n  req.session.setup2faSecret = secret.base32;"
);

// Fix confirm-2fa: use session secret instead of DB
auth = auth.replace(
  "const secret = toStr(user.totp_secret);",
  "// Use session secret (avoids sql.js text encoding issues)\n  const secret = req.session.setup2faSecret || toStr(user.totp_secret);"
);

// Also fix: when we store the secret back to DB on confirm, use the session value
auth = auth.replace(
  "db.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(userId);",
  "// Re-store the secret from session to ensure DB has correct value\n  if (req.session.setup2faSecret) {\n    db.prepare('UPDATE users SET totp_secret = ?, totp_enabled = 1 WHERE id = ?').run(req.session.setup2faSecret, userId);\n    delete req.session.setup2faSecret;\n  } else {\n    db.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(userId);\n  }"
);

fs.writeFileSync(authPath, auth, 'utf8');
console.log('✓ auth.js — 2FA now uses session secret for confirmation');
console.log('Restart: npm run dev');
console.log('Delete old Seniority entry in your authenticator app, then try again');
