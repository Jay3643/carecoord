// rewrite-gmail-routes.js
const fs = require('fs');
const path = require('path');

fs.writeFileSync(path.join(__dirname, 'server', 'routes', 'gmail.js'), `const express = require('express');
const { google } = require('googleapis');
const { getDb, saveDb } = require('../database');
const { requireAuth } = require('../middleware');
const router = express.Router();

function toStr(val) {
  if (val == null) return null;
  if (typeof val === 'string') return val;
  if (val instanceof Uint8Array || Buffer.isBuffer(val)) return Buffer.from(val).toString('utf8');
  return String(val);
}

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI
  );
}

function getAuthenticatedClient(tokens) {
  const client = getOAuth2Client();
  client.setCredentials({
    access_token: toStr(tokens.access_token),
    refresh_token: toStr(tokens.refresh_token),
    expiry_date: tokens.expiry_date,
  });
  return client;
}

function getStoredTokens(userId) {
  const db = getDb();
  return db.prepare('SELECT * FROM gmail_tokens WHERE user_id = ?').get(userId) || null;
}

function storeTokens(userId, tokens, email) {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM gmail_tokens WHERE user_id = ?').get(userId);
  if (existing) {
    const updates = [];
    const params = [];
    if (tokens.access_token) { updates.push('access_token = ?'); params.push(tokens.access_token); }
    if (tokens.refresh_token) { updates.push('refresh_token = ?'); params.push(tokens.refresh_token); }
    if (tokens.expiry_date) { updates.push('expiry_date = ?'); params.push(tokens.expiry_date); }
    if (email) { updates.push('email = ?'); params.push(email); }
    params.push(userId);
    db.prepare('UPDATE gmail_tokens SET ' + updates.join(', ') + ' WHERE user_id = ?').run(...params);
  } else {
    db.prepare('INSERT INTO gmail_tokens (id, user_id, access_token, refresh_token, expiry_date, email) VALUES (?, ?, ?, ?, ?, ?)')
      .run('gt-' + Date.now(), userId, tokens.access_token, tokens.refresh_token || null, tokens.expiry_date || null, email || null);
  }
  saveDb();
}

function getHeader(headers, name) {
  const h = (headers || []).find(h => h.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

function extractBody(payload) {
  let textBody = '';
  let htmlBody = '';
  function walk(part) {
    if (part.body && part.body.data) {
      const decoded = Buffer.from(part.body.data, 'base64').toString('utf8');
      if (part.mimeType === 'text/plain' && !textBody) textBody = decoded;
      if (part.mimeType === 'text/html') htmlBody = decoded;
    }
    if (part.parts) part.parts.forEach(walk);
  }
  walk(payload);
  return htmlBody || textBody;
}

// ═══════════════════════════════════════════════════════════════════════════════
// OAUTH
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/auth', requireAuth, (req, res) => {
  const client = getOAuth2Client();
  const url = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/drive.readonly',
    ],
    state: toStr(req.user.id),
  });
  res.json({ authUrl: url });
});

router.get('/callback', async (req, res) => {
  try {
    const { code, state: userId } = req.query;
    const client = getOAuth2Client();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: 'v2', auth: client });
    const userInfo = await oauth2.userinfo.get();
    const email = userInfo.data.email;
    storeTokens(userId, tokens, email);
    console.log('[Gmail] Connected for user', userId, '| email:', email);
    res.send('<html><body><h2>Google Workspace Connected!</h2><p>You can close this window.</p><script>window.close();</script></body></html>');
  } catch (err) {
    console.error('[Gmail] OAuth error:', err.message);
    res.status(500).send('<html><body><h2>Connection Failed</h2><p>' + err.message + '</p></body></html>');
  }
});

router.get('/status', requireAuth, (req, res) => {
  const tokens = getStoredTokens(toStr(req.user.id));
  res.json({
    connected: !!(tokens && tokens.access_token),
    email: tokens ? toStr(tokens.email) : null,
  });
});

router.post('/disconnect', requireAuth, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM gmail_tokens WHERE user_id = ?').run(toStr(req.user.id));
  db.prepare('DELETE FROM email_sync_state WHERE user_id = ?').run(toStr(req.user.id));
  saveDb();
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SYNC — pull emails from connected accounts into regional tickets
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/sync', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const accounts = db.prepare('SELECT gt.*, u.name as user_name FROM gmail_tokens gt JOIN users u ON u.id = gt.user_id WHERE gt.access_token IS NOT NULL').all();
    let totalNew = 0;
    for (const acct of accounts) {
      try {
        const count = await syncUserEmails(db, acct);
        totalNew += count;
      } catch (err) {
        console.error('[Sync] Error for', toStr(acct.email), ':', err.message);
      }
    }
    res.json({ synced: totalNew });
  } catch (err) {
    console.error('[Sync] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

async function syncUserEmails(db, tokenRow) {
  const auth = getAuthenticatedClient(tokenRow);
  const gmail = google.gmail({ version: 'v1', auth });
  const userId = toStr(tokenRow.user_id);

  const regions = db.prepare('SELECT region_id FROM user_regions WHERE user_id = ?').all(userId);
  if (regions.length === 0) return 0;

  // Only get last 24 hours
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const listRes = await gmail.users.messages.list({
    userId: 'me', q: 'in:inbox after:' + yesterday, maxResults: 20,
  });

  if (!listRes.data.messages) return 0;

  let newCount = 0;
  for (const m of listRes.data.messages) {
    const existing = db.prepare('SELECT id FROM messages WHERE gmail_message_id = ?').get(m.id);
    if (existing) continue;

    const msg = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'full' });
    const headers = msg.data.payload.headers;
    const from = getHeader(headers, 'From');
    const subject = getHeader(headers, 'Subject') || '(no subject)';
    const body = extractBody(msg.data.payload);
    const date = getHeader(headers, 'Date');
    const threadId = msg.data.threadId;

    // Check filters
    const filters = db.prepare('SELECT * FROM email_filters WHERE action = ?').all('personal');
    let isPersonal = false;
    for (const f of filters) {
      const domain = toStr(f.domain);
      const sender = toStr(f.sender);
      const subContains = toStr(f.subject_contains);
      if (domain && from.toLowerCase().includes(domain.toLowerCase())) { isPersonal = true; break; }
      if (sender && from.toLowerCase().includes(sender.toLowerCase())) { isPersonal = true; break; }
      if (subContains && subject.toLowerCase().includes(subContains.toLowerCase())) { isPersonal = true; break; }
    }
    if (isPersonal) continue;

    const regionId = toStr(regions[0].region_id);
    const ticketId = 'tk-' + Date.now() + '-' + Math.random().toString(36).slice(2,6);
    const msgId = 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2,6);
    const ts = new Date(date).getTime() || Date.now();

    db.prepare('INSERT INTO tickets (id, subject, from_email, region_id, status, created_at, last_activity_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(ticketId, subject, from, regionId, 'OPEN', ts, ts);
    db.prepare('INSERT INTO messages (id, ticket_id, direction, sender, body_text, sent_at, gmail_message_id, gmail_thread_id, gmail_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(msgId, ticketId, 'inbound', from, body || subject, ts, m.id, threadId, userId);
    newCount++;
  }

  db.prepare('INSERT OR REPLACE INTO email_sync_state (user_id, last_sync_at) VALUES (?, ?)').run(userId, Date.now());
  saveDb();
  console.log('[Sync]', toStr(tokenRow.email), '-', newCount, 'new tickets');
  return newCount;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PERSONAL INBOX — mirrors Gmail directly (all emails, no filtering)
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/personal', requireAuth, async (req, res) => {
  try {
    const tokens = getStoredTokens(toStr(req.user.id));
    if (!tokens) return res.status(400).json({ error: 'Not connected' });

    const auth = getAuthenticatedClient(tokens);
    const gmail = google.gmail({ version: 'v1', auth });
    const folder = req.query.folder || 'INBOX';
    const query = req.query.q || '';
    const maxResults = parseInt(req.query.max) || 20;

    const folderMap = { INBOX:'in:inbox', SENT:'in:sent', DRAFT:'in:drafts', STARRED:'is:starred', SPAM:'in:spam', TRASH:'in:trash', ALL:'' };
    const q = query || folderMap[folder] || 'in:inbox';

    const listRes = await gmail.users.messages.list({ userId: 'me', q, maxResults });
    if (!listRes.data.messages) return res.json({ messages: [] });

    const messages = await Promise.all(listRes.data.messages.map(async (m) => {
      const msg = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'metadata', metadataHeaders: ['From','To','Subject','Date'] });
      const headers = msg.data.payload.headers;
      return {
        id: msg.data.id, threadId: msg.data.threadId, snippet: msg.data.snippet,
        from: getHeader(headers, 'From'), to: getHeader(headers, 'To'),
        subject: getHeader(headers, 'Subject') || '(no subject)', date: getHeader(headers, 'Date'),
        labels: msg.data.labelIds || [], isUnread: (msg.data.labelIds || []).includes('UNREAD'),
      };
    }));

    res.json({ messages });
  } catch (err) {
    console.error('[Personal] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/personal/:id', requireAuth, async (req, res) => {
  try {
    const tokens = getStoredTokens(toStr(req.user.id));
    if (!tokens) return res.status(400).json({ error: 'Not connected' });

    const auth = getAuthenticatedClient(tokens);
    const gmail = google.gmail({ version: 'v1', auth });
    const msg = await gmail.users.messages.get({ userId: 'me', id: req.params.id, format: 'full' });
    const headers = msg.data.payload.headers;
    const body = extractBody(msg.data.payload);

    if ((msg.data.labelIds || []).includes('UNREAD')) {
      await gmail.users.messages.modify({ userId: 'me', id: req.params.id, requestBody: { removeLabelIds: ['UNREAD'] } });
    }

    res.json({
      id: msg.data.id, threadId: msg.data.threadId,
      from: getHeader(headers, 'From'), to: getHeader(headers, 'To'),
      cc: getHeader(headers, 'Cc'), subject: getHeader(headers, 'Subject'),
      date: getHeader(headers, 'Date'), body, labels: msg.data.labelIds || [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/personal/send', requireAuth, async (req, res) => {
  try {
    const tokens = getStoredTokens(toStr(req.user.id));
    if (!tokens) return res.status(400).json({ error: 'Not connected' });

    const auth = getAuthenticatedClient(tokens);
    const gmail = google.gmail({ version: 'v1', auth });
    const { to, cc, subject, body, threadId } = req.body;
    const fromEmail = toStr(tokens.email);

    let rawLines = ['From: ' + fromEmail, 'To: ' + to];
    if (cc) rawLines.push('Cc: ' + cc);
    rawLines.push('Subject: ' + (subject || ''));
    rawLines.push('MIME-Version: 1.0');
    rawLines.push('Content-Type: text/html; charset=utf-8');
    rawLines.push('');
    rawLines.push(body.replace(/\\n/g, '<br>'));

    const raw = Buffer.from(rawLines.join('\\r\\n')).toString('base64url');
    const params = { userId: 'me', requestBody: { raw } };
    if (threadId) params.requestBody.threadId = threadId;

    const result = await gmail.users.messages.send(params);
    res.json({ id: result.data.id, threadId: result.data.threadId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// REPLY — reply to a ticket via Gmail
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/reply', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const { ticketId, body } = req.body;
    if (!ticketId || !body) return res.status(400).json({ error: 'ticketId and body required' });

    const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    const originalMsg = db.prepare('SELECT * FROM messages WHERE ticket_id = ? AND gmail_thread_id IS NOT NULL ORDER BY sent_at ASC LIMIT 1').get(ticketId);
    if (!originalMsg) return res.status(400).json({ error: 'No Gmail thread for this ticket' });

    const gmailUserId = toStr(originalMsg.gmail_user_id);
    const tokens = getStoredTokens(gmailUserId);
    if (!tokens) return res.status(400).json({ error: 'Gmail not connected' });

    const auth = getAuthenticatedClient(tokens);
    const gmail = google.gmail({ version: 'v1', auth });
    const fromEmail = toStr(tokens.email);
    const toEmail = toStr(ticket.from_email);
    const subject = 'Re: ' + (toStr(ticket.subject) || '').replace(/^Re:\\s*/i, '');

    const rawLines = ['From: ' + fromEmail, 'To: ' + toEmail, 'Subject: ' + subject, 'MIME-Version: 1.0', 'Content-Type: text/html; charset=utf-8', '', body.replace(/\\n/g, '<br>')];
    const raw = Buffer.from(rawLines.join('\\r\\n')).toString('base64url');

    const result = await gmail.users.messages.send({
      userId: 'me', requestBody: { raw, threadId: toStr(originalMsg.gmail_thread_id) },
    });

    const msgId = 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2,6);
    db.prepare('INSERT INTO messages (id, ticket_id, direction, sender, body_text, sent_at, gmail_message_id, gmail_thread_id, gmail_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(msgId, ticketId, 'outbound', fromEmail, body, Date.now(), result.data.id, toStr(originalMsg.gmail_thread_id), gmailUserId);
    db.prepare("UPDATE tickets SET status = 'WAITING', last_activity_at = ?, assignee_user_id = ? WHERE id = ?")
      .run(Date.now(), toStr(req.user.id), ticketId);
    saveDb();

    res.json({ ok: true });
  } catch (err) {
    console.error('[Reply] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// EMAIL FILTERS
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/filters', requireAuth, (req, res) => {
  const db = getDb();
  const filters = db.prepare('SELECT * FROM email_filters ORDER BY created_at DESC').all();
  res.json({ filters: filters.map(f => ({ id: toStr(f.id), domain: toStr(f.domain), sender: toStr(f.sender), subject_contains: toStr(f.subject_contains), action: toStr(f.action) })) });
});

router.post('/filters', requireAuth, (req, res) => {
  const db = getDb();
  const { domain, sender, subject_contains, action } = req.body;
  if (!domain && !sender && !subject_contains) return res.status(400).json({ error: 'Need at least one criterion' });
  const id = 'ef-' + Date.now();
  db.prepare('INSERT INTO email_filters (id, domain, sender, subject_contains, action, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, domain || null, sender || null, subject_contains || null, action || 'personal', toStr(req.user.id), Date.now());
  saveDb();
  res.json({ id });
});

router.delete('/filters/:id', requireAuth, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM email_filters WHERE id = ?').run(req.params.id);
  saveDb();
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CONNECTED ACCOUNTS (admin view)
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/accounts', requireAuth, (req, res) => {
  const db = getDb();
  const accounts = db.prepare('SELECT gt.user_id, gt.email, u.name, es.last_sync_at FROM gmail_tokens gt JOIN users u ON u.id = gt.user_id LEFT JOIN email_sync_state es ON es.user_id = gt.user_id WHERE gt.access_token IS NOT NULL').all();
  res.json({ accounts: accounts.map(a => ({ userId: toStr(a.user_id), email: toStr(a.email), name: toStr(a.name), lastSync: a.last_sync_at })) });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CALENDAR
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/calendar/events', requireAuth, async (req, res) => {
  try {
    const tokens = getStoredTokens(toStr(req.user.id));
    if (!tokens) return res.status(400).json({ error: 'Not connected' });

    const auth = getAuthenticatedClient(tokens);
    const calendar = google.calendar({ version: 'v3', auth });
    const timeMin = req.query.timeMin || new Date().toISOString();
    const timeMax = req.query.timeMax || new Date(Date.now() + 7 * 86400000).toISOString();

    const result = await calendar.events.list({
      calendarId: 'primary', timeMin, timeMax, maxResults: 50, singleEvents: true, orderBy: 'startTime',
    });

    const events = (result.data.items || []).map(e => ({
      id: e.id, summary: e.summary || '(No title)', description: e.description || '',
      start: e.start.dateTime || e.start.date, end: e.end.dateTime || e.end.date,
      allDay: !e.start.dateTime, location: e.location || '',
      meetLink: e.hangoutLink || null,
      attendees: (e.attendees || []).map(a => ({ email: a.email, name: a.displayName, status: a.responseStatus })),
      htmlLink: e.htmlLink,
    }));

    res.json({ events });
  } catch (err) {
    console.error('[Calendar] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/calendar/events', requireAuth, async (req, res) => {
  try {
    const tokens = getStoredTokens(toStr(req.user.id));
    if (!tokens) return res.status(400).json({ error: 'Not connected' });

    const auth = getAuthenticatedClient(tokens);
    const calendar = google.calendar({ version: 'v3', auth });
    const { summary, description, startTime, endTime, attendees, addMeet } = req.body;

    const event = {
      summary, description: description || '',
      start: { dateTime: startTime, timeZone: 'America/New_York' },
      end: { dateTime: endTime, timeZone: 'America/New_York' },
    };
    if (attendees && attendees.length) event.attendees = attendees.map(e => ({ email: e }));
    if (addMeet) event.conferenceData = { createRequest: { requestId: 'cc-' + Date.now(), conferenceSolutionKey: { type: 'hangoutsMeet' } } };

    const result = await calendar.events.insert({
      calendarId: 'primary', requestBody: event, conferenceDataVersion: addMeet ? 1 : 0,
      sendUpdates: attendees ? 'all' : 'none',
    });

    res.json({ id: result.data.id, meetLink: result.data.hangoutLink || null, htmlLink: result.data.htmlLink });
  } catch (err) {
    console.error('[Calendar] Create error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/calendar/events/:id', requireAuth, async (req, res) => {
  try {
    const tokens = getStoredTokens(toStr(req.user.id));
    if (!tokens) return res.status(400).json({ error: 'Not connected' });
    const auth = getAuthenticatedClient(tokens);
    const calendar = google.calendar({ version: 'v3', auth });
    await calendar.events.delete({ calendarId: 'primary', eventId: req.params.id });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// DRIVE
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/drive/files', requireAuth, async (req, res) => {
  try {
    const tokens = getStoredTokens(toStr(req.user.id));
    if (!tokens) return res.status(400).json({ error: 'Not connected' });

    const auth = getAuthenticatedClient(tokens);
    const drive = google.drive({ version: 'v3', auth });
    const query = req.query.q || '';
    const folderId = req.query.folderId || null;

    let q = 'trashed = false';
    if (folderId) q += " and '" + folderId + "' in parents";
    else if (query) q += " and (name contains '" + query.replace(/'/g, "\\\\'") + "')";
    else q += " and 'root' in parents";

    const result = await drive.files.list({
      q, pageSize: 30, fields: 'files(id, name, mimeType, modifiedTime, size, webViewLink, shared)', orderBy: 'folder,modifiedTime desc',
    });

    const files = (result.data.files || []).map(f => ({
      id: f.id, name: f.name, mimeType: f.mimeType,
      isFolder: f.mimeType === 'application/vnd.google-apps.folder',
      modifiedTime: f.modifiedTime, size: f.size ? parseInt(f.size) : null,
      webViewLink: f.webViewLink, shared: f.shared,
    }));

    res.json({ files });
  } catch (err) {
    console.error('[Drive] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/drive/shared', requireAuth, async (req, res) => {
  try {
    const tokens = getStoredTokens(toStr(req.user.id));
    if (!tokens) return res.status(400).json({ error: 'Not connected' });
    const auth = getAuthenticatedClient(tokens);
    const drive = google.drive({ version: 'v3', auth });
    const result = await drive.files.list({
      q: 'sharedWithMe = true and trashed = false', pageSize: 30,
      fields: 'files(id, name, mimeType, modifiedTime, size, webViewLink, shared)', orderBy: 'modifiedTime desc',
    });
    res.json({ files: result.data.files || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
`, 'utf8');

console.log('✓ gmail.js — complete rewrite with ALL routes:');
console.log('  OAuth: /auth, /callback, /status, /disconnect');
console.log('  Sync: /sync');
console.log('  Personal: /personal, /personal/:id, /personal/send');
console.log('  Reply: /reply');
console.log('  Filters: /filters (GET/POST/DELETE)');
console.log('  Accounts: /accounts');
console.log('  Calendar: /calendar/events (GET/POST/DELETE)');
console.log('  Drive: /drive/files, /drive/shared');
console.log('\\nServer will auto-restart. You may need to reconnect Google Workspace.');
