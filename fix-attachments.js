// fix-attachments.js
// 1. Sync downloads attachments from Gmail and saves to attachments table
// 2. Tickets API returns attachments
// 3. TicketDetail displays them

const fs = require('fs');

// ─── 1. Fix gmail.js sync to download attachments ───

let gmail = fs.readFileSync('server/routes/gmail.js', 'utf8');

// Add attachment extraction after creating the message
// Find the line where we insert the message and add attachment handling after
gmail = gmail.replace(
  "db.prepare('INSERT INTO messages (id,ticket_id,direction,channel,from_address,to_addresses,sender,subject,body_text,sent_at,provider_message_id,in_reply_to,reference_ids,gmail_message_id,gmail_thread_id,gmail_user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('msg-'+Date.now()+'-'+Math.random().toString(36).slice(2,6),tid,'inbound','email',from,JSON.stringify([toStr(row.email)]),from,subj,bd||subj,ts,m.id,null,'[]',m.id,thId,uid,ts);",
  `const msgDbId = 'msg-'+Date.now()+'-'+Math.random().toString(36).slice(2,6);
    db.prepare('INSERT INTO messages (id,ticket_id,direction,channel,from_address,to_addresses,sender,subject,body_text,sent_at,provider_message_id,in_reply_to,reference_ids,gmail_message_id,gmail_thread_id,gmail_user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(msgDbId,tid,'inbound','email',from,JSON.stringify([toStr(row.email)]),from,subj,bd||subj,ts,m.id,null,'[]',m.id,thId,uid,ts);
    // Extract attachments
    try {
      const parts = msg.data.payload.parts || [];
      for (const part of parts) {
        if (part.filename && part.body && part.body.attachmentId) {
          const att = await gmail.users.messages.attachments.get({userId:'me', messageId:m.id, id:part.body.attachmentId});
          if (att.data && att.data.data) {
            const attId = 'att-'+Date.now()+'-'+Math.random().toString(36).slice(2,6);
            db.prepare('INSERT INTO attachments (id, ticket_id, filename, data, message_id, mime_type, size) VALUES (?,?,?,?,?,?,?)').run(attId, tid, part.filename, att.data.data, msgDbId, part.mimeType || 'application/octet-stream', att.data.size || 0);
            console.log('[Sync] Attachment saved:', part.filename);
          }
        }
      }
    } catch(attErr) { console.log('[Sync] Attachment error:', attErr.message); }`
);

fs.writeFileSync('server/routes/gmail.js', gmail, 'utf8');
console.log('  ✓ gmail.js — sync now downloads attachments');

// ─── 2. Update attachments table to have message_id, mime_type, size ───

let dbFile = fs.readFileSync('server/database.js', 'utf8');
dbFile = dbFile.replace(
  "r('CREATE TABLE IF NOT EXISTS attachments (id TEXT PRIMARY KEY, ticket_id TEXT, filename TEXT, data TEXT)');",
  "r('CREATE TABLE IF NOT EXISTS attachments (id TEXT PRIMARY KEY, ticket_id TEXT, filename TEXT, data TEXT, message_id TEXT, mime_type TEXT, size INTEGER)');"
);
fs.writeFileSync('server/database.js', dbFile, 'utf8');
console.log('  ✓ database.js — attachments table updated');

// ─── 3. Add attachment endpoints to tickets.js ───

let tickets = fs.readFileSync('server/routes/tickets.js', 'utf8');

// Add attachments to the messages endpoint
tickets = tickets.replace(
  "res.json({ messages });",
  `// Add attachments to each message
  messages.forEach(m => {
    m.attachments = db.prepare('SELECT id, filename, mime_type, size FROM attachments WHERE message_id = ?').all(m.id);
  });
  // Also get ticket-level attachments
  res.json({ messages });`
);

