const bcrypt = require('bcryptjs');
const { initDb, closeDb, saveDb } = require('./database');

const now = Date.now();
const h = (hrs) => now - hrs * 3600000;
const d = (days) => now - days * 86400000;

async function seed() {
  const db = await initDb();

  db.exec('DELETE FROM audit_log; DELETE FROM ticket_tags; DELETE FROM attachments; DELETE FROM notes; DELETE FROM messages; DELETE FROM tickets; DELETE FROM user_regions; DELETE FROM users; DELETE FROM tags; DELETE FROM close_reasons; DELETE FROM regions;');

  const ins = (sql) => db.prepare(sql);

  // Regions
  const iR = ins('INSERT INTO regions (id, name, routing_aliases, is_active) VALUES (?, ?, ?, ?)');
  [['r1','Central PA','["centralpa@carecoord.org"]',1],['r2','Western PA','["westernpa@carecoord.org"]',1],['r3','Eastern PA','["easternpa@carecoord.org"]',1],['r4','Triage / Unrouted','[]',1]]
    .forEach(r => iR.run(...r));

  // Users
  const iU = ins('INSERT INTO users (id, name, email, role, avatar, is_active) VALUES (?, ?, ?, ?, ?, 1)');
  const iUR = ins('INSERT INTO user_regions (user_id, region_id) VALUES (?, ?)');
  [
    {id:'u1',name:'Sarah Mitchell',email:'smitchell@carecoord.org',role:'coordinator',avatar:'SM',rg:['r1','r4']},
    {id:'u2',name:'James Rivera',email:'jrivera@carecoord.org',role:'coordinator',avatar:'JR',rg:['r1']},
    {id:'u3',name:'Angela Chen',email:'achen@carecoord.org',role:'coordinator',avatar:'AC',rg:['r2']},
    {id:'u4',name:'Marcus Brown',email:'mbrown@carecoord.org',role:'coordinator',avatar:'MB',rg:['r2','r4']},
    {id:'u5',name:'Lisa Nowak',email:'lnowak@carecoord.org',role:'coordinator',avatar:'LN',rg:['r3']},
    {id:'u6',name:'Dr. Patricia Hayes',email:'phayes@carecoord.org',role:'supervisor',avatar:'PH',rg:['r1','r2','r3','r4']},
    {id:'u7',name:'Tom Adkins',email:'tadkins@carecoord.org',role:'admin',avatar:'TA',rg:['r1','r2','r3','r4']},
  ].forEach(u => { iU.run(u.id,u.name,u.email,u.role,u.avatar); u.rg.forEach(r => iUR.run(u.id,r)); });

  // Close Reasons
  const iCR = ins('INSERT INTO close_reasons (id, label, requires_comment) VALUES (?, ?, ?)');
  [['cr1','Resolved — information provided',0],['cr2','Resolved — referral completed',0],['cr3','Resolved — appointment scheduled',0],['cr4','No response after follow-up',1],['cr5','Duplicate / merged',1],['cr6','Out of scope — redirected',1]]
    .forEach(r => iCR.run(...r));

  // Tags
  const iT = ins('INSERT INTO tags (id, name, color) VALUES (?, ?, ?)');
  [['t1','Urgent','#ef4444'],['t2','Prior Auth','#f59e0b'],['t3','Referral','#3b82f6'],['t4','Benefits','#8b5cf6'],['t5','DME','#e87e22'],['t6','Follow-Up','#ec4899']]
    .forEach(t => iT.run(...t));

  // Tickets
  const iTk = ins('INSERT INTO tickets (id, region_id, status, assignee_user_id, subject, external_participants, last_activity_at, created_at, closed_at, close_reason_id, locked_closed, has_unread) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const iTT = ins('INSERT INTO ticket_tags (ticket_id, tag_id) VALUES (?, ?)');
  [
    {id:'tk1',r:'r1',s:'OPEN',a:'u1',subj:'Patient John Smith — Prior Auth for MRI',ep:['jdoe@mercyhealth.org'],la:h(18),ca:d(2),tags:['t2']},
    {id:'tk2',r:'r1',s:'OPEN',a:null,subj:'DME Request — Wheelchair for Maria Garcia',ep:['kpatel@geisinger.edu'],la:d(1),ca:d(1),tags:['t5']},
    {id:'tk3',r:'r2',s:'OPEN',a:null,subj:'Coordination Needed — Benefits Verification for R. Thompson',ep:['billing@upmc.edu'],la:h(6),ca:h(6),tags:['t1','t4']},
    {id:'tk4',r:'r3',s:'WAITING_ON_EXTERNAL',a:'u5',subj:'Urgent: Discharge Planning — Patient Davis',ep:['nurse.kelly@lvhn.org'],la:h(2),ca:h(3),tags:['t1','t3']},
    {id:'tk5',r:'r4',s:'OPEN',a:null,subj:"Need help with my mom's care",ep:['unknown.sender@gmail.com'],la:h(1),ca:h(1),tags:[]},
    {id:'tk6',r:'r2',s:'CLOSED',a:'u3',subj:'Referral — Cardiology Consult for Patient Williams',ep:['referrals@wpahs.org'],la:d(2),ca:d(3),clAt:d(1.5),crId:'cr3',lc:1,tags:['t3']},
    {id:'tk7',r:'r1',s:'OPEN',a:'u2',subj:'Auth Extension Request — PT for Patient Lee',ep:['admin@pinnaclerehab.com'],la:h(8),ca:h(8),tags:['t2','t6']},
    {id:'tk8',r:'r3',s:'WAITING_ON_EXTERNAL',a:'u5',subj:'Complex Case — Behavioral Health + Housing',ep:['social.work@reading-hospital.org'],la:d(3.5),ca:d(4),tags:['t1']},
    {id:'tk9',r:'r1',s:'OPEN',a:'u1',subj:'Follow-up: Auth for Patient Adams',ep:['jdoe@mercyhealth.org'],la:h(30),ca:h(30),tags:['t2','t6']},
    {id:'tk10',r:'r4',s:'OPEN',a:null,subj:'New Provider Registration Inquiry',ep:['newprovider@healthfirst.net'],la:h(4),ca:h(4),tags:[]},
  ].forEach(t => {
    iTk.run(t.id,t.r,t.s,t.a,t.subj,JSON.stringify(t.ep),t.la,t.ca,t.clAt||null,t.crId||null,t.lc||0,t.s!=='CLOSED'&&!t.a?1:0);
    t.tags.forEach(tag => iTT.run(t.id, tag));
  });

  // Messages
  const iM = ins('INSERT INTO messages (id, ticket_id, direction, channel, from_address, to_addresses, subject, body_text, sent_at, provider_message_id, in_reply_to, reference_ids, created_by_user_id, created_at) VALUES (?, ?, ?, \'email\', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  [
    {id:'m1',tk:'tk1',dir:'inbound',from:'jdoe@mercyhealth.org',to:['intake@carecoord.org'],subj:'Patient John Smith — Prior Auth for MRI',body:"Hello,\n\nI'm writing regarding patient John Smith (DOB 03/15/1962). We need a prior authorization for an MRI of the lumbar spine ordered by Dr. Williams at Mercy Health.\n\nPlease let us know what documentation is needed to proceed.\n\nThank you,\nJane Doe\nMercy Health Referral Coordinator\n(717) 555-0142",at:d(2),pid:'msg-ext-001',irt:null,refs:[],uid:null},
    {id:'m2',tk:'tk1',dir:'outbound',from:'centralpa@carecoord.org',to:['jdoe@mercyhealth.org'],subj:'Re: Patient John Smith — Prior Auth for MRI',body:"Hi Jane,\n\nThank you for reaching out. I've started the prior authorization process for the lumbar MRI for Mr. Smith.\n\nCould you please send over the following:\n1. Recent clinical notes from Dr. Williams\n2. Any relevant imaging history\n3. The CPT code for the ordered procedure\n\nBest regards,\nSarah Mitchell\nCare Coordinator — Central PA Region",at:d(1.5),pid:'msg-int-001',irt:'msg-ext-001',refs:['msg-ext-001'],uid:'u1'},
    {id:'m3',tk:'tk1',dir:'inbound',from:'jdoe@mercyhealth.org',to:['centralpa@carecoord.org'],subj:'Re: Patient John Smith — Prior Auth for MRI',body:"Sarah,\n\nAttached are the clinical notes and imaging history. The CPT code is 72148.\n\nThanks,\nJane",at:h(18),pid:'msg-ext-002',irt:'msg-int-001',refs:['msg-ext-001','msg-int-001'],uid:null},
    {id:'m4',tk:'tk2',dir:'inbound',from:'kpatel@geisinger.edu',to:['intake@carecoord.org'],subj:'DME Request — Wheelchair for Maria Garcia',body:"Good morning,\n\nWe have a patient, Maria Garcia, who requires a power wheelchair following her recent stroke.\n\nRegards,\nDr. K. Patel\nGeisinger Rehabilitation",at:d(1),pid:'msg-ext-003',irt:null,refs:[],uid:null},
    {id:'m5',tk:'tk3',dir:'inbound',from:'billing@upmc.edu',to:['westernpa@carecoord.org'],subj:'Coordination Needed — Benefits Verification for R. Thompson',body:"Hi team,\n\nWe need assistance verifying benefits for patient Robert Thompson (Member ID: XK-4829173).\n\nThank you,\nUPMC Billing Department",at:h(6),pid:'msg-ext-004',irt:null,refs:[],uid:null},
    {id:'m6',tk:'tk4',dir:'inbound',from:'nurse.kelly@lvhn.org',to:['easternpa@carecoord.org'],subj:'Urgent: Discharge Planning — Patient Davis',body:"URGENT\n\nPatient Emily Davis is being discharged tomorrow and needs home health services arranged.\n\nNurse Kelly Raymond\nLVHN Discharge Planning",at:h(3),pid:'msg-ext-005',irt:null,refs:[],uid:null},
    {id:'m7',tk:'tk4',dir:'outbound',from:'easternpa@carecoord.org',to:['nurse.kelly@lvhn.org'],subj:'Re: Urgent: Discharge Planning — Patient Davis',body:"Nurse Raymond,\n\nI'm on it. I've contacted Aetna and initiated the authorization for home health services.\n\nLisa Nowak\nCare Coordinator — Eastern PA Region",at:h(2),pid:'msg-int-002',irt:'msg-ext-005',refs:['msg-ext-005'],uid:'u5'},
    {id:'m8',tk:'tk5',dir:'inbound',from:'unknown.sender@gmail.com',to:['intake@carecoord.org'],subj:"Need help with my mom's care",body:"Hi, my mother recently moved to Pennsylvania and needs to find new doctors. She's in the Scranton area.\n\nThank you,\nMichael Torres",at:h(1),pid:'msg-ext-006',irt:null,refs:[],uid:null},
    {id:'m9',tk:'tk6',dir:'inbound',from:'referrals@wpahs.org',to:['westernpa@carecoord.org'],subj:'Referral — Cardiology Consult for Patient Williams',body:"Please coordinate a cardiology consultation for patient David Williams.\n\nWPAHS Referral Desk",at:d(3),pid:'msg-ext-007',irt:null,refs:[],uid:null},
    {id:'m10',tk:'tk6',dir:'outbound',from:'westernpa@carecoord.org',to:['referrals@wpahs.org'],subj:'Re: Referral — Cardiology Consult for Patient Williams',body:"I've contacted three in-network cardiologists. Dr. Mehta has availability this Thursday at 2pm.\n\nAngela Chen\nCare Coordinator — Western PA Region",at:d(2.5),pid:'msg-int-003',irt:'msg-ext-007',refs:['msg-ext-007'],uid:'u3'},
    {id:'m11',tk:'tk6',dir:'inbound',from:'referrals@wpahs.org',to:['westernpa@carecoord.org'],subj:'Re: Referral — Cardiology Consult for Patient Williams',body:"That works. Patient has been notified. Thank you for the quick turnaround.",at:d(2),pid:'msg-ext-008',irt:'msg-int-003',refs:['msg-ext-007','msg-int-003'],uid:null},
    {id:'m12',tk:'tk7',dir:'inbound',from:'admin@pinnaclerehab.com',to:['centralpa@carecoord.org'],subj:'Auth Extension Request — PT for Patient Lee',body:"We need an extension on the PT authorization for patient Susan Lee. Current auth expires in 3 days.\n\nPinnacle Rehab Admin",at:h(8),pid:'msg-ext-009',irt:null,refs:[],uid:null},
    {id:'m13',tk:'tk8',dir:'inbound',from:'social.work@reading-hospital.org',to:['easternpa@carecoord.org'],subj:'Complex Case — Behavioral Health + Housing',body:"We have a patient with significant behavioral health needs who is also facing housing instability.\n\nReading Hospital Social Work Dept",at:d(4),pid:'msg-ext-010',irt:null,refs:[],uid:null},
    {id:'m14',tk:'tk8',dir:'outbound',from:'easternpa@carecoord.org',to:['social.work@reading-hospital.org'],subj:'Re: Complex Case — Behavioral Health + Housing',body:"I called and left a voicemail at ext 4421. I have some resources that may help.\n\nLisa Nowak\nCare Coordinator — Eastern PA",at:d(3.5),pid:'msg-int-004',irt:'msg-ext-010',refs:['msg-ext-010'],uid:'u5'},
    {id:'m15',tk:'tk9',dir:'inbound',from:'jdoe@mercyhealth.org',to:['centralpa@carecoord.org'],subj:'Follow-up: Auth for Patient Adams',body:"Hi, just checking in on the prior auth for patient Robert Adams. Any update?\n\nJane Doe\nMercy Health",at:h(30),pid:'msg-ext-011',irt:null,refs:[],uid:null},
    {id:'m16',tk:'tk10',dir:'inbound',from:'newprovider@healthfirst.net',to:['intake@carecoord.org'],subj:'New Provider Registration Inquiry',body:"Hello, we are a new home health agency looking to partner with your coordination services.\n\nHealthFirst Home Health",at:h(4),pid:'msg-ext-012',irt:null,refs:[],uid:null},
  ].forEach(m => iM.run(m.id,m.tk,m.dir,m.from,JSON.stringify(m.to),m.subj,m.body,m.at,m.pid,m.irt,JSON.stringify(m.refs),m.uid,m.at));

  // Notes
  const iN = ins('INSERT INTO notes (id, ticket_id, author_user_id, body, created_at) VALUES (?, ?, ?, ?, ?)');
  [
    ['n1','tk1','u1','Called Aetna UM dept — confirmed CPT 72148 requires clinical notes + 6 months imaging history.',d(1.8)],
    ['n2','tk4','u5','Aetna rep (ref #A-29401) confirmed home health auth is in process. Expected 4-6 hours.',h(2.5)],
    ['n3','tk6','u3',"Dr. Mehta's office confirmed appt. Sent confirmation to patient's personal email.",d(1.8)],
    ['n4','tk8','u5','Spoke with social worker — dual diagnosis. Referred to PA 211 for housing resources.',d(3)],
  ].forEach(n => iN.run(...n));

  // Audit
  const iA = ins('INSERT INTO audit_log (id, actor_user_id, action_type, entity_type, entity_id, ts, detail) VALUES (?, ?, ?, ?, ?, ?, ?)');
  [
    ['a1',null,'ticket_created','ticket','tk1',d(2),'Inbound email ingested'],
    ['a2','u1','assignee_changed','ticket','tk1',d(1.9),'Assigned to Sarah Mitchell'],
    ['a3','u1','outbound_sent','message','m2',d(1.5),'Reply sent to jdoe@mercyhealth.org'],
    ['a4',null,'inbound_received','message','m3',h(18),'Reply from jdoe@mercyhealth.org'],
    ['a5','u3','status_changed','ticket','tk6',d(1.5),'Status -> CLOSED'],
  ].forEach(a => iA.run(...a));

  saveDb();
  console.log('\n✅ Database seeded successfully');
  console.log('   4 regions, 7 users, 10 tickets, 16 messages, 4 notes, 5 audit entries\n');
  closeDb();
}

seed().catch(err => { console.error('Seed failed:', err); process.exit(1); });


// ── Fix passwords after seed ──
const bcryptFix = require('bcryptjs');
const dbFix = require('./database');
setTimeout(async () => {
  try {
    const db = dbFix.getDb();
    if (!db) { console.log('DB not ready, skipping password fix'); return; }
    
    // Check if password_hash column exists
    const cols = db.prepare('PRAGMA table_info(users)').all();
    const hasCol = cols.some(c => c.name === 'password_hash');
    if (!hasCol) {
      db.prepare('ALTER TABLE users ADD COLUMN password_hash TEXT').run();
      db.prepare('ALTER TABLE users ADD COLUMN totp_secret TEXT').run();
      db.prepare('ALTER TABLE users ADD COLUMN totp_enabled INTEGER DEFAULT 0').run();
    }
    
    console.log('  SETTING PASSWORDS...');
    const hash = await bcryptFix.hash('Seniority2024!', 12);
    db.prepare('UPDATE users SET password_hash = ?, totp_enabled = 0, totp_secret = NULL WHERE password_hash IS NULL OR password_hash = ?').run(hash, '');
    const updated = db.prepare('UPDATE users SET password_hash = ? WHERE 1=1').run(hash);
    dbFix.saveDb();
    
    const check = db.prepare('SELECT email, password_hash FROM users').all();
    check.forEach(u => console.log('  ✓ ' + u.email + ' hash: ' + (u.password_hash ? u.password_hash.substring(0,10) + '...' : 'NULL')));
    console.log('  ✅ All passwords set to: Seniority2024!');
  } catch(e) {
    console.log('  Password fix error:', e.message);
  }
}, 2000);
