const bcrypt = require('bcryptjs');
const { initDb, closeDb, saveDb } = require('./database');

async function seed() {
  const db = await initDb();

  // Create tables if they don't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS regions (id TEXT PRIMARY KEY, name TEXT, routing_aliases TEXT DEFAULT '[]', is_active INTEGER DEFAULT 1);
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT, email TEXT UNIQUE, role TEXT, avatar TEXT, password_hash TEXT, totp_enabled INTEGER DEFAULT 0, totp_secret TEXT, is_active INTEGER DEFAULT 1, created_at INTEGER);
    CREATE TABLE IF NOT EXISTS user_regions (user_id TEXT, region_id TEXT, PRIMARY KEY(user_id, region_id));
    CREATE TABLE IF NOT EXISTS tickets (id TEXT PRIMARY KEY, region_id TEXT, status TEXT, assignee_user_id TEXT, subject TEXT, from_email TEXT, external_participants TEXT DEFAULT '[]', last_activity_at INTEGER, created_at INTEGER, closed_at INTEGER, close_reason_id TEXT, locked_closed INTEGER DEFAULT 0, has_unread INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, ticket_id TEXT, direction TEXT, channel TEXT, from_address TEXT, to_addresses TEXT DEFAULT '[]', cc_addresses TEXT DEFAULT '[]', sender TEXT, subject TEXT, body_text TEXT, sent_at INTEGER, provider_message_id TEXT, in_reply_to TEXT, reference_ids TEXT DEFAULT '[]', gmail_message_id TEXT, gmail_thread_id TEXT, gmail_user_id TEXT, created_by_user_id TEXT, created_at INTEGER);
    CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, ticket_id TEXT, author_user_id TEXT, body TEXT, created_at INTEGER);
    CREATE TABLE IF NOT EXISTS tags (id TEXT PRIMARY KEY, name TEXT, color TEXT);
    CREATE TABLE IF NOT EXISTS ticket_tags (ticket_id TEXT, tag_id TEXT, PRIMARY KEY(ticket_id, tag_id));
    CREATE TABLE IF NOT EXISTS close_reasons (id TEXT PRIMARY KEY, label TEXT, requires_comment INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS attachments (id TEXT PRIMARY KEY, ticket_id TEXT, message_id TEXT, filename TEXT, mime_type TEXT, size INTEGER, data TEXT);
    CREATE TABLE IF NOT EXISTS audit_log (id TEXT PRIMARY KEY, actor_user_id TEXT, action_type TEXT, entity_type TEXT, entity_id TEXT, ts INTEGER, detail TEXT);
    CREATE TABLE IF NOT EXISTS gmail_tokens (id TEXT PRIMARY KEY, user_id TEXT, access_token TEXT, refresh_token TEXT, expiry_date INTEGER, email TEXT);
    CREATE TABLE IF NOT EXISTS email_sync_state (user_id TEXT PRIMARY KEY, last_sync_at INTEGER DEFAULT 0, sync_start_date TEXT);
    CREATE TABLE IF NOT EXISTS email_filters (id TEXT PRIMARY KEY, domain TEXT, sender TEXT, subject_contains TEXT, action TEXT, created_by TEXT, created_at INTEGER);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT, token TEXT, expires INTEGER, created_at INTEGER);
    CREATE TABLE IF NOT EXISTS invitations (id TEXT PRIMARY KEY, email TEXT, name TEXT, role TEXT, region_ids TEXT, token TEXT, invited_by TEXT, created_at INTEGER, expires_at INTEGER, accepted_at INTEGER);
  `);

  // Clear everything
  db.exec('DELETE FROM audit_log; DELETE FROM ticket_tags; DELETE FROM attachments; DELETE FROM notes; DELETE FROM messages; DELETE FROM tickets; DELETE FROM user_regions; DELETE FROM users; DELETE FROM tags; DELETE FROM close_reasons; DELETE FROM regions; DELETE FROM gmail_tokens; DELETE FROM email_sync_state; DELETE FROM email_filters; DELETE FROM settings; DELETE FROM sessions; DELETE FROM invitations;');

  // Regions
  const iR = db.prepare('INSERT INTO regions (id, name, routing_aliases, is_active) VALUES (?, ?, ?, ?)');
  iR.run('r1', 'Central PA', '["centralpa@seniorityhealthcare.com"]', 1);
  iR.run('r2', 'South NJ', '["southnj@seniorityhealthcare.com"]', 1);
  iR.run('r3', 'Delaware Valley', '["delawarevalley@seniorityhealthcare.com"]', 1);

  // Users — only real accounts
  const pwHash = bcrypt.hashSync('Seniority2024!', 12);
  const now = Date.now();
  const iU = db.prepare('INSERT INTO users (id, name, email, role, avatar, password_hash, totp_enabled, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?)');
  const iUR = db.prepare('INSERT INTO user_regions (user_id, region_id) VALUES (?, ?)');

  iU.run('u1', 'Dr. Hopkins', 'drhopkins@seniorityhealthcare.com', 'admin', 'DH', pwHash, now);
  iUR.run('u1', 'r1'); iUR.run('u1', 'r2'); iUR.run('u1', 'r3');

  iU.run('u2', 'Hello Coordinator', 'hello@seniorityhealthcare.com', 'coordinator', 'HC', pwHash, now);
  iUR.run('u2', 'r1'); iUR.run('u2', 'r2'); iUR.run('u2', 'r3');

  // Sync state for hello@ coordinator
  db.prepare('INSERT INTO email_sync_state (user_id, last_sync_at, sync_start_date) VALUES (?, 0, ?)').run('u2', '2026/03/07');

  // Tags
  const iT = db.prepare('INSERT INTO tags (id, name, color) VALUES (?, ?, ?)');
  iT.run('t1', 'Urgent', '#ef4444');
  iT.run('t2', 'Prior Auth', '#f59e0b');
  iT.run('t3', 'Referral', '#3b82f6');
  iT.run('t4', 'Benefits', '#8b5cf6');
  iT.run('t5', 'DME', '#e87e22');
  iT.run('t6', 'Follow-Up', '#ec4899');

  // Close Reasons
  const iCR = db.prepare('INSERT INTO close_reasons (id, label, requires_comment) VALUES (?, ?, ?)');
  iCR.run('cr1', 'Resolved — information provided', 0);
  iCR.run('cr2', 'Resolved — referral completed', 0);
  iCR.run('cr3', 'Resolved — appointment scheduled', 0);
  iCR.run('cr4', 'No response after follow-up', 1);
  iCR.run('cr5', 'Duplicate / merged', 1);
  iCR.run('cr6', 'Out of scope — redirected', 1);

  saveDb();
  console.log('\\n✅ Clean database seeded');
  console.log('   3 regions: Central PA, South NJ, Delaware Valley');
  console.log('   2 users: Dr. Hopkins (admin), Hello Coordinator');
  console.log('   Password: Seniority2024!');
  console.log('   Sync state initialized for hello@\\n');
  closeDb();
}

seed().catch(err => { console.error('Seed failed:', err); process.exit(1); });
