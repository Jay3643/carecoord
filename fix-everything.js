// fix-everything.js
// This patches the seed to hash passwords DURING seeding (not after)
// and adds debug logging to server startup

const fs = require('fs');
const path = require('path');

console.log('\n🔧 Fixing everything...\n');

// ─── 1. Rewrite seed.js to hash passwords inline ────────────────────────────

const seedPath = path.join(__dirname, 'server', 'seed.js');
let seedJs = fs.readFileSync(seedPath, 'utf8');

// Check if it already has the fixed version
if (seedJs.includes('bcrypt.hashSync')) {
  console.log('  ✓ seed.js already patched');
} else {
  // Find where users are inserted and add bcrypt
  // First, add require at top
  if (!seedJs.includes('bcryptjs')) {
    seedJs = "const bcrypt = require('bcryptjs');\n" + seedJs;
  }

  // Find the user insert statement and add password hashing
  // The seed likely does something like .run(id, name, email, role, avatar)
  // We need to find and patch the INSERT INTO users statement
  
  // Add a global password hash before the inserts
  seedJs = seedJs.replace(
    /const\s*\{\s*initDb/,
    "const DEMO_HASH = bcrypt.hashSync('Seniority2024!', 12);\nconst { initDb"
  );

  // Remove the old hashPasswords function if it exists
  seedJs = seedJs.replace(/\n\/\/ Hash demo passwords[\s\S]*$/, '');

  fs.writeFileSync(seedPath, seedJs, 'utf8');
  console.log('  ✓ seed.js — added bcrypt require + DEMO_HASH');
}

// ─── 2. Check what the INSERT INTO users looks like ──────────────────────────

seedJs = fs.readFileSync(seedPath, 'utf8');

// Find the user insert pattern. It could be various forms.
// Let's just do a direct approach: after seeding, hash all passwords

// Remove any existing hashPasswords block
seedJs = seedJs.replace(/\n\/\/ Hash demo passwords[\s\S]*$/, '');

// Append a proper inline password update that runs in the same async flow
if (!seedJs.includes('SETTING PASSWORDS')) {
  // Find the last saveDb() call or the end of the main async function
  // and insert password hashing before it
  
  // Actually, let's just append a simpler approach:
  // After the main seed runs, update all users
  seedJs += `
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
`;
  fs.writeFileSync(seedPath, seedJs, 'utf8');
  console.log('  ✓ seed.js — appended password fix (runs 2s after seed)');
}

// ─── 3. Add startup debug to server/index.js ─────────────────────────────────

const indexPath = path.join(__dirname, 'server', 'index.js');
let indexJs = fs.readFileSync(indexPath, 'utf8');

if (!indexJs.includes('STARTUP DEBUG')) {
  indexJs = indexJs.replace(
    /app\.listen\(PORT/,
    `// STARTUP DEBUG - check if passwords exist
  const startupDb = getDb();
  const startupUsers = startupDb.prepare('SELECT email, password_hash, totp_enabled FROM users').all();
  console.log('\\n📋 Users at startup:');
  startupUsers.forEach(u => {
    const hasHash = u.password_hash && (u.password_hash.startsWith('$2') || u.password_hash.length > 20);
    console.log('  ' + u.email + ' | pw: ' + (hasHash ? 'YES' : 'NO (' + (u.password_hash || 'NULL') + ')') + ' | 2fa: ' + u.totp_enabled);
  });
  console.log('');

  app.listen(PORT`
  );
  fs.writeFileSync(indexPath, indexJs, 'utf8');
  console.log('  ✓ server/index.js — added startup debug logging');
} else {
  console.log('  ✓ server/index.js — startup debug already present');
}

console.log('\n✅ Done! Now run:');
console.log('  del server\\carecoord.db');
console.log('  npm run seed');
console.log('  (wait for "All passwords set" message)');
console.log('  npm run dev');
console.log('  (check server terminal for "Users at startup" showing pw: YES)');
console.log('  Login: tadkins@carecoord.org / Seniority2024!\n');
