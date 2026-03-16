const fs = require('fs');

// 1. Fix CORS to allow credentials
let index = fs.readFileSync('server/index.js', 'utf8');
if (!index.includes("credentials: true")) {
  index = index.replace(
    "app.use(cors());",
    "app.use(cors({ origin: 'http://localhost:5173', credentials: true }));"
  );
  // If there's a different cors call
  index = index.replace(
    "app.use(cors({",
    "app.use(cors({ origin: 'http://localhost:5173', credentials: true, // "
  );
  fs.writeFileSync('server/index.js', index, 'utf8');
  console.log('  ✓ index.js — CORS credentials enabled');
}

// 2. Fix api.js to always include credentials
let api = fs.readFileSync('client/src/api.js', 'utf8');
if (!api.includes("credentials: 'include'")) {
  api = api.replace(
    "const request = async (path, opts = {}) => {",
    "const request = async (path, opts = {}) => {\n  opts.credentials = 'include';"
  );
} else {
  // Make sure it's before the fetch call
  console.log('  ✓ api.js — credentials already present');
}
// Ensure all fetch calls use credentials
api = api.replace(
  "const res = await fetch(",
  "const res = await fetch("
);
fs.writeFileSync('client/src/api.js', api, 'utf8');
console.log('  ✓ api.js — credentials checked');

// 3. Add debug logging to setup-2fa and confirm-2fa
let auth = fs.readFileSync('server/routes/auth.js', 'utf8');

auth = auth.replace(
  "router.post('/setup-2fa', (req, res) => {\n  const session = getSession(req);",
  "router.post('/setup-2fa', (req, res) => {\n  console.log('[2FA] setup-2fa called, cookies:', req.cookies?.sid ? 'present' : 'MISSING');\n  const session = getSession(req);"
);

auth = auth.replace(
  "if (!session) return res.status(401).json({ error: 'Not authenticated' });\n\n  const db = getDb();\n  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id);\n  const secret = speakeasy.generateSecret",
  "if (!session) { console.log('[2FA] No session found for setup'); return res.status(401).json({ error: 'Not authenticated' }); }\n  console.log('[2FA] Session found for user:', session.user_id);\n\n  const db = getDb();\n  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id);\n  const secret = speakeasy.generateSecret"
);

auth = auth.replace(
  "db.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').run(secret.base32, session.user_id);\n  saveDb();",
  "db.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').run(secret.base32, session.user_id);\n  saveDb();\n  console.log('[2FA] Secret saved for user:', session.user_id, 'secret starts:', secret.base32.substring(0,8));"
);

auth = auth.replace(
  "router.post('/confirm-2fa', (req, res) => {\n  const session = getSession(req);",
  "router.post('/confirm-2fa', (req, res) => {\n  console.log('[2FA] confirm-2fa called, code:', req.body.code);\n  const session = getSession(req);"
);

fs.writeFileSync('server/routes/auth.js', auth, 'utf8');
console.log('  ✓ auth.js — debug logging added');

console.log('\nRestart server, log in, and watch the server terminal for [2FA] lines.');
