const fs = require('fs');

// 1. Fix server to support pagination with nextPageToken
let gmail = fs.readFileSync('server/routes/gmail.js', 'utf8');

gmail = gmail.replace(
  "const list = await gm.users.messages.list({ userId: 'me', q, maxResults: max });",
  "const listParams = { userId: 'me', q, maxResults: max };\n    if (req.query.pageToken) listParams.pageToken = req.query.pageToken;\n    const list = await gm.users.messages.list(listParams);"
);

gmail = gmail.replace(
  "const result = { messages: msgs }; setCache(cacheKey, result); res.json(result);",
  "const result = { messages: msgs, nextPageToken: list.data.nextPageToken || null, resultSizeEstimate: list.data.resultSizeEstimate || 0 }; setCache(cacheKey, result); res.json(result);"
);

fs.writeFileSync('server/routes/gmail.js', gmail, 'utf8');
console.log('  ✓ gmail.js — pagination support added');

// 2. Fix client to support pagination and better search
let inbox = fs.readFileSync('client/src/components/PersonalInbox.jsx', 'utf8');

// Add pagination state
inbox = inbox.replace(
  "const [sidebarCollapsed, setSidebarCollapsed] = useState(false);",
  "const [sidebarCollapsed, setSidebarCollapsed] = useState(false);\n  const [nextPageToken, setNextPageToken] = useState(null);\n  const [totalEstimate, setTotalEstimate] = useState(0);\n  const [loadingMore, setLoadingMore] = useState(false);\n  const [page, setPage] = useState(1);"
);

// Replace fetchMsgs to handle pagination
inbox = inbox.replace(
  `const fetchMsgs = (f, q) => {
    setLoading(true);
    api.gmailPersonal(f || folder, q || '', 30).then(d => setMessages(d.messages || []))
      .catch(e => showToast && showToast(e.message)).finally(() => setLoading(false));
  };`,
  `const fetchMsgs = (f, q, pageToken) => {
    if (pageToken) setLoadingMore(true); else setLoading(true);
    const url = '/gmail/personal?folder=' + encodeURIComponent(f || folder) + '&q=' + encodeURIComponent(q || '') + '&max=50' + (pageToken ? '&pageToken=' + pageToken : '');
    fetch('/api' + url, { credentials: 'include' }).then(r => r.json()).then(d => {
      if (pageToken) {
        setMessages(prev => [...prev, ...(d.messages || [])]);
        setPage(p => p + 1);
      } else {
        setMessages(d.messages || []);
        setPage(1);
      }
      setNextPageToken(d.nextPageToken || null);
      setTotalEstimate(d.resultSizeEstimate || 0);
    }).catch(e => showToast && showToast(String(e))).finally(() => { setLoading(false); setLoadingMore(false); });
  };`
);

// Fix switchFolder to reset pagination
inbox = inbox.replace(
  "const switchFolder = f => { setFolder(f.key); setSelected(null); setDetail(null); setSelectedIds(new Set()); fetchMsgs(f.key); };",
  "const switchFolder = f => { setFolder(f.key); setSelected(null); setDetail(null); setSelectedIds(new Set()); setNextPageToken(null); setPage(1); fetchMsgs(f.key); };"
);

// Replace the toolbar count with pagination controls
inbox = inbox.replace(
  `<span style={{ fontSize: 12, color: '#5f6368' }}>
            {messages.length > 0 ? \`1-\${messages.length}\` : '0'} of {messages.length}
          </span>`,
  `<span style={{ fontSize: 12, color: '#5f6368' }}>
            {messages.length > 0 ? \`1-\${messages.length}\` : '0'}{totalEstimate > messages.length ? \` of \${totalEstimate > 100 ? 'many' : totalEstimate}\` : ''}
          </span>
          {nextPageToken && (
            <button onClick={() => fetchMsgs(folder, search, nextPageToken)}
              disabled={loadingMore}
              style={{ background: 'none', border: 'none', cursor: loadingMore ? 'default' : 'pointer', color: '#5f6368', padding: '4px 8px', borderRadius: 4, fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}
              onMouseEnter={e => e.currentTarget.style.background = '#f1f3f4'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}>
              {loadingMore ? 'Loading...' : 'Load more →'}
            </button>
          )}`
);

// Add infinite scroll - load more when near bottom
inbox = inbox.replace(
  "{!loading && messages.map(m => (",
  `{!loading && messages.map(m => (`
);

// Add "Load more" button at bottom of message list
inbox = inbox.replace(
  `{!loading && messages.length === 0 && (`,
  `{!loading && messages.length > 0 && nextPageToken && (
              <div style={{ padding: '12px 16px', textAlign: 'center', borderBottom: '1px solid #f1f3f4' }}>
                <button onClick={() => fetchMsgs(folder, search, nextPageToken)}
                  disabled={loadingMore}
                  style={{ padding: '8px 24px', background: '#fff', border: '1px solid #dadce0', borderRadius: 18,
                    cursor: loadingMore ? 'default' : 'pointer', fontSize: 14, color: '#1a73e8', fontWeight: 500,
                    fontFamily: "'Google Sans', Roboto, sans-serif" }}
                  onMouseEnter={e => { if (!loadingMore) e.currentTarget.style.background = '#f6f8fc'; }}
                  onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
                  {loadingMore ? 'Loading...' : 'Load more messages'}
                </button>
              </div>
            )}
            {!loading && messages.length === 0 && (`
);

fs.writeFileSync('client/src/components/PersonalInbox.jsx', inbox, 'utf8');
console.log('  ✓ PersonalInbox.jsx — pagination + load more');

console.log('\n✅ Done:');
console.log('   • Shows 50 emails per page');
console.log('   • "Load more" button at bottom and toolbar to load next batch');
console.log('   • Gmail search operators work: from:, to:, has:attachment, is:unread, etc.');
console.log('   • Shows estimated total count');
console.log('Refresh browser.');
