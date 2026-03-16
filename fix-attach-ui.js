const fs = require('fs');
let td = fs.readFileSync('client/src/components/TicketDetail.jsx', 'utf8');

// The current reply section is at lines 374-383
// Replace the exact HTML that's there now
td = td.replace(
  `) : activeTab === 'reply' ? (
              <div style={{ display: 'flex', gap: 10 }}>
                <textarea value={replyText} onChange={e => setReplyText(e.target.value)}
                  placeholder={\`Reply to \${(ticket.external_participants || [])[0]}...\`}
                  rows={3} style={{ flex: 1, padding: '10px 14px', background: '#dde8f2', border: '1px solid #c0d0e4', borderRadius: 10, color: '#1e3a4f', fontSize: 13, resize: 'vertical', outline: 'none', lineHeight: 1.5 }} />
                <button onClick={handleSendReply} disabled={!replyText.trim() || sending}
                  style={{ padding: '10px 20px', background: replyText.trim() && !sending ? '#1a5e9a' : '#dde8f2', color: replyText.trim() && !sending ? '#fff' : '#8a9fb0', border: 'none', borderRadius: 10, cursor: replyText.trim() && !sending ? 'pointer' : 'default', fontWeight: 600, fontSize: 13, alignSelf: 'flex-end' }}>
                  {sending ? '...' : 'Send'}
                </button>
              </div>`,
  `) : activeTab === 'reply' ? (
              <div>
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

// Remove the duplicate state declarations (from earlier failed fix)
// Count occurrences of replyAttachments useState
const count = (td.match(/const \[replyAttachments, setReplyAttachments\]/g) || []).length;
if (count > 1) {
  // Remove the second occurrence
  let found = 0;
  td = td.replace(/  const \[replyAttachments, setReplyAttachments\] = useState\(\[\]\);\n/g, (match) => {
    found++;
    return found > 1 ? '' : match;
  });
  console.log('  ✓ Removed duplicate replyAttachments state');
}

// Same for duplicate sendReply calls
const sendCount = (td.match(/await api\.sendReply\(ticketId, replyText, replyAttachments/g) || []).length;
if (sendCount > 1) {
  // The handleSendReply function is probably duplicated too - remove second block
  // Actually let's just check the file is valid
  console.log('  ⚠ Multiple sendReply calls found - check for duplicate handleSendReply');
}

fs.writeFileSync('client/src/components/TicketDetail.jsx', td, 'utf8');

const check = fs.readFileSync('client/src/components/TicketDetail.jsx', 'utf8');
console.log(check.includes('Attach File') ? '✓ Attach File button added to reply area' : '✗ Attach File button NOT found');
console.log(check.includes('handleAttachFile') ? '✓ File handler present' : '✗ File handler missing');
console.log(check.includes('fileInputRef') ? '✓ File input ref present' : '✗ File input ref missing');
