// setup-db.js
// Run this ONCE after every 'del server\carecoord.db' + 'npm run seed'
const {initDb, getDb, saveDb} = require('./server/database');
const bcrypt = require('bcryptjs');

initDb().then(async () => {
  const db = getDb();

  // 1. Add gmail_tokens table
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  if (!tables.find(t => t.name === 'gmail_tokens')) {
    db.prepare('CREATE TABLE gmail_tokens (id TEXT PRIMARY KEY, user_id TEXT, access_token TEXT, refresh_token TEXT, expiry_date INTEGER, email TEXT)').run();
    console.log('✓ Created gmail_tokens table');
  }

  // 2. Ensure columns exist
  const cols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  if (!cols.includes('password_hash')) db.prepare('ALTER TABLE users ADD COLUMN password_hash TEXT').run();
  if (!cols.includes('totp_secret')) db.prepare('ALTER TABLE users ADD COLUMN totp_secret TEXT').run();
  if (!cols.includes('totp_enabled')) db.prepare('ALTER TABLE users ADD COLUMN totp_enabled INTEGER DEFAULT 0').run();

  // 3. Hash all passwords
  const hash = await bcrypt.hash('Seniority2024!', 12);
  const users = db.prepare('SELECT id, email FROM users').all();
  for (const u of users) {
    db.prepare('UPDATE users SET password_hash = ?, totp_enabled = 0, totp_secret = NULL WHERE id = ?').run(hash, u.id);
  }

  saveDb();

  console.log('✓ All passwords set to Seniority2024!');
  console.log('✓ Users:', users.map(u => u.email).join(', '));
  
  const allTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  console.log('✓ Tables:', allTables.map(t => t.name).join(', '));
  console.log('\n✅ Database ready! Run: npm run dev');
});
