const fs = require('fs');
let gmail = fs.readFileSync('server/routes/gmail.js', 'utf8');

// Remove the orphaned code block between the first /personal route and /personal/:id
// It starts with "    const gm = google.gmail" and ends with the duplicate "});" before /personal/:id
gmail = gmail.replace(
  `  } catch(e) { console.error('[Gmail]', e.message); res.status(500).json({ error: e.message }); }
});
    const gm = google.gmail({version:'v1',auth:authClient(t)});
    
    // Build query based on folder
    const folderMap = {
      INBOX: 'in:inbox', SENT: 'in:sent', DRAFT: 'in:drafts', STARRED: 'is:starred',
      SPAM: 'in:spam', TRASH: 'in:trash', IMPORTANT: 'is:important', ALL: '',
      SCHEDULED: 'in:scheduled',
      CATEGORY_SOCIAL: 'category:social', CATEGORY_UPDATES: 'category:updates',
      CATEGORY_FORUMS: 'category:forums', CATEGORY_PROMOTIONS: 'category:promotions',
    };
    let q = folderMap[req.query.folder || 'INBOX'] || 'in:inbox';
    if (req.query.q) q += ' ' + req.query.q;
    
    const list = await gm.users.messages.list({ userId: 'me', q, maxResults: parseInt(req.query.max) || 30 });
    if (!list.data.messages) return res.json({ messages: [] });
    
    // Batch fetch all messages in parallel (much faster than sequential)
    const ids = list.data.messages.map(m => m.id);
    const batchResults = await Promise.all(
      ids.map(id => gm.users.messages.get({
        userId: 'me', id, format: 'metadata',
        metadataHeaders: ['From', 'To', 'Subject', 'Date']
      }).catch(() => null))
    );
    
    const msgs = [];
    for (const msg of batchResults) {
      if (!msg) continue;
      const h = msg.data.payload.headers;
      const hasAtt = (msg.data.payload.parts || []).some(p => p.filename && p.filename.length > 0);
      msgs.push({
        id: msg.data.id, threadId: msg.data.threadId, snippet: msg.data.snippet,
        from: hdr(h, 'From'), to: hdr(h, 'To'),
        subject: hdr(h, 'Subject') || '(no subject)', date: hdr(h, 'Date'),
        labels: msg.data.labelIds || [],
        isUnread: (msg.data.labelIds || []).includes('UNREAD'),
        hasAttachment: hasAtt,
      });
    }
    res.json({ messages: msgs });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
router.get('/personal/:id',`,
  `  } catch(e) { console.error('[Gmail]', e.message); res.status(500).json({ error: e.message }); }
});
router.get('/personal/:id',`
);

fs.writeFileSync('server/routes/gmail.js', gmail, 'utf8');

// Verify
try { require('./server/routes/gmail'); console.log('✓ gmail.js compiles OK — orphaned code removed'); }
catch(e) { console.log('ERROR:', e.message); }
