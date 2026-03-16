const fs = require('fs');

// 1. Add a simple cache layer to api.js
let api = fs.readFileSync('client/src/api.js', 'utf8');

api = api.replace(
  "const BASE = '/api';",
  `const BASE = '/api';

const cache = {};
function cached(key, ttlMs, fn) {
  const entry = cache[key];
  if (entry && Date.now() - entry.ts < ttlMs) return Promise.resolve(entry.data);
  return fn().then(data => { cache[key] = { data, ts: Date.now() }; return data; });
}
function invalidate(prefix) {
  Object.keys(cache).forEach(k => { if (k.startsWith(prefix)) delete cache[k]; });
}
export function clearCache(prefix) { if (prefix) invalidate(prefix); else Object.keys(cache).forEach(k => delete cache[k]); }`
);

// Cache reference data 5 min
api = api.replace(
  "getRegions: () => request('/regions'),",
  "getRegions: () => cached('regions', 300000, () => request('/regions')),"
);
api = api.replace(
  "getUsers: () => request('/users'),",
  "getUsers: () => cached('users', 300000, () => request('/users')),"
);
api = api.replace(
  "getTags: () => request('/tags').catch(() => ({ tags: [] })),",
  "getTags: () => cached('tags', 300000, () => request('/tags').catch(() => ({ tags: [] }))),"
);
api = api.replace(
  "getCloseReasons: () => request('/close-reasons').catch(() => ({ reasons: [] })),",
  "getCloseReasons: () => cached('reasons', 300000, () => request('/close-reasons').catch(() => ({ reasons: [] }))),"
);

// Cache Gmail status 60s
api = api.replace(
  "gmailStatus: () => request('/gmail/status'),",
  "gmailStatus: () => cached('gmailStatus', 60000, () => request('/gmail/status')),"
);

// Cache Gmail personal 30s
api = api.replace(
  "gmailPersonal: (f, q, m) => request('/gmail/personal?folder='+(f||'INBOX')+'&q='+encodeURIComponent(q||'')+'&max='+(m||20)),",
  "gmailPersonal: (f, q, m) => cached('gmail:'+f+':'+q, 30000, () => request('/gmail/personal?folder='+(f||'INBOX')+'&q='+encodeURIComponent(q||'')+'&max='+(m||20))),"
);

// Cache calendar 30s
api = api.replace(
  "calendarEvents: (min, max) => request('/gmail/calendar/events?timeMin='+(min||'')+'&timeMax='+(max||'')),",
  "calendarEvents: (min, max) => cached('cal:'+min+':'+max, 30000, () => request('/gmail/calendar/events?timeMin='+(min||'')+'&timeMax='+(max||''))),"
);

// Cache drive 30s
api = api.replace(
  "driveFiles: (q, fid, pt) => request('/gmail/drive/files?q='+encodeURIComponent(q||'')+(fid?'&folderId='+fid:'')+(pt?'&pageToken='+pt:'')),",
  "driveFiles: (q, fid, pt) => cached('drive:'+q+':'+fid, 30000, () => request('/gmail/drive/files?q='+encodeURIComponent(q||'')+(fid?'&folderId='+fid:'')+(pt?'&pageToken='+pt:''))),"
);

fs.writeFileSync('client/src/api.js', api, 'utf8');
console.log('  ✓ api.js — client-side caching');

// 2. Only load ref data once per login
let app = fs.readFileSync('client/src/App.jsx', 'utf8');
app = app.replace(
  "}, [currentUser, showToast]);",
  "}, [currentUser?.id]);"
);
fs.writeFileSync('client/src/App.jsx', app, 'utf8');
console.log('  ✓ App.jsx — ref data loads once');

// 3. Remove redundant sync from QueueScreen
let queue = fs.readFileSync('client/src/components/QueueScreen.jsx', 'utf8');
queue = queue.replace(
  "if (mode === 'region') await api.gmailAutoSync().catch(() => {});",
  "// sync handled by background polling"
);
fs.writeFileSync('client/src/components/QueueScreen.jsx', queue, 'utf8');
console.log('  ✓ QueueScreen.jsx — no redundant sync');

console.log('\n✅ Performance fixes applied. Refresh browser.');
