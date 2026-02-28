const {initDb, getDb} = require('./server/database');
const bcrypt = require('bcryptjs');

initDb().then(async () => {
  const db = getDb();
  
  // Show all users and their password status
  const users = db.prepare('SELECT id, email, name, password_hash, totp_enabled FROM users').all();
  console.log('\nAll users in database:');
  users.forEach(u => {
    const hasHash = u.password_hash && u.password_hash.startsWith('$2');
    console.log('  ' + u.email + ' | hash: ' + (hasHash ? 'YES' : 'NO (' + (u.password_hash || 'NULL') + ')'));
  });

  // Try to verify password for first user
  const testUser = users[0];
  if (testUser && testUser.password_hash) {
    console.log('\nTesting bcrypt compare for ' + testUser.email + '...');
    const result = await bcrypt.compare('Seniority2024!', testUser.password_hash);
    console.log('  Password match: ' + result);
  }

  // Also check what the auth route query looks like
  const testEmail = 'tadkins@carecoord.org';
  const found = db.prepare('SELECT id, email, password_hash, is_active FROM users WHERE email = ? AND is_active = 1').get(testEmail);
  console.log('\nLooking up ' + testEmail + ': ' + (found ? 'FOUND (hash starts: ' + (found.password_hash || 'NULL')?.substring(0,10) + ')' : 'NOT FOUND'));
});
