const fs = require('fs');
let gmail = fs.readFileSync('server/routes/gmail.js', 'utf8');

// Find the forward section in syncUser and capture the sent message ID to hide it
// Current code sends the forward but doesn't hide the resulting sent message
gmail = gmail.replace(
  `// ── Forward to archive ──
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
        await gm.users.messages.send({ userId: 'me', requestBody: { raw } });
      } catch(fwdErr) { console.log('[Sync] Forward failed:', fwdErr.message); }`,
  `// ── Forward to archive ──
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
      } catch(fwdErr) { console.log('[Sync] Forward failed:', fwdErr.message); }`
);

// If the above didn't match (different line endings), try the version with \r\n literal
if (!gmail.includes('fwdResult')) {
  gmail = gmail.replace(
    /\/\/ ── Forward to archive ──\s*\n\s*try \{\s*\n\s*const fwdHeaders[\s\S]*?await gm\.users\.messages\.send\(\{ userId: 'me', requestBody: \{ raw \} \}\);\s*\n\s*\} catch\(fwdErr\)/,
    `// ── Forward to archive ──
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
        if (fwdResult.data && fwdResult.data.id) {
          try { await gm.users.messages.trash({ userId: 'me', id: fwdResult.data.id }); } catch(e) {}
        }
      } catch(fwdErr)`
  );
}

console.log(gmail.includes('fwdResult') ? '  ✓ Forward message now trashed after sending' : '  ✗ Could not find forward block — check manually');

fs.writeFileSync('server/routes/gmail.js', gmail, 'utf8');

try { require('./server/routes/gmail'); console.log('  ✓ gmail.js compiles OK'); }
catch(e) { console.log('  ERROR:', e.message); }

console.log('');
console.log('Restart server and test.');
