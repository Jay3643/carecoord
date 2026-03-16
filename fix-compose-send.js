const fs = require('fs');
let tickets = fs.readFileSync('server/routes/tickets.js', 'utf8');

// Make the create ticket route async
tickets = tickets.replace(
  "router.post('/', requireAuth, (req, res) => {",
  "router.post('/', requireAuth, async (req, res) => {"
);

// Add Gmail send after the ticket is created
tickets = tickets.replace(
  "addAudit(db, req.user.id, 'ticket_created', 'ticket', ticketId, 'Outbound ticket created: ' + subject);\n  addAudit(db, req.user.id, 'outbound_sent', 'message', msgId, 'Initial message sent to ' + toEmail.trim());",
  `addAudit(db, req.user.id, 'ticket_created', 'ticket', ticketId, 'Outbound ticket created: ' + subject);
  addAudit(db, req.user.id, 'outbound_sent', 'message', msgId, 'Initial message sent to ' + toEmail.trim());

  // Actually send via Gmail
  try {
    const tokenRow = db.prepare('SELECT * FROM gmail_tokens WHERE user_id = ?').get(req.user.id);
    if (tokenRow) {
      const oauth2 = new google.auth.OAuth2(process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET, process.env.GMAIL_REDIRECT_URI);
      oauth2.setCredentials({ access_token: tokenRow.access_token, refresh_token: tokenRow.refresh_token, expiry_date: tokenRow.expiry_date });
      const gm = google.gmail({ version: 'v1', auth: oauth2 });
      const senderEmail = tokenRow.email || fromAddr;
      const emailLines = [
        'From: ' + senderEmail,
        'To: ' + toEmail.trim(),
        'Subject: ' + subject,
        'Content-Type: text/plain; charset=utf-8',
        'MIME-Version: 1.0',
        '',
        fullBody,
      ];
      const raw = Buffer.from(emailLines.join(String.fromCharCode(13,10))).toString('base64url');
      await gm.users.messages.send({ userId: 'me', requestBody: { raw } });
      console.log('[Gmail] New message sent to', toEmail.trim());
    } else {
      console.log('[Gmail] No token — message saved but not sent');
    }
  } catch (gmailErr) {
    console.error('[Gmail] Send failed:', gmailErr.message);
  }`
);

fs.writeFileSync('server/routes/tickets.js', tickets, 'utf8');
console.log('✓ New messages now send via Gmail');
console.log('Refresh browser and try composing a new message.');
