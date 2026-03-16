const fs = require('fs');

// 1. Fix database.js path
let db = fs.readFileSync('server/database.js', 'utf8');
db = db.replace(
  "const DB_PATH = p.join(__dirname, 'carecoord.db');",
  "const DB_PATH = process.env.NODE_ENV === 'production' && require('fs').existsSync('/data') ? '/data/carecoord.db' : p.join(__dirname, 'carecoord.db');"
);
fs.writeFileSync('server/database.js', db, 'utf8');
console.log(db.includes('/data/carecoord.db') ? '✓ database.js — /data path added' : '✗ database.js failed');

// 2. Remove hello from seed.js
let seed = fs.readFileSync('server/seed.js', 'utf8');

// Remove hello user insert
seed = seed.replace(/\s*db\.prepare\('INSERT INTO users.*?hello@seniorityhealthcare\.com.*?\n/g, '\n');
seed = seed.replace(/\s*db\.prepare\('INSERT INTO user_regions.*?'u2'.*?\n/g, '\n');

// Remove hello sync state
seed = seed.replace(/\s*\/\/ Sync state for hello.*?\n/g, '\n');
seed = seed.replace(/\s*db\.prepare\('INSERT INTO email_sync_state.*?'u2'.*?\n/g, '\n');

// Fix console output
seed = seed.replace("2 users: Dr. Hopkins (admin), Hello Coordinator", "1 user: Dr. Hopkins (admin)");
seed = seed.replace("Sync state initialized for hello@", "No sync state needed");

fs.writeFileSync('server/seed.js', seed, 'utf8');

const check = fs.readFileSync('server/seed.js', 'utf8');
console.log(!check.includes('hello@') ? '✓ seed.js — hello removed' : '✗ seed.js still has hello');
