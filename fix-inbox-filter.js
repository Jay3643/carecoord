const fs = require('fs');
let gmail = fs.readFileSync('server/routes/gmail.js', 'utf8');

// Replace the syncedIds approach with a watermark-based approach
// Any email after the watermark goes to regional queue, not personal inbox
if (gmail.includes('syncedIds')) {
  gmail = gmail.replace(
    "// Get list of synced gmail message IDs to hide from personal\n    const syncedIds = new Set(getDb().prepare(\"SELECT gmail_message_id FROM messages WHERE gmail_message_id IS NOT NULL\").all().map(r => r.gmail_message_id));",
    "// Hide emails that arrived after the sync watermark (they go to regional queue)\n    const syncState = getDb().prepare('SELECT last_sync_at FROM email_sync_state WHERE user_id = ?').get(req.user.id);\n    const watermark = syncState ? syncState.last_sync_at : null;\n    // Also get synced IDs as backup\n    const syncedIds = new Set(getDb().prepare(\"SELECT gmail_message_id FROM messages WHERE gmail_message_id IS NOT NULL\").all().map(r => r.gmail_message_id));"
  );

  gmail = gmail.replace(
    "if (syncedIds.has(m.id)) continue; // Hide synced emails",
    "if (syncedIds.has(m.id)) continue; // Hide already-synced emails"
  );

  // Add watermark check after getting each message
  gmail = gmail.replace(
    "const msg = await gmail.users.messages.get({userId:'me',id:m.id,format:'metadata',metadataHeaders:['From','To','Subject','Date']});",
    "const msg = await gmail.users.messages.get({userId:'me',id:m.id,format:'metadata',metadataHeaders:['From','To','Subject','Date']});\n      // Hide emails newer than watermark (they belong in regional queue)\n      const msgDate = parseInt(msg.data.internalDate);\n      if (watermark && msgDate > watermark) continue;"
  );
}

fs.writeFileSync('server/routes/gmail.js', gmail, 'utf8');
console.log('✓ Personal inbox now hides all emails after the sync watermark');
console.log('  - Pre-watermark emails → Personal Inbox only');
console.log('  - Post-watermark emails → Regional Queue only');
console.log('Refresh browser.');
