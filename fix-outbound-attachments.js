const fs = require('fs');

// ═══════════════════════════════════════════════
// 1. SERVER: Update reply endpoint to handle attachments
// ═══════════════════════════════════════════════
let tickets = fs.readFileSync('server/routes/tickets.js', 'utf8');

// Replace the reply endpoint body extraction to also accept attachments
tickets = tickets.replace(
  "router.post('/:id/reply', requireAuth, async (req, res) => {\n  const db = getDb();\n  const { body } = req.body;\n  if (!body?.trim()) return res.status(400).json({ error: 'Body required' });",
  "router.post('/:id/reply', requireAuth, async (req, res) => {\n  const db = getDb();\n  const { body, attachments: replyAttachments } = req.body;\n  if (!body?.trim()) return res.status(400).json({ error: 'Body required' });"
);

// Replace the email building section to support MIME multipart with attachments
tickets = tickets.replace(
  `      // Build RFC 2822 email
      const senderEmail = tokenRow.email || fromAddr;
      const emailLines = [
        'From: ' + senderEmail,
        'To: ' + toAddr,
        'Subject: ' + subject,
        'Content-Type: text/plain; charset=utf-8',
        'MIME-Version: 1.0',
      ];
      if (replyTo) {
        emailLines.push('In-Reply-To: <' + replyTo + '>');
        emailLines.push('References: <' + replyTo + '>');
      }
      emailLines.push('');
      emailLines.push(fullBody);

      const raw = Buffer.from(emailLines.join(String.fromCharCode(13,10))).toString('base64url');`,
  `      // Build RFC 2822 email (with optional attachments)
      const senderEmail = tokenRow.email || fromAddr;
      const CRLF = String.fromCharCode(13, 10);
      let raw;

      if (replyAttachments && replyAttachments.length > 0) {
        const boundary = 'boundary_' + Date.now() + '_' + Math.random().toString(36).slice(2);
        const headers = [
          'From: ' + senderEmail, 'To: ' + toAddr, 'Subject: ' + subject,
          'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="' + boundary + '"',
        ];
        if (replyTo) { headers.push('In-Reply-To: <' + replyTo + '>'); headers.push('References: <' + replyTo + '>'); }
        let mimeBody = headers.join(CRLF) + CRLF + CRLF;
        mimeBody += '--' + boundary + CRLF + 'Content-Type: text/plain; charset=utf-8' + CRLF + 'Content-Transfer-Encoding: 7bit' + CRLF + CRLF + fullBody + CRLF + CRLF;
        for (const att of replyAttachments) {
          mimeBody += '--' + boundary + CRLF;
          mimeBody += 'Content-Type: ' + (att.mimeType || 'application/octet-stream') + '; name="' + att.name + '"' + CRLF;
          mimeBody += 'Content-Disposition: attachment; filename="' + att.name + '"' + CRLF;
          mimeBody += 'Content-Transfer-Encoding: base64' + CRLF + CRLF;
          mimeBody += att.data + CRLF + CRLF;
        }
        mimeBody += '--' + boundary + '--' + CRLF;
        raw = Buffer.from(mimeBody).toString('base64url');
      } else {
        const emailLines = [
          'From: ' + senderEmail, 'To: ' + toAddr, 'Subject: ' + subject,
          'Content-Type: text/plain; charset=utf-8', 'MIME-Version: 1.0',
        ];
        if (replyTo) { emailLines.push('In-Reply-To: <' + replyTo + '>'); emailLines.push('References: <' + replyTo + '>'); }
        emailLines.push(''); emailLines.push(fullBody);
        raw = Buffer.from(emailLines.join(CRLF)).toString('base64url');
      }`
);

fs.writeFileSync('server/routes/tickets.js', tickets, 'utf8');
console.log('✓ Server: Reply supports MIME multipart attachments');

// ═══════════════════════════════════════════════
// 2. CLIENT: Add file upload to reply area
// ═══════════════════════════════════════════════
let td = fs.readFileSync('client/src/components/TicketDetail.jsx', 'utf8');

// Add attachment state
td = td.replace(
  "const [sending, setSending] = useState(false);",
  "const [sending, setSending] = useState(false);\n  const [replyAttachments, setReplyAttachments] = useState([]);\n  const fileInputRef = useRef(null);"
);

// Update handleSendReply to include attachments
td = td.replace(
  `const handleSendReply = async () => {
    if (!replyText.trim() || sending) return;
    setSending(true);
    try {
      await api.sendReply(ticketId, replyText);
      setReplyText('');
      await fetchData();
      showToast('Reply sent');
    } catch (e) {
      showToast(e.message);
    } finally {
      setSending(false);
    }
  };`,
  `const handleSendReply = async () => {
    if (!replyText.trim() || sending) return;
    setSending(true);
    try {
      await api.sendReply(ticketId, replyText, replyAttachments.length > 0 ? replyAttachments : undefined);
      setReplyText('');
      setReplyAttachments([]);
      await fetchData();
      showToast('Reply sent');
    } catch (e) {
      showToast(e.message);
    } finally {
      setSending(false);
    }
  };

  const handleAttachFile = (e) => {
    const files = Array.from(e.target.files || []);
    for (const file of files) {
      if (file.size > 10 * 1024 * 1024) { showToast('File too large (max 10MB)'); continue; }
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result.split(',')[1];
        setReplyAttachments(prev => [...prev, { name: file.name, data: base64, mimeType: file.type || 'application/octet-stream', size: file.size }]);
      };
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  };`
);

