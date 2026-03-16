// fix-seed-dup.js
const fs = require('fs');
const path = require('path');

const seedPath = path.join(__dirname, 'server', 'seed.js');
let seed = fs.readFileSync(seedPath, 'utf8');

// Remove ALL the inserted password/gmail blocks, then add ONE clean block
// Find the first occurrence of "Create gmail_tokens table" and everything until the success message
seed = seed.replace(/\n\s*\/\/ Create gmail_tokens table[\s\S]*?console\.log\('\s*Passwords set for[\s\S]*?\);\n/g, '\n');

// Also remove old blocks
seed = seed.replace(/\n\/\/ ── Fix passwords after seed ──[\s\S]*$/, '');
seed = seed.replace(/\n\/\/ Hash demo passwords[\s\S]*$/, '');

// Now find the success message and add ONE clean block before it
const successMatch = seed.match(/console\.log\('.*Database seeded successfully.*'\);/);
if (successMatch) {
  const block = `
    // Create gmail_tokens table
    db.prepare('CREATE TABLE IF NOT EXISTS gmail_tokens (id TEXT PRIMARY KEY, user_id TEXT, access_token TEXT, refresh_token TEXT, expiry_date INTEGER, email TEXT)').run();

    // Hash all passwords
    const pwHash = require('bcryptjs').hashSync('Seniority2024!', 12);
    const allUsers = db.prepare('SELECT id FROM users').all();
    for (const u of allUsers) {
      db.prepare('UPDATE users SET password_hash = ?, totp_enabled = 0, totp_secret = NULL WHERE id = ?').run(pwHash, u.id);
    }
    saveDb();
    console.log('   Passwords set for ' + allUsers.length + ' users (Seniority2024!)');

    `;
  seed = seed.replace(successMatch[0], block + successMatch[0]);
}

fs.writeFileSync(seedPath, seed, 'utf8');
console.log('✓ seed.js fixed — one clean password block');
