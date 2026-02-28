const {initDb, getDb, saveDb} = require('./server/database');
const bcrypt = require('bcryptjs');

initDb().then(async () => {
  const db = getDb();
  
  // Show user table columns
  const cols = db.prepare('PRAGMA table_info(users)').all();
  console.log('User table columns:', cols.map(c => c.name).join(', '));
  
  const hasPasswordCol = cols.some(c => c.name === 'password_hash');
  const hasTotpSecret = cols.some(c => c.name === 'totp_secret');
  const hasTotpEnabled = cols.some(c => c.name === 'totp_enabled');
  
  if (!hasPasswordCol) {
    console.log('\n⚠ password_hash column MISSING — adding it now...');
    db.prepare('ALTER TABLE users ADD COLUMN password_hash TEXT').run();
    saveDb();
    console.log('  ✓ Added password_hash column');
  }
  
  if (!hasTotpSecret) {
    console.log('⚠ totp_secret column MISSING — adding it now...');
    db.prepare('ALTER TABLE users ADD COLUMN totp_secret TEXT').run();
    saveDb();
    console.log('  ✓ Added totp_secret column');
  }
  
  if (!hasTotpEnabled) {
    console.log('⚠ totp_enabled column MISSING — adding it now...');
    db.prepare('ALTER TABLE users ADD COLUMN totp_enabled INTEGER DEFAULT 0').run();
    saveDb();
    console.log('  ✓ Added totp_enabled column');
  }
  
  // Now hash all passwords
  console.log('\nSetting all passwords to Seniority2024!...');
  const hash = await bcrypt.hash('Seniority2024!', 12);
  const users = db.prepare('SELECT id, email FROM users').all();
  for (const u of users) {
    db.prepare('UPDATE users SET password_hash = ?, totp_enabled = 0, totp_secret = NULL WHERE id = ?').run(hash, u.id);
  }
  saveDb();
  
  // Verify
  const check = db.prepare('SELECT email, password_hash FROM users').all();
  check.forEach(u => console.log('  ✓', u.email, u.password_hash?.substring(0, 10) + '...'));
  
  console.log('\n✅ Done! All users can now login with: Seniority2024!');
});
