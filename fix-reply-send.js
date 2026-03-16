// fix-reply-send.js
// Updates tickets.js reply route to actually send email via Gmail API

const fs = require('fs');
let tickets = fs.readFileSync('server/routes/tickets.js', 'utf8');

// Add googleapis import at top
if (!tickets.includes('googleapis')) {
  tickets = tickets.replace(
    "const { requireAuth, requireSupervisor, addAudit, toStr } = require('../middleware');",
    "const { requireAuth, requireSupervisor, addAudit, toStr } = require('../middleware');\nconst { google } = require('googleapis');"
  );
}

// Replace the reply route to actually send via Gmail
tickets = tickets.replace(
  `router.post('/:id/reply', requireAuth, (req, res) => {`,
  `router.post('/:id/reply', requireAuth, async (req, res) => {`
);

// Find the part where it inserts the message and add Gmail send after
tickets = tickets.replace(
  `db.prepare("UPDATE tickets SET status = 'WAITING_ON_EXTERNAL', last_activity_at = ?, has_unread = 0 WHERE id = ?").run(Date.now(), req.params.id);
  saveDb();
  addAudit(db, req.user.id, 'outbound_sent', 'message', msgId, 'Reply sent to ' + extP[0]);`,
  `db.prepare("UPDATE tickets SET status = 'WAITING_ON_EXTERNAL', last_activity_at = ?, has_unread = 0 WHERE id = ?").run(Date.now(), req.params.id);
  saveDb();

  // Actually send via Gmail
  try {
    const tokenRow = db.prepare('SELECT * FROM gmail_tokens WHERE user_id = ?').get(req.user.id);
    if (tokenRow) {
      const oauth2 = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
      oauth2.setCredentials({ access_token: tokenRow.access_token, refresh_token: tokenRow.refresh_token, expiry_date: tokenRow.expiry_date });
      const gmail = google.gmail({ version: 'v1', auth: oauth2 });

      const toAddr = extP[0] || '';
      const subject = 'Re: ' + ticket.subject;
      const replyTo = lastIn?.provider_message_id || '';

      // Build RFC 2822 email
      const emailLines = [
        'From: ' + fromAddr,
        'To: ' + toAddr,
        'Subject: ' + subject,
        'Content-Type: text/plain; charset=utf-8',
        'MIME-Version: 1.0',
      ];
      if (replyTo) {
        emailLines.push('In-Reply-To: <' + replyTo + '>');
        emailLines.push('References: <' + replyTo + '>');
      }
      emailLines.push('');
      emailLines.push(fullBody);

      const raw = Buffer.from(emailLines.join('\\r\\n')).toString('base64url');
      await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
      console.log('[Gmail] Reply sent to', toAddr);
    } else {
      console.log('[Gmail] No token for user', req.user.id, '— message saved but not sent');
    }
  } catch (gmailErr) {
    console.error('[Gmail] Send failed:', gmailErr.message);
    // Message is still saved in DB, just not sent via Gmail
  }

  addAudit(db, req.user.id, 'outbound_sent', 'message', msgId, 'Reply sent to ' + extP[0]);`
);

fs.writeFileSync('server/routes/tickets.js', tickets, 'utf8');
console.log('✓ tickets.js — replies now send via Gmail API');
console.log('Refresh browser. Type a reply on the ticket and hit send.');
