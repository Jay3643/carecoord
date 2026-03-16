const fs = require('fs');
let gmail = fs.readFileSync('server/routes/gmail.js', 'utf8');

if (gmail.includes('GOOGLE_SERVICE_ACCOUNT')) {
  console.log('✓ Already has GOOGLE_SERVICE_ACCOUNT support');
  process.exit(0);
}

gmail = gmail.replace(
  "let serviceAccountKey = null;\ntry { serviceAccountKey = JSON.parse(fs.readFileSync(require('path').join(__dirname, '..', 'service-account.json'), 'utf8')); console.log('[SA] Service account loaded:', serviceAccountKey.client_email); }\ncatch(e) { console.log('[SA] No service-account.json found — using OAuth tokens only'); }",
  "let serviceAccountKey = null;\nif (process.env.GOOGLE_SERVICE_ACCOUNT) {\n  try { serviceAccountKey = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT); console.log('[SA] Service account loaded from env:', serviceAccountKey.client_email); }\n  catch(e) { console.log('[SA] Failed to parse GOOGLE_SERVICE_ACCOUNT env:', e.message); }\n} else {\n  try { serviceAccountKey = JSON.parse(fs.readFileSync(require('path').join(__dirname, '..', 'service-account.json'), 'utf8')); console.log('[SA] Service account loaded from file:', serviceAccountKey.client_email); }\n  catch(e) { console.log('[SA] No service account found'); }\n}"
);

if (!gmail.includes('GOOGLE_SERVICE_ACCOUNT')) {
  // Newlines might differ — try a regex approach
  gmail = fs.readFileSync('server/routes/gmail.js', 'utf8');
  const old = /let serviceAccountKey = null;\s*\ntry \{ serviceAccountKey = JSON\.parse\(fs\.readFileSync\(require\('path'\)\.join\(__dirname, '\.\.', 'service-account\.json'\), 'utf8'\)\); console\.log\('\[SA\] Service account loaded:', serviceAccountKey\.client_email\); \}\s*\ncatch\(e\) \{ console\.log\('\[SA\] No service-account\.json found — using OAuth tokens only'\); \}/;
  gmail = gmail.replace(old,
    `let serviceAccountKey = null;
if (process.env.GOOGLE_SERVICE_ACCOUNT) {
  try { serviceAccountKey = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT); console.log('[SA] Service account loaded from env:', serviceAccountKey.client_email); }
  catch(e) { console.log('[SA] Failed to parse GOOGLE_SERVICE_ACCOUNT env:', e.message); }
} else {
  try { serviceAccountKey = JSON.parse(fs.readFileSync(require('path').join(__dirname, '..', 'service-account.json'), 'utf8')); console.log('[SA] Service account loaded from file:', serviceAccountKey.client_email); }
  catch(e) { console.log('[SA] No service account found'); }
}`
  );
}

fs.writeFileSync('server/routes/gmail.js', gmail, 'utf8');
console.log(gmail.includes('GOOGLE_SERVICE_ACCOUNT') ? '✓ Done — GOOGLE_SERVICE_ACCOUNT support added' : '✗ FAILED — paste gmail.js for manual fix');
