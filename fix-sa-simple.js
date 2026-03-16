const fs = require('fs');
let gmail = fs.readFileSync('server/routes/gmail.js', 'utf8');

// Remove everything from "let serviceAccountKey = null;" to the line before "function getServiceAuth"
const start = gmail.indexOf('let serviceAccountKey = null;');
const end = gmail.indexOf('function getServiceAuth');

if (start === -1 || end === -1) {
  console.log('ERROR: Could not find markers. start:', start, 'end:', end);
  process.exit(1);
}

const before = gmail.substring(0, start);
const after = gmail.substring(end);

const newBlock = `let serviceAccountKey = null;
if (process.env.SA_CLIENT_EMAIL && process.env.SA_PRIVATE_KEY) {
  serviceAccountKey = { client_email: process.env.SA_CLIENT_EMAIL, private_key: process.env.SA_PRIVATE_KEY };
  console.log('[SA] Service account from env vars:', serviceAccountKey.client_email);
} else {
  try { serviceAccountKey = JSON.parse(fs.readFileSync(require('path').join(__dirname, '..', 'service-account.json'), 'utf8')); console.log('[SA] Service account from file:', serviceAccountKey.client_email); }
  catch(e) { console.log('[SA] No service account found'); }
}

`;

gmail = before + newBlock + after;
fs.writeFileSync('server/routes/gmail.js', gmail, 'utf8');

// Verify
const check = fs.readFileSync('server/routes/gmail.js', 'utf8');
console.log(check.includes('SA_CLIENT_EMAIL') ? '✓ Done' : '✗ Failed');

// Now extract the private key for Render
const sa = JSON.parse(fs.readFileSync('server/service-account.json', 'utf8'));
console.log('');
console.log('=== RENDER ENV VARS ===');
console.log('');
console.log('SA_CLIENT_EMAIL:');
console.log(sa.client_email);
console.log('');
console.log('SA_PRIVATE_KEY (copy everything below this line until the next ===):');
console.log('===START===');
console.log(sa.private_key);
console.log('===END===');
console.log('');
console.log('In Render: delete GOOGLE_SERVICE_ACCOUNT and GOOGLE_SERVICE_ACCOUNT_B64');
console.log('Add SA_CLIENT_EMAIL and SA_PRIVATE_KEY with the values above');
console.log('');
console.log('Then run:');
console.log('  git add server/routes/gmail.js');
console.log('  git commit -m "Simple service account env vars"');
console.log('  git push origin main');
