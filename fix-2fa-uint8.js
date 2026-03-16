const fs = require('fs');
let auth = fs.readFileSync('server/routes/auth.js', 'utf8');

// Replace the confirm-2fa secret reading
auth = auth.replace(
  "const secret = toStr(user.totp_secret);",
  "let secret = user.totp_secret;\n  if (secret instanceof Uint8Array) secret = Buffer.from(secret).toString('utf8');\n  else if (Buffer.isBuffer(secret)) secret = secret.toString('utf8');\n  else if (secret != null) secret = String(secret);"
);

// Do it for ALL occurrences (verify-2fa also reads totp_secret)
// The replace above only gets the first one, need to get the second too
auth = auth.replace(
  "const secret = toStr(user.totp_secret);",
  "let secret = user.totp_secret;\n  if (secret instanceof Uint8Array) secret = Buffer.from(secret).toString('utf8');\n  else if (Buffer.isBuffer(secret)) secret = secret.toString('utf8');\n  else if (secret != null) secret = String(secret);"
);

fs.writeFileSync('server/routes/auth.js', auth, 'utf8');
console.log('✓ Fixed Uint8Array conversion for totp_secret');
console.log('Try entering the 2FA code again (or refresh and re-login).');