// Replace the reply textarea area to include attach button and file previews
td = td.replace(
  `              <div style={{ display: 'flex', gap: 10 }}>
                <textarea value={replyText} onChange={e => setReplyText(e.target.value)}
                  placeholder={\`Reply to \${(ticket.external_participants || [])[0]}...\`}
                  rows={3} style={{ flex: 1, padding: '10px 14px', background: '#dde8f2', border: '1px solid #c0d0e4', borderRadius: 10, color: '#1e3a4f', fontSize: 13, resize: 'vertical', outline: 'none', lineHeight: 1.5 }} />       
                <button onClick={handleSendReply} disabled={!replyText.trim() || sending}
                  style={{ padding: '10px 20px', background: replyText.trim() && !sending ? '#1a5e9a' : '#dde8f2', color: replyText.trim() && !sending ? '#fff' : '#8a9fb0', border: 'none', borderRadius: 10, cursor: replyText.trim() && !sending ? 'pointer' : 'default', fontWeight: 600, fontSize: 13, alignSelf: 'flex-end' }}>
                  {sending ? '...' : 'Send'}
                </button>
              </div>`,
  `              <div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <textarea value={replyText} onChange={e => setReplyText(e.target.value)}
                      placeholder={\`Reply to \${(ticket.external_participants || [])[0]}...\`}
                      rows={3} style={{ width: '100%', padding: '10px 14px', background: '#dde8f2', border: '1px solid #c0d0e4', borderRadius: 10, color: '#1e3a4f', fontSize: 13, resize: 'vertical', outline: 'none', lineHeight: 1.5, boxSizing: 'border-box' }} />
                    {replyAttachments.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                        {replyAttachments.map((a, i) => (
                          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', background: '#c8d8ec', borderRadius: 6, fontSize: 11, color: '#1a5e9a' }}>
                            <Icon name="file" size={10} />
                            {a.name} ({a.size > 1048576 ? (a.size/1048576).toFixed(1)+'MB' : Math.round(a.size/1024)+'KB'})
                            <button onClick={() => setReplyAttachments(prev => prev.filter((_, j) => j !== i))}
                              style={{ background: 'none', border: 'none', color: '#d94040', cursor: 'pointer', padding: 0, fontSize: 14, lineHeight: 1, marginLeft: 2 }}>×</button>
                          </span>
                        ))}
                      </div>
                    )}
                    <div style={{ marginTop: 6 }}>
                      <input type="file" ref={fileInputRef} onChange={handleAttachFile} multiple style={{ display: 'none' }} />
                      <button onClick={() => fileInputRef.current?.click()}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', background: '#f0f4f9', border: '1px solid #c0d0e4', borderRadius: 6, cursor: 'pointer', fontSize: 11, color: '#6b8299' }}>
                        <Icon name="file" size={12} /> Attach File
                      </button>
                    </div>
                  </div>
                  <button onClick={handleSendReply} disabled={!replyText.trim() || sending}
                    style={{ padding: '10px 20px', background: replyText.trim() && !sending ? '#1a5e9a' : '#dde8f2', color: replyText.trim() && !sending ? '#fff' : '#8a9fb0', border: 'none', borderRadius: 10, cursor: replyText.trim() && !sending ? 'pointer' : 'default', fontWeight: 600, fontSize: 13, alignSelf: 'flex-end' }}>
                    {sending ? '...' : 'Send'}
                  </button>
                </div>
              </div>`
);

fs.writeFileSync('client/src/components/TicketDetail.jsx', td, 'utf8');
console.log('✓ Client: Attach File button with preview and remove');

// ═══════════════════════════════════════════════
// 3. API: Update sendReply to accept attachments
// ═══════════════════════════════════════════════
let apiFile = fs.readFileSync('client/src/api.js', 'utf8');

apiFile = apiFile.replace(
  "sendReply: (id, body) => request('/tickets/' + id + '/reply', { method: 'POST', body: { body } }),",
  "sendReply: (id, body, attachments) => request('/tickets/' + id + '/reply', { method: 'POST', body: { body, attachments } }),"
);

fs.writeFileSync('client/src/api.js', apiFile, 'utf8');
console.log('✓ API: sendReply accepts attachments');

console.log('\n✅ Outbound attachment support complete!');
console.log('  • "Attach File" button below reply textarea');
console.log('  • Multiple files, max 10MB each');
console.log('  • Preview with file name, size, and remove button');
console.log('  • Sent as MIME multipart email via Gmail');
