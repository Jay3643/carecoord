// fix-hide-synced.js
// Filters Personal Email to exclude messages already synced as tickets

const fs = require('fs');
let gmail = fs.readFileSync('server/routes/gmail.js', 'utf8');

// Replace the personal inbox route to filter out synced messages
gmail = gmail.replace(
  `const msgs = await Promise.all(list.data.messages.map(async m => {
      const msg = await gmail.users.messages.get({userId:'me',id:m.id,format:'metadata',metadataHeaders:['From','To','Subject','Date']});
      const h = msg.data.payload.headers;
      return { id:msg.data.id, threadId:msg.data.threadId, snippet:msg.data.snippet, from:hdr(h,'From'), to:hdr(h,'To'), subject:hdr(h,'Subject')||'(no subject)', date:hdr(h,'Date'), labels:msg.data.labelIds||[], isUnread:(msg.data.labelIds||[]).includes('UNREAD') };
    }));
    res.json({ messages: msgs });`,
  `// Get list of synced gmail message IDs to hide from personal
    const syncedIds = new Set(getDb().prepare("SELECT gmail_message_id FROM messages WHERE gmail_message_id IS NOT NULL").all().map(r => r.gmail_message_id));
    const msgs = [];
    for (const m of list.data.messages) {
      if (syncedIds.has(m.id)) continue; // Hide synced emails
      const msg = await gmail.users.messages.get({userId:'me',id:m.id,format:'metadata',metadataHeaders:['From','To','Subject','Date']});
      const h = msg.data.payload.headers;
      msgs.push({ id:msg.data.id, threadId:msg.data.threadId, snippet:msg.data.snippet, from:hdr(h,'From'), to:hdr(h,'To'), subject:hdr(h,'Subject')||'(no subject)', date:hdr(h,'Date'), labels:msg.data.labelIds||[], isUnread:(msg.data.labelIds||[]).includes('UNREAD') });
    }
    res.json({ messages: msgs });`
);

fs.writeFileSync('server/routes/gmail.js', gmail, 'utf8');
console.log('✓ Personal Email now hides emails that were synced as tickets');
console.log('Refresh browser.');
