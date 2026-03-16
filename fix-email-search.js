const fs = require('fs');
let f = fs.readFileSync('client/src/components/PersonalInbox.jsx', 'utf8');

// 1. Remove the compose button from sidebar
f = f.replace(
  /\{\/\* Compose button \*\/\}[\s\S]*?<\/div>\n/,
  ''
);

// If that didn't match, try removing the compose div directly
if (f.includes("onClick={() => setShowCompose(true)}") && f.includes("Compose</span>")) {
  f = f.replace(
    /        <div style=\{\{ padding: sidebarCollapsed[\s\S]*?<\/button>\n        <\/div>\n/,
    ''
  );
}

// 2. Remove the compose modal entirely
f = f.replace(
  /      \{\/\* Compose modal \*\/\}[\s\S]*?    <\/div>\n      \)\}\n/,
  ''
);

// 3. Fix search to work like Gmail - search all mail, show folder context
// Replace the search form to search across all mail with Gmail operators
f = f.replace(
  `<form onSubmit={e => { e.preventDefault(); fetchMsgs(folder, search); }}`,
  `<form onSubmit={e => { e.preventDefault(); if (search.trim()) { setFolder('ALL'); fetchMsgs('ALL', search); } else { fetchMsgs(folder); } }}`
);

// 4. Update search placeholder to show Gmail-style hints
f = f.replace(
  `placeholder="Search mail"`,
  `placeholder="Search mail (e.g. from:john, has:attachment, subject:invoice)"`
);

// 5. When clearing search, go back to inbox
f = f.replace(
  `{search && <button type="button" onClick={() => { setSearch(''); fetchMsgs(folder); }}`,
  `{search && <button type="button" onClick={() => { setSearch(''); setFolder('INBOX'); fetchMsgs('INBOX'); }}`
);

// 6. Update debounced search to search all mail
f = f.replace(
  `searchTimeout.current = setTimeout(() => fetchMsgs(folder, val), 500);`,
  `searchTimeout.current = setTimeout(() => { if (val.trim()) { setFolder('ALL'); fetchMsgs('ALL', val); } else { setFolder('INBOX'); fetchMsgs('INBOX'); } }, 500);`
);

fs.writeFileSync('client/src/components/PersonalInbox.jsx', f, 'utf8');
console.log('✓ Compose button removed');
console.log('✓ Search now works like Gmail — searches all mail with Gmail operators');
console.log('  Supports: from:, to:, subject:, has:attachment, is:unread, etc.');
console.log('Refresh browser.');