// Add download endpoint
if (!tickets.includes('/attachments/')) {
  tickets = tickets.replace(
    "module.exports = router;",
    `router.get('/:id/attachments', requireAuth, (req, res) => {
  const db = getDb();
  const atts = db.prepare('SELECT id, filename, mime_type, size FROM attachments WHERE ticket_id = ?').all(req.params.id);
  res.json({ attachments: atts });
});

router.get('/:ticketId/attachments/:attId/download', requireAuth, (req, res) => {
  const db = getDb();
  const att = db.prepare('SELECT * FROM attachments WHERE id = ? AND ticket_id = ?').get(req.params.attId, req.params.ticketId);
  if (!att) return res.status(404).json({ error: 'Not found' });
  const buf = Buffer.from(att.data, 'base64');
  res.set('Content-Type', att.mime_type || 'application/octet-stream');
  res.set('Content-Disposition', 'attachment; filename="' + att.filename + '"');
  res.send(buf);
});

module.exports = router;`
  );
}

fs.writeFileSync('server/routes/tickets.js', tickets, 'utf8');
console.log('  ✓ tickets.js — attachment endpoints added');

// ─── 4. Add api methods ───

let api = fs.readFileSync('client/src/api.js', 'utf8');
if (!api.includes('getAttachments')) {
  api = api.replace(
    "getMessages:",
    "getAttachments: (id) => request('/tickets/' + id + '/attachments'),\n  downloadAttachment: (ticketId, attId) => '/api/tickets/' + ticketId + '/attachments/' + attId + '/download',\n  getMessages:"
  );
  fs.writeFileSync('client/src/api.js', api, 'utf8');
  console.log('  ✓ api.js — attachment methods added');
}

// ─── 5. Add attachment display to TicketDetail ───

let td = fs.readFileSync('client/src/components/TicketDetail.jsx', 'utf8');

// Add attachment rendering in message bubbles
if (!td.includes('attachments')) {
  // After inbound MessageBody, add attachment list
  td = td.replace(
    `<MessageBody text={m.body_text} />
                  </div>
                </div>
              );
            }
            if (item.type === 'outbound') {`,
    `<MessageBody text={m.body_text} />
                    {m.attachments && m.attachments.length > 0 && (
                      <div style={{ marginTop: 8, borderTop: '1px solid #c0d0e4', paddingTop: 8 }}>
                        {m.attachments.map(att => (
                          <a key={att.id} href={'/api/tickets/' + ticket.id + '/attachments/' + att.id + '/download'} target="_blank" rel="noopener"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: '#c8d8ec', borderRadius: 6, color: '#1a5e9a', fontSize: 11, fontWeight: 600, textDecoration: 'none', marginRight: 6, marginBottom: 4 }}>
                            <Icon name="file" size={12} />
                            {att.filename}
                            {att.size ? ' (' + (att.size > 1024*1024 ? (att.size/1024/1024).toFixed(1)+'MB' : (att.size/1024).toFixed(0)+'KB') + ')' : ''}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            }
            if (item.type === 'outbound') {`
  );

  // Same for outbound
  td = td.replace(
    `<MessageBody text={m.body_text} />
                  </div>
                </div>
              );
            }
            if (item.type === 'note') {`,
    `<MessageBody text={m.body_text} />
                    {m.attachments && m.attachments.length > 0 && (
                      <div style={{ marginTop: 8, borderTop: '1px solid #a8c0dc', paddingTop: 8 }}>
                        {m.attachments.map(att => (
                          <a key={att.id} href={'/api/tickets/' + ticket.id + '/attachments/' + att.id + '/download'} target="_blank" rel="noopener"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: '#d0e0f0', borderRadius: 6, color: '#1a5e9a', fontSize: 11, fontWeight: 600, textDecoration: 'none', marginRight: 6, marginBottom: 4 }}>
                            <Icon name="file" size={12} />
                            {att.filename}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            }
            if (item.type === 'note') {`
  );
}

fs.writeFileSync('client/src/components/TicketDetail.jsx', td, 'utf8');
console.log('  ✓ TicketDetail.jsx — attachments displayed with download links');

console.log('\n✅ Attachment support added.');
console.log('You need to delete the DB and reseed to get the new attachments column:');
console.log('  del server\\carecoord.db');
console.log('  npm run seed');
console.log('  npm run dev');
console.log('Then reconnect Google Workspace and send a new test email with an attachment.');
