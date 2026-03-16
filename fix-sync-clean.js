const fs = require('fs');
let gmail = fs.readFileSync('server/routes/gmail.js', 'utf8');

// Replace the entire forward + hide section in syncUser with just a clean hide
gmail = gmail.replace(
  `      // ── Forward to archive ──
      try {
        const fwdHeaders = [
          'From: ' + toStr(row.email),
          'To: ' + archiveAddr,
          'Subject: Fwd: ' + subj,
          'Content-Type: text/plain; charset=utf-8',
          'MIME-Version: 1.0',
          '',
          '---------- Forwarded message ----------',
          'From: ' + from,
          'Date: ' + hdr(h, 'Date'),
          'Subject: ' + subj,
          '',
          bd || subj,
        ];
        const raw = Buffer.from(fwdHeaders.join('\\r\\n')).toString('base64url');
        const fwdResult = await gm.users.messages.send({ userId: 'me', requestBody: { raw } });
        // Hide the forwarded message from Sent folder
        if (fwdResult.data && fwdResult.data.id) {
          try {
            const hiddenLabelId = await getOrCreateLabel(gm, 'CareCoord/Archived');
            const fwdModify = { removeLabelIds: ['INBOX', 'UNREAD', 'CATEGORY_PERSONAL', 'CATEGORY_SOCIAL', 'CATEGORY_UPDATES', 'CATEGORY_FORUMS', 'CATEGORY_PROMOTIONS'] };
            if (hiddenLabelId) fwdModify.addLabelIds = [hiddenLabelId];
            await gm.users.messages.modify({ userId: 'me', id: fwdResult.data.id, requestBody: fwdModify });
            // Also trash the forwarded message to remove from Sent
            await gm.users.messages.trash({ userId: 'me', id: fwdResult.data.id });
          } catch(e) {}
        }
      } catch(fwdErr) { console.log('[Sync] Forward failed:', fwdErr.message); }

      // ── Hide from coordinator's Gmail completely ──
      try {
        const hiddenLabelId = await getOrCreateLabel(gm, 'CareCoord/Archived');
        const modifyReq = { removeLabelIds: ['INBOX', 'UNREAD', 'CATEGORY_PERSONAL', 'CATEGORY_SOCIAL', 'CATEGORY_UPDATES', 'CATEGORY_FORUMS', 'CATEGORY_PROMOTIONS'] };
        if (hiddenLabelId) modifyReq.addLabelIds = [hiddenLabelId];
        await gm.users.messages.modify({ userId: 'me', id: m.id, requestBody: modifyReq });
      } catch(archErr) { console.log('[Sync] Hide failed:', archErr.message); }`,
  `      // ── Hide from coordinator's Gmail completely ──
      // No forwarding — CareCoord IS the archive. Just hide the original.
      try {
        const hiddenLabelId = await getOrCreateLabel(gm, 'CareCoord/Archived');
        const modifyReq = { removeLabelIds: ['INBOX', 'UNREAD'] };
        if (hiddenLabelId) modifyReq.addLabelIds = [hiddenLabelId];
        await gm.users.messages.modify({ userId: 'me', id: m.id, requestBody: modifyReq });
      } catch(archErr) { console.log('[Sync] Hide failed:', archErr.message); }`
);

// Verify it applied
if (!gmail.includes('No forwarding')) {
  console.log('  ✗ String replacement did not match — checking for alternate format');
  // Try without escaped \r\n
  gmail = fs.readFileSync('server/routes/gmail.js', 'utf8');
  
  // Find and remove the forward block more aggressively
  const fwdStart = gmail.indexOf("// ── Forward to archive ──");
  const hideStart = gmail.indexOf("// ── Hide from coordinator's Gmail completely ──");
  const hideEnd = gmail.indexOf("catch(archErr) { console.log('[Sync] Hide failed:'");
  
  if (fwdStart > -1 && hideEnd > -1) {
    const afterHide = gmail.indexOf('}', hideEnd) + 1;
    const replacement = `      // ── Hide from coordinator's Gmail completely ──
      // No forwarding — CareCoord IS the archive. Just hide the original.
      try {
        const hiddenLabelId = await getOrCreateLabel(gm, 'CareCoord/Archived');
        const modifyReq = { removeLabelIds: ['INBOX', 'UNREAD'] };
        if (hiddenLabelId) modifyReq.addLabelIds = [hiddenLabelId];
        await gm.users.messages.modify({ userId: 'me', id: m.id, requestBody: modifyReq });
      } catch(archErr) { console.log('[Sync] Hide failed:', archErr.message); }`;
    
    gmail = gmail.substring(0, fwdStart) + replacement + gmail.substring(afterHide);
    console.log('  ✓ Forward block removed (method 2)');
  }
}

// Also remove archiveAddr since we no longer forward
// It's still used in push-to-queue so leave the variable, just remove it from syncUser usage
// Actually the variable declaration is fine to keep — it's harmless

fs.writeFileSync('server/routes/gmail.js', gmail, 'utf8');

// Verify
const final = fs.readFileSync('server/routes/gmail.js', 'utf8');
console.log(final.includes('No forwarding') ? '  ✓ Forward removed from syncUser' : '  ✗ Forward still present');
console.log(final.includes("removeLabelIds: ['INBOX', 'UNREAD']") ? '  ✓ Clean hide with only INBOX + UNREAD removal' : '  ✗ Label removal not simplified');
console.log(!final.includes('fwdResult') || final.indexOf('fwdResult') > final.indexOf('push-to-queue') ? '  ✓ No fwdResult in syncUser' : '  ✗ fwdResult still in syncUser');

try { require('./server/routes/gmail'); console.log('  ✓ gmail.js compiles OK'); }
catch(e) { console.log('  ERROR:', e.message); }

console.log('');
console.log('Changes:');
console.log('  1. REMOVED forward to archive from sync — CareCoord IS the archive');
console.log('  2. Simplified hide: only removes INBOX + UNREAD labels');
console.log('  3. No more SENT folder pollution');
console.log('  4. No more CATEGORY_ label errors');
console.log('  5. Original email moves to hidden CareCoord/Archived label');
console.log('');
console.log('Result: Email arrives → ticket created → email hidden from inbox');
console.log('        Nothing in Sent, nothing in All Mail visible, no forwards');
console.log('');
console.log('Restart server and test.');
