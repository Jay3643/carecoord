// fix-seed-final.js
// Makes seed.js self-contained: hashes passwords + creates gmail_tokens
const fs = require('fs');
const path = require('path');

const seedPath = path.join(__dirname, 'server', 'seed.js');
let seed = fs.readFileSync(seedPath, 'utf8');

// Find the line that says "Database seeded successfully" and insert password hashing BEFORE it
// Also ensure gmail_tokens table is created

// First, remove any old hashPasswords or password fix blocks
seed = seed.replace(/\n\/\/ ── Fix passwords after seed ──[\s\S]*$/, '');
seed = seed.replace(/\n\/\/ Hash demo passwords[\s\S]*$/, '');

// Find the success message
const successMsg = seed.match(/console\.log\('.*Database seeded successfully.*'\);/);
if (!successMsg) {
  console.log('ERROR: Could not find success message in seed.js');
  process.exit(1);
}

// Insert password hashing and gmail_tokens table BEFORE the success message
const insertCode = `
    // Create gmail_tokens table
    db.prepare('CREATE TABLE IF NOT EXISTS gmail_tokens (id TEXT PRIMARY KEY, user_id TEXT, access_token TEXT, refresh_token TEXT, expiry_date INTEGER, email TEXT)').run();

    // Hash all passwords
    const bcryptSeed = require('bcryptjs');
    const pwHash = bcryptSeed.hashSync('Seniority2024!', 12);
    const allUsers = db.prepare('SELECT id FROM users').all();
    for (const u of allUsers) {
      db.prepare('UPDATE users SET password_hash = ?, totp_enabled = 0, totp_secret = NULL WHERE id = ?').run(pwHash, u.id);
    }
    saveDb();
    console.log('   Passwords set for ' + allUsers.length + ' users (Seniority2024!)');

    `;

seed = seed.replace(successMsg[0], insertCode + successMsg[0]);

fs.writeFileSync(seedPath, seed, 'utf8');
console.log('✓ seed.js now hashes passwords and creates gmail_tokens during seeding');
console.log('\nNow run:');
console.log('  del server\\carecoord.db');
console.log('  npm run seed');
console.log('  npm run dev');
console.log('\nNo more need for setup-db.js or fix-passwords.js!');
