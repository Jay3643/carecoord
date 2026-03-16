const { initDb, getDb, saveDb } = require('./server/database');
const bcrypt = require('bcryptjs');

initDb().then(async () => {
  const db = getDb();
  const tables = ['messages','tickets','ticket_tags','audit_log','attachments','gmail_tokens','email_filters','email_sync_state','sessions','user_regions','users','tags','close_reasons','regions'];
  tables.forEach(t => { try { db.prepare('DELETE FROM ' + t).run(); } catch(e) {} });

  const hash = await bcrypt.hash('Seniority2024!', 12);
  db.prepare('INSERT INTO users (id,name,email,role,avatar,is_active,password_hash,totp_secret,totp_enabled) VALUES (?,?,?,?,?,1,?,NULL,0)')
    .run('u1','John Hopkins','drhopkins@seniorityhealthcare.com','admin','JH',hash);

  db.prepare("INSERT INTO regions (id,name,routing_aliases,is_active) VALUES (?,?,?,1)").run('r1','Central PA','["centralpa@carecoord.org"]');
  db.prepare("INSERT INTO regions (id,name,routing_aliases,is_active) VALUES (?,?,?,1)").run('r2','South NJ','["southnj@carecoord.org"]');
  db.prepare("INSERT INTO regions (id,name,routing_aliases,is_active) VALUES (?,?,?,1)").run('r3','Delaware Valley','["delval@carecoord.org"]');

  db.prepare('INSERT INTO user_regions (user_id,region_id) VALUES (?,?)').run('u1','r1');
  db.prepare('INSERT INTO user_regions (user_id,region_id) VALUES (?,?)').run('u1','r2');
  db.prepare('INSERT INTO user_regions (user_id,region_id) VALUES (?,?)').run('u1','r3');

  db.prepare("INSERT INTO tags (id,name,color) VALUES (?,?,?)").run('t1','Urgent','#dc2626');
  db.prepare("INSERT INTO tags (id,name,color) VALUES (?,?,?)").run('t2','Prior Auth','#2563eb');
  db.prepare("INSERT INTO tags (id,name,color) VALUES (?,?,?)").run('t3','DME','#7c3aed');
  db.prepare("INSERT INTO tags (id,name,color) VALUES (?,?,?)").run('t4','Follow-up','#d97706');
  db.prepare("INSERT INTO tags (id,name,color) VALUES (?,?,?)").run('t5','Insurance','#059669');

  db.prepare("INSERT INTO close_reasons (id,label,requires_comment) VALUES (?,?,?)").run('cr1','Resolved',0);
  db.prepare("INSERT INTO close_reasons (id,label,requires_comment) VALUES (?,?,?)").run('cr2','Duplicate',0);
  db.prepare("INSERT INTO close_reasons (id,label,requires_comment) VALUES (?,?,?)").run('cr3','No Response',0);
  db.prepare("INSERT INTO close_reasons (id,label,requires_comment) VALUES (?,?,?)").run('cr4','Other',1);

  saveDb();
  console.log('Fresh DB: drhopkins@seniorityhealthcare.com / Seniority2024! (admin)');
});
