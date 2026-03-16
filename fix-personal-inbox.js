// fix-personal-inbox.js
const fs = require('fs');
const path = require('path');

const gmailPath = path.join(__dirname, 'server', 'routes', 'gmail.js');
let gmail = fs.readFileSync(gmailPath, 'utf8');

// Replace the entire /personal endpoint to show ALL emails without filtering
const oldPersonal = /router\.get\('\/personal', requireAuth, async[\s\S]*?res\.json\(\{ messages \}\);\s*\} catch \(err\) \{\s*console\.error\('\[Gmail Personal\][\s\S]*?\}\s*\}\);/;

gmail = gmail.replace(oldPersonal, `router.get('/personal', requireAuth, async (req, res) => {
  try {
    const tokens = getStoredTokens(req.user.id);
    if (!tokens) return res.status(400).json({ error: 'Google Workspace not connected' });

    const auth = getAuthenticatedClient(tokens);
    const gmail = google.gmail({ version: 'v1', auth });

    const folder = req.query.folder || 'INBOX';
    const query = req.query.q || '';
    const maxResults = parseInt(req.query.max) || 20;

    const folderMap = {
      INBOX: 'in:inbox',
      SENT: 'in:sent',
      DRAFT: 'in:drafts',
      STARRED: 'is:starred',
      SPAM: 'in:spam',
      TRASH: 'in:trash',
      ALL: '',
    };

    let q = query || folderMap[folder] || 'in:inbox';

    const listRes = await gmail.users.messages.list({
      userId: 'me',
      q: q,
      maxResults,
    });

    if (!listRes.data.messages || listRes.data.messages.length === 0) {
      return res.json({ messages: [] });
    }

    const messages = await Promise.all(
      listRes.data.messages.map(async (m) => {
        const msg = await gmail.users.messages.get({
          userId: 'me', id: m.id, format: 'metadata',
          metadataHeaders: ['From', 'To', 'Subject', 'Date'],
        });
        const headers = msg.data.payload.headers;
        return {
          id: msg.data.id,
          threadId: msg.data.threadId,
          snippet: msg.data.snippet,
          from: getHeader(headers, 'From'),
          to: getHeader(headers, 'To'),
          subject: getHeader(headers, 'Subject') || '(no subject)',
          date: getHeader(headers, 'Date'),
          labels: msg.data.labelIds || [],
          isUnread: (msg.data.labelIds || []).includes('UNREAD'),
        };
      })
    );

    // Refresh tokens if updated
    const newTokens = auth.credentials;
    if (newTokens.access_token !== toStr(tokens.access_token)) {
      storeTokens(req.user.id, newTokens, toStr(tokens.email));
    }

    res.json({ messages });
  } catch (err) {
    console.error('[Gmail Personal] Error:', err.message);
    if (err.code === 401) return res.status(401).json({ error: 'Google auth expired. Please reconnect.' });
    res.status(500).json({ error: err.message });
  }
});`);

fs.writeFileSync(gmailPath, gmail, 'utf8');
console.log('✓ Personal inbox now shows ALL emails — no filtering');
console.log('  Routing rules only affect which NEW emails create regional tickets');
console.log('Refresh browser, click Email tab.');
