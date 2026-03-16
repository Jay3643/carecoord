const fs = require('fs');
let f = fs.readFileSync('client/src/components/PersonalInbox.jsx', 'utf8');

// 1. Update the detail view to show attachments
// Add attachments to the gmailPersonalMsg response parsing
// Find the body render and add attachments after it
f = f.replace(
  `<div style={{ fontSize: 14, lineHeight: 1.6, color: '#202124', padding: '0 0 24px 52px', wordBreak: 'break-word' }}
                  dangerouslySetInnerHTML={{ __html: detail.body }} />`,
  `<div style={{ fontSize: 14, lineHeight: 1.6, color: '#202124', padding: '0 0 12px 52px', wordBreak: 'break-word' }}
                  dangerouslySetInnerHTML={{ __html: detail.body }} />

                {/* Attachments */}
                {detail.attachments && detail.attachments.length > 0 && (
                  <div style={{ padding: '0 0 24px 52px', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {detail.attachments.map((att, i) => (
                      <a key={i} href={att.url || '#'} target="_blank" rel="noopener noreferrer" download={att.filename}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
                          border: '1px solid #dadce0', borderRadius: 8, textDecoration: 'none', color: '#202124',
                          fontSize: 13, background: '#fff', maxWidth: 220, cursor: 'pointer', transition: 'background 0.1s' }}
                        onMouseEnter={e => e.currentTarget.style.background = '#f1f3f4'}
                        onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
                        <div style={{ width: 32, height: 32, borderRadius: 4, background: att.mimeType?.includes('image') ? '#e8f0fe' : att.mimeType?.includes('pdf') ? '#fce8e6' : att.mimeType?.includes('sheet') || att.mimeType?.includes('excel') ? '#e6f4ea' : att.mimeType?.includes('doc') || att.mimeType?.includes('word') ? '#e8f0fe' : '#f1f3f4',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 11, fontWeight: 600,
                          color: att.mimeType?.includes('image') ? '#1a73e8' : att.mimeType?.includes('pdf') ? '#ea4335' : att.mimeType?.includes('sheet') ? '#34a853' : '#5f6368' }}>
                          {att.mimeType?.includes('image') ? '🖼' : att.mimeType?.includes('pdf') ? 'PDF' : att.mimeType?.includes('sheet') || att.mimeType?.includes('excel') ? 'XLS' : att.mimeType?.includes('doc') || att.mimeType?.includes('word') ? 'DOC' : '📎'}
                        </div>
                        <div style={{ overflow: 'hidden', minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{att.filename}</div>
                          {att.size && <div style={{ fontSize: 11, color: '#5f6368' }}>{att.size > 1024*1024 ? (att.size/1024/1024).toFixed(1)+' MB' : Math.round(att.size/1024)+' KB'}</div>}
                        </div>
                      </a>
                    ))}
                  </div>
                )}`
);

// 2. Add attachment indicator in message list (paperclip icon)
f = f.replace(
  `<span style={{ fontSize: 12, color: m.isUnread ? '#202124' : '#5f6368', fontWeight: m.isUnread ? 700 : 400,
                  flexShrink: 0, marginLeft: 8 }}>
                  {formatDate(m.date)}
                </span>`,
  `{m.hasAttachment && <span style={{ color: '#5f6368', fontSize: 14, flexShrink: 0 }} title="Has attachment">📎</span>}
                <span style={{ fontSize: 12, color: m.isUnread ? '#202124' : '#5f6368', fontWeight: m.isUnread ? 700 : 400,
                  flexShrink: 0, marginLeft: 8 }}>
                  {formatDate(m.date)}
                </span>`
);

fs.writeFileSync('client/src/components/PersonalInbox.jsx', f, 'utf8');
console.log('  ✓ PersonalInbox.jsx — attachments in detail + paperclip in list');

// 3. Update the server to return attachment info
let gmail = fs.readFileSync('server/routes/gmail.js', 'utf8');

// Add hasAttachment flag to personal inbox list
gmail = gmail.replace(
  "msgs.push({ id:msg.data.id, threadId:msg.data.threadId, snippet:msg.data.snippet, from:hdr(h,'From'), to:hdr(h,'To'), subject:hdr(h,'Subject')||'(no subject)', date:hdr(h,'Date'), labels:msg.data.labelIds||[], isUnread:(msg.data.labelIds||[]).includes('UNREAD') });",
  "const hasAtt = (msg.data.payload.parts||[]).some(p => p.filename && p.filename.length > 0);\n      msgs.push({ id:msg.data.id, threadId:msg.data.threadId, snippet:msg.data.snippet, from:hdr(h,'From'), to:hdr(h,'To'), subject:hdr(h,'Subject')||'(no subject)', date:hdr(h,'Date'), labels:msg.data.labelIds||[], isUnread:(msg.data.labelIds||[]).includes('UNREAD'), hasAttachment:hasAtt });"
);

// Add attachments to personal message detail
gmail = gmail.replace(
  "res.json({ id:msg.data.id, threadId:msg.data.threadId, from:hdr(h,'From'), to:hdr(h,'To'), cc:hdr(h,'Cc'), subject:hdr(h,'Subject'), date:hdr(h,'Date'), body:body(msg.data.payload), labels:msg.data.labelIds||[] });",
  `// Extract attachment info
    const attachments = [];
    function findAtts(parts) {
      if (!parts) return;
      for (const p of parts) {
        if (p.filename && p.filename.length > 0 && p.body) {
          attachments.push({ filename: p.filename, mimeType: p.mimeType || 'application/octet-stream', size: p.body.size || 0, attachmentId: p.body.attachmentId });
        }
        if (p.parts) findAtts(p.parts);
      }
    }
    findAtts(msg.data.payload.parts);
    // Generate download URLs
    attachments.forEach(a => { a.url = '/api/gmail/attachment/' + req.params.id + '/' + encodeURIComponent(a.attachmentId); });
    res.json({ id:msg.data.id, threadId:msg.data.threadId, from:hdr(h,'From'), to:hdr(h,'To'), cc:hdr(h,'Cc'), subject:hdr(h,'Subject'), date:hdr(h,'Date'), body:body(msg.data.payload), labels:msg.data.labelIds||[], attachments });`
);

// Add attachment download endpoint
if (!gmail.includes("'/attachment/")) {
  gmail = gmail.replace(
    "// ── Filters ──",
    `// ── Attachment download ──
router.get('/attachment/:msgId/:attId', requireAuth, async (req, res) => {
  try {
    const t = getTokens(req.user.id); if (!t) return res.status(400).json({ error: 'Not connected' });
    const gm = google.gmail({version:'v1',auth:authClient(t)});
    const att = await gm.users.messages.attachments.get({ userId: 'me', messageId: req.params.msgId, id: decodeURIComponent(req.params.attId) });
    const buf = Buffer.from(att.data.data, 'base64');
    res.set('Content-Type', 'application/octet-stream');
    res.set('Content-Disposition', 'attachment');
    res.send(buf);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Filters ──`
  );
}

fs.writeFileSync('server/routes/gmail.js', gmail, 'utf8');
console.log('  ✓ gmail.js — attachment info in personal inbox + download endpoint');
console.log('\nRefresh browser. Emails with attachments show 📎 and download links.');
