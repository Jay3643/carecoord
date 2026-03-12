const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Check if DB exists on persistent disk or locally
const dbPath = fs.existsSync('/data') ? '/data/carecoord.db' : path.join(__dirname, 'server', 'carecoord.db');

if (!fs.existsSync(dbPath)) {
  console.log('[Start] No database found — running seed...');
  execSync('node server/seed.js', { stdio: 'inherit' });
} else {
  console.log('[Start] Database exists — skipping seed');
}

// Start the server
require('./server/index.js');
