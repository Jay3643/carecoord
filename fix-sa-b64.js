const fs = require('fs');
let gmail = fs.readFileSync('server/routes/gmail.js', 'utf8');

gmail = gmail.replace(
  `let serviceAccountKey = null;
if (process.env.GOOGLE_SERVICE_ACCOUNT) {
  try { serviceAccountKey = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT); console.log('[SA] Service account loaded from env:', serviceAccountKey.client_email); }
  catch(e) { console.log('[SA] Failed to parse GOOGLE_SERVICE_ACCOUNT env:', e.message); }
} else {
  try { serviceAccountKey = JSON.parse(fs.readFileSync(require('path').join(__dirname, '..', 'service-account.json'), 'utf8')); console.log('[SA] Service account loaded from file:', serviceAccountKey.client_email); }
  catch(e) { console.log('[SA] No service account found'); }
}`,
  `let serviceAccountKey = null;
if (process.env.GOOGLE_SERVICE_ACCOUNT_B64) {
  try { serviceAccountKey = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_B64, 'base64').toString('utf8')); console.log('[SA] Service account loaded from env (b64):', serviceAccountKey.client_email); }
  catch(e) { console.log('[SA] Failed to parse GOOGLE_SERVICE_ACCOUNT_B64:', e.message); }
} else if (process.env.GOOGLE_SERVICE_ACCOUNT) {
  try { serviceAccountKey = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT); console.log('[SA] Service account loaded from env:', serviceAccountKey.client_email); }
  catch(e) { console.log('[SA] Failed to parse GOOGLE_SERVICE_ACCOUNT:', e.message); }
} else {
  try { serviceAccountKey = JSON.parse(fs.readFileSync(require('path').join(__dirname, '..', 'service-account.json'), 'utf8')); console.log('[SA] Service account loaded from file:', serviceAccountKey.client_email); }
  catch(e) { console.log('[SA] No service account found'); }
}`
);

fs.writeFileSync('server/routes/gmail.js', gmail, 'utf8');
console.log(gmail.includes('GOOGLE_SERVICE_ACCOUNT_B64') ? '✓ Base64 service account support added' : '✗ Failed');
