const fs = require('fs');
let gmail = fs.readFileSync('server/routes/gmail.js', 'utf8');

// Remove the watermark and syncedIds filtering from personal inbox
// These were hiding emails that got synced to the queue
// User wants to see their FULL inbox like regular Gmail

// Remove the syncState/watermark/syncedIds block
gmail = gmail.replace(
  `    // Hide emails that arrived after the sync watermark (they go to regional queue)
    const syncState = getDb().prepare('SELECT last_sync_at FROM email_sync_state WHERE user_id = ?').get(req.user.id);
    const watermark = syncState ? syncState.last_sync_at : null;
    // Also get synced IDs as backup
    const syncedIds = new Set(getDb().prepare("SELECT gmail_message_id FROM messages WHERE gmail_message_id IS NOT NULL").all().map(r => r.gmail_message_id));`,
  `// Show full inbox - no filtering`
);

// Remove the syncedIds check
gmail = gmail.replace(
  `      if (syncedIds.has(m.id)) continue; // Hide already-synced emails`,
  ``
);

// Remove the watermark date check  
gmail = gmail.replace(
  `      // Hide emails newer than watermark (they belong in regional queue)
      const msgDate = parseInt(msg.data.internalDate);
      if (watermark && msgDate > watermark) continue;`,
  ``
);

fs.writeFileSync('server/routes/gmail.js', gmail, 'utf8');

try { require('./server/routes/gmail'); console.log('✓ gmail.js — full inbox access, no filtering'); }
catch(e) { console.log('ERROR:', e.message); }
