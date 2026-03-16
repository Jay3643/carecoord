const fs = require('fs');
let gmail = fs.readFileSync('server/routes/gmail.js', 'utf8');

// 1. Add role check at the top of syncUser - match the EXACT text
gmail = gmail.replace(
  `async function syncUser(db, row) {
  const auth = authClient(row), gm = google.gmail({version:'v1',auth}), uid = toStr(row.user_id);
  const regions = db.prepare('SELECT region_id FROM user_regions WHERE user_id=?').all(uid);
  if (!regions.length) return 0;`,
  `async function syncUser(db, row) {
  const auth = authClient(row), gm = google.gmail({version:'v1',auth}), uid = toStr(row.user_id);

  // Role-based routing: admin and supervisor skip sync entirely
  const userRow = db.prepare('SELECT role FROM users WHERE id = ?').get(uid);
  const role = userRow ? toStr(userRow.role) : 'coordinator';
  if (role === 'admin' || role === 'supervisor') return 0;

  const regions = db.prepare('SELECT region_id FROM user_regions WHERE user_id=?').all(uid);
  if (!regions.length) return 0;`
);

// 2. Add hidden label helper function
if (!gmail.includes('getOrCreateLabel')) {
  gmail = gmail.replace(
    "// ── OAuth ──",
    `// ── Hidden label for archived coordinator emails ──
const labelCache = {};
async function getOrCreateLabel(gm, name) {
  if (labelCache[name]) return labelCache[name];
  try {
    const list = await gm.users.labels.list({ userId: 'me' });
    const existing = (list.data.labels || []).find(l => l.name === name);
    if (existing) { labelCache[name] = existing.id; return existing.id; }
    const created = await gm.users.labels.create({ userId: 'me', requestBody: {
      name, labelListVisibility: 'labelHide', messageListVisibility: 'hide'
    }});
    labelCache[name] = created.data.id;
    return created.data.id;
  } catch(e) { console.log('[Label] Error:', e.message); return null; }
}

// ── OAuth ──`
  );
}

// 3. Replace the simple inbox removal with hidden label move
gmail = gmail.replace(
  `      // ── Remove from coordinator's inbox (archive it) ──
      try {
        await gm.users.messages.modify({ userId: 'me', id: m.id, requestBody: { removeLabelIds: ['INBOX'] } });
      } catch(archErr) { console.log('[Sync] Archive failed:', archErr.message); }`,
  `      // ── Hide from coordinator's Gmail completely ──
      try {
        const hiddenLabelId = await getOrCreateLabel(gm, 'CareCoord/Archived');
        const modifyReq = { removeLabelIds: ['INBOX', 'UNREAD', 'SENT', 'CATEGORY_PERSONAL', 'CATEGORY_SOCIAL', 'CATEGORY_UPDATES', 'CATEGORY_FORUMS', 'CATEGORY_PROMOTIONS'] };
        if (hiddenLabelId) modifyReq.addLabelIds = [hiddenLabelId];
        await gm.users.messages.modify({ userId: 'me', id: m.id, requestBody: modifyReq });
      } catch(archErr) { console.log('[Sync] Hide failed:', archErr.message); }`
);

// 4. Also upgrade push-to-queue to use hidden label
gmail = gmail.replace(
  "try { await gm.users.messages.modify({ userId: 'me', id: gmailMessageId, requestBody: { removeLabelIds: ['INBOX'] } }); } catch(e) {}",
  `try {
      const hiddenLabelId = await getOrCreateLabel(gm, 'CareCoord/Archived');
      const modReq = { removeLabelIds: ['INBOX', 'UNREAD', 'SENT', 'CATEGORY_PERSONAL', 'CATEGORY_SOCIAL', 'CATEGORY_UPDATES', 'CATEGORY_FORUMS', 'CATEGORY_PROMOTIONS'] };
      if (hiddenLabelId) modReq.addLabelIds = [hiddenLabelId];
      await gm.users.messages.modify({ userId: 'me', id: gmailMessageId, requestBody: modReq });
    } catch(e) {}`
);

// 5. Upgrade pull-from-queue to remove hidden label and restore to inbox
gmail = gmail.replace(
  `try { await gm.users.messages.modify({ userId: 'me', id: m.gmail_message_id, requestBody: { addLabelIds: ['INBOX'] } }); } catch(e) {}`,
  `try {
        const hiddenLabelId = await getOrCreateLabel(gm, 'CareCoord/Archived');
        const modReq = { addLabelIds: ['INBOX'] };
        if (hiddenLabelId) modReq.removeLabelIds = [hiddenLabelId];
        await gm.users.messages.modify({ userId: 'me', id: m.gmail_message_id, requestBody: modReq });
      } catch(e) {}`
);

fs.writeFileSync('server/routes/gmail.js', gmail, 'utf8');

// Verify
try {
  require('./server/routes/gmail');
  console.log('✓ gmail.js compiles OK');
  
  // Double check role check is there
  const final = fs.readFileSync('server/routes/gmail.js', 'utf8');
  const syncStart = final.indexOf('async function syncUser');
  const snippet = final.substring(syncStart, syncStart + 400);
  console.log(snippet.includes("role === 'admin'") ? '✓ Role check confirmed in syncUser' : '✗ Role check MISSING');
  console.log(snippet.includes('getOrCreateLabel') || final.includes('getOrCreateLabel') ? '✓ Hidden label helper confirmed' : '✗ Hidden label MISSING');
} catch(e) { console.log('ERROR:', e.message); }
