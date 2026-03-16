const fs = require('fs');
let gmail = fs.readFileSync('server/routes/gmail.js', 'utf8');

// Fix: synced tickets need external_participants set, and messages need from_address, to_addresses, subject
gmail = gmail.replace(
  "db.prepare('INSERT INTO tickets (id,subject,from_email,region_id,status,created_at,last_activity_at) VALUES (?,?,?,?,?,?,?)').run(tid,subj,from,rid,'OPEN',ts,ts);",
  "db.prepare('INSERT INTO tickets (id,subject,from_email,region_id,status,created_at,last_activity_at,external_participants) VALUES (?,?,?,?,?,?,?,?)').run(tid,subj,from,rid,'OPEN',ts,ts,JSON.stringify([from]));"
);

gmail = gmail.replace(
  "db.prepare('INSERT INTO messages (id,ticket_id,direction,sender,body_text,sent_at,gmail_message_id,gmail_thread_id,gmail_user_id) VALUES (?,?,?,?,?,?,?,?,?)').run('msg-'+Date.now()+'-'+Math.random().toString(36).slice(2,6),tid,'inbound',from,bd||subj,ts,m.id,thId,uid);",
  "db.prepare('INSERT INTO messages (id,ticket_id,direction,channel,from_address,to_addresses,sender,subject,body_text,sent_at,provider_message_id,in_reply_to,reference_ids,gmail_message_id,gmail_thread_id,gmail_user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('msg-'+Date.now()+'-'+Math.random().toString(36).slice(2,6),tid,'inbound','email',from,JSON.stringify([toStr(row.email)]),from,subj,bd||subj,ts,m.id,null,'[]',m.id,thId,uid,ts);"
);

fs.writeFileSync('server/routes/gmail.js', gmail, 'utf8');
console.log('✓ Synced tickets now have all required fields');

// Also fix the existing broken ticket
const { initDb, getDb, saveDb } = require('./server/database');
initDb().then(() => {
  const db = getDb();
  // Fix any tickets with null external_participants
  const broken = db.prepare("SELECT id, from_email FROM tickets WHERE external_participants IS NULL AND from_email IS NOT NULL").all();
  broken.forEach(t => {
    db.prepare('UPDATE tickets SET external_participants = ? WHERE id = ?').run(JSON.stringify([t.from_email]), t.id);
    console.log('  Fixed ticket:', t.id);
  });
  // Fix any messages missing from_address
  const msgs = db.prepare("SELECT id, sender FROM messages WHERE from_address IS NULL AND sender IS NOT NULL").all();
  msgs.forEach(m => {
    db.prepare('UPDATE messages SET from_address = ?, channel = ?, to_addresses = ?, reference_ids = ? WHERE id = ?').run(m.sender, 'email', '[]', '[]', m.id);
    console.log('  Fixed message:', m.id);
  });
  saveDb();
  console.log('Done. Refresh browser and click the ticket again.');
});
