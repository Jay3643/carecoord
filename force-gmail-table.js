// force-gmail-table.js
const {initDb, getDb, saveDb} = require('./server/database');

initDb().then(() => {
  const db = getDb();
  
  // Show all tables
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  console.log('Current tables:', tables.map(t => t.name).join(', '));
  
  // Create gmail_tokens if missing
  if (!tables.find(t => t.name === 'gmail_tokens')) {
    db.prepare('CREATE TABLE gmail_tokens (id TEXT PRIMARY KEY, user_id TEXT, access_token TEXT, refresh_token TEXT, expiry_date INTEGER, email TEXT)').run();
    saveDb();
    console.log('✓ Created gmail_tokens table');
  } else {
    console.log('✓ gmail_tokens already exists');
  }
  
  // Verify
  const tables2 = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  console.log('Tables now:', tables2.map(t => t.name).join(', '));
});
