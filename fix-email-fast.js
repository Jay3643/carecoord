const fs = require('fs');
let gmail = fs.readFileSync('server/routes/gmail.js', 'utf8');

// Replace the personal endpoint with a much faster version
// Gmail's messages.list already returns threadId and snippet
// Use format=METADATA with batch to get headers in one go
gmail = gmail.replace(
  /router\.get\('\/personal', requireAuth, async \(req, res\) => \{[\s\S]*?\}\);/,
  `router.get('/personal', requireAuth, async (req, res) => {
  try {
    const t = getTokens(req.user.id); if (!t) return res.json({ messages: [] });
    const gm = google.gmail({version:'v1',auth:authClient(t)});
    
    const folderMap = {
      INBOX: 'in:inbox', SENT: 'in:sent', DRAFT: 'in:drafts', STARRED: 'is:starred',
      SPAM: 'in:spam', TRASH: 'in:trash', IMPORTANT: 'is:important', ALL: '',
      SCHEDULED: 'in:scheduled',
      CATEGORY_SOCIAL: 'category:social', CATEGORY_UPDATES: 'category:updates',
      CATEGORY_FORUMS: 'category:forums', CATEGORY_PROMOTIONS: 'category:promotions',
    };
    let q = folderMap[req.query.folder || 'INBOX'];
    if (q === undefined) q = 'in:inbox';
    if (req.query.q) q += ' ' + req.query.q;
    
    const max = Math.min(parseInt(req.query.max) || 25, 25);
    const list = await gm.users.messages.list({ userId: 'me', q, maxResults: max });
    if (!list.data.messages) return res.json({ messages: [] });
    
    // Fetch all in parallel but use METADATA format (lighter than FULL)
    const results = await Promise.allSettled(
      list.data.messages.slice(0, max).map(m =>
        gm.users.messages.get({ userId: 'me', id: m.id, format: 'METADATA', metadataHeaders: ['From','To','Subject','Date'] })
      )
    );
    
    const msgs = [];
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      const msg = r.value.data;
      const h = msg.payload?.headers || [];
      msgs.push({
        id: msg.id, threadId: msg.threadId, snippet: msg.snippet || '',
        from: hdr(h,'From'), to: hdr(h,'To'),
        subject: hdr(h,'Subject') || '(no subject)',
        date: hdr(h,'Date'),
        labels: msg.labelIds || [],
        isUnread: (msg.labelIds || []).includes('UNREAD'),
        hasAttachment: (msg.payload?.parts || []).some(p => p.filename && p.filename.length > 0),
      });
    }
    res.json({ messages: msgs });
  } catch(e) { console.error('[Gmail]', e.message); res.status(500).json({ error: e.message }); }
});`
);

// Also add server-side caching for the personal inbox
// Cache results for 15 seconds to avoid hammering Gmail API
gmail = gmail.replace(
  "let lastSyncTime = 0;",
  `let lastSyncTime = 0;
const inboxCache = new Map();
function getCached(key) { const c = inboxCache.get(key); if (c && Date.now() - c.ts < 15000) return c.data; return null; }
function setCache(key, data) { inboxCache.set(key, { data, ts: Date.now() }); if (inboxCache.size > 50) { const first = inboxCache.keys().next().value; inboxCache.delete(first); } }`
);

// Use cache in the personal endpoint
gmail = gmail.replace(
  "const max = Math.min(parseInt(req.query.max) || 25, 25);",
  `const max = Math.min(parseInt(req.query.max) || 25, 25);
    const cacheKey = req.user.id + ':' + q + ':' + max;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);`
);

gmail = gmail.replace(
  "res.json({ messages: msgs });",
  "const result = { messages: msgs }; setCache(cacheKey, result); res.json(result);"
);

fs.writeFileSync('server/routes/gmail.js', gmail, 'utf8');
console.log('✓ Gmail personal inbox:');
console.log('  • Parallel METADATA fetch (lightest format)');
console.log('  • 15-second server cache (instant on repeat loads)');
console.log('  • Max 25 per page');
console.log('Refresh browser.');
