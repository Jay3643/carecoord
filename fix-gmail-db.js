// fix-gmail-db.js
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, 'server', 'database.js');
let db = fs.readFileSync(dbPath, 'utf8');

if (!db.includes('gmail_tokens')) {
  // Find the last CREATE TABLE statement and add gmail_tokens after it
  const lastCreate = db.lastIndexOf("db.prepare('CREATE TABLE IF NOT EXISTS");
  if (lastCreate === -1) {
    console.log('ERROR: Could not find any CREATE TABLE in database.js');
    process.exit(1);
  }
  
  // Find the end of that statement (the .run(); part)
  const afterLastCreate = db.indexOf('.run();', lastCreate);
  const insertPoint = afterLastCreate + '.run();'.length;
  
  const gmailTable = `

    db.prepare('CREATE TABLE IF NOT EXISTS gmail_tokens (id TEXT PRIMARY KEY, user_id TEXT, access_token TEXT, refresh_token TEXT, expiry_date INTEGER, email TEXT)').run();`;
  
  db = db.slice(0, insertPoint) + gmailTable + db.slice(insertPoint);
  
  fs.writeFileSync(dbPath, db, 'utf8');
  console.log('✓ Added gmail_tokens table to database.js');
} else {
  console.log('✓ gmail_tokens already in database.js');
}

console.log('\nNow delete DB and re-seed:');
console.log('  del server\\carecoord.db');
console.log('  npm run seed');
console.log('  node fix-passwords.js');
