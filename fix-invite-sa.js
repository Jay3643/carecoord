const fs = require('fs');
let auth = fs.readFileSync('server/routes/auth.js', 'utf8');

// Add service account helper at the top, after the router declaration
auth = auth.replace(
  "function toStr(v) {",
  `function getServiceAuth(email) {
  const { google } = require('googleapis');
  let key = null;
  if (process.env.SA_CLIENT_EMAIL && process.env.SA_PRIVATE_KEY) {
    key = { client_email: process.env.SA_CLIENT_EMAIL, private_key: process.env.SA_PRIVATE_KEY };
  } else {
    try { key = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'service-account.json'), 'utf8')); } catch(e) {}
  }
  if (!key) return null;
  return new google.auth.JWT({ email: key.client_email, key: key.private_key, scopes: ['https://www.googleapis.com/auth/gmail.send'], subject: email });
}

function toStr(v) {`
);

// Replace the invite email sending block
auth = auth.replace(
  `  try {
    const { google } = require('googleapis');
    const gmailTokens = db.prepare('SELECT * FROM gmail_tokens WHERE user_id = ?').get(req.user.id);
    if (gmailTokens) {
      const oauth2 = new google.auth.OAuth2(process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET, process.env.GMAIL_REDIRECT_URI);
      oauth2.setCredentials({ access_token: toStr(gmailTokens.access_token), refresh_token: toStr(gmailTokens.refresh_token) });
      const gm = google.gmail({ version: 'v1', auth: oauth2 });

      const emailBody = [
        'From: ' + toStr(gmailTokens.email),`,
  `  try {
    const { google } = require('googleapis');
    const senderEmail = toStr(req.user.email) || 'drhopkins@seniorityhealthcare.com';
    const saAuth = getServiceAuth(senderEmail);
    const gmailTokens = !saAuth ? db.prepare('SELECT * FROM gmail_tokens WHERE user_id = ?').get(req.user.id) : null;
    if (saAuth || gmailTokens) {
      let gm;
      if (saAuth) {
        gm = google.gmail({ version: 'v1', auth: saAuth });
      } else {
        const oauth2 = new google.auth.OAuth2(process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET, process.env.GMAIL_REDIRECT_URI);
        oauth2.setCredentials({ access_token: toStr(gmailTokens.access_token), refresh_token: toStr(gmailTokens.refresh_token) });
        gm = google.gmail({ version: 'v1', auth: oauth2 });
      }

      const emailBody = [
        'From: ' + senderEmail,`
);

// Fix the "no tokens" message
auth = auth.replace(
  "      console.log('[Invite] No Gmail tokens — invite created but email not sent');",
  "      console.log('[Invite] No auth available — invite created but email not sent');"
);

// Also fix the resend endpoint similarly
auth = auth.replace(
  `  try {
    const { google } = require('googleapis');
    const gmailTokens = db.prepare('SELECT * FROM gmail_tokens WHERE user_id = ?').get(req.user.id);
    if (gmailTokens) {
      const oauth2 = new google.auth.OAuth2(process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET, process.env.GMAIL_REDIRECT_URI);
      oauth2.setCredentials({ access_token: toStr(gmailTokens.access_token), refresh_token: toStr(gmailTokens.refresh_token) });
      const gm = google.gmail({ version: 'v1', auth: oauth2 });
      const emailBody = [
        'From: ' + toStr(gmailTokens.email), 'To: ' + toStr(inv.email),`,
  `  try {
    const { google } = require('googleapis');
    const senderEmail2 = toStr(req.user.email) || 'drhopkins@seniorityhealthcare.com';
    const saAuth2 = getServiceAuth(senderEmail2);
    const gmailTokens = !saAuth2 ? db.prepare('SELECT * FROM gmail_tokens WHERE user_id = ?').get(req.user.id) : null;
    if (saAuth2 || gmailTokens) {
      let gm;
      if (saAuth2) {
        gm = google.gmail({ version: 'v1', auth: saAuth2 });
      } else {
        const oauth2 = new google.auth.OAuth2(process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET, process.env.GMAIL_REDIRECT_URI);
        oauth2.setCredentials({ access_token: toStr(gmailTokens.access_token), refresh_token: toStr(gmailTokens.refresh_token) });
        gm = google.gmail({ version: 'v1', auth: oauth2 });
      }
      const emailBody = [
        'From: ' + senderEmail2, 'To: ' + toStr(inv.email),`
);

fs.writeFileSync('server/routes/auth.js', auth, 'utf8');
console.log('✓ auth.js — invite emails now use service account');
console.log('Push and redeploy.');
