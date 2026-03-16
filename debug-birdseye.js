const fs = require('fs');

// Check how tickets is mounted
const index = fs.readFileSync('server/index.js', 'utf8');
const ticketLines = index.split('\n').filter(l => l.includes('ticket'));
console.log('=== index.js ticket references:');
ticketLines.forEach(l => console.log('  ', l.trim()));

const tickets = fs.readFileSync('server/routes/tickets.js', 'utf8');
const beIdx = tickets.indexOf('birds-eye');
console.log('\n=== Route context:');
console.log(tickets.substring(Math.max(0, beIdx - 50), beIdx + 50));

const exports = (tickets.match(/module\.exports/g) || []).length;
console.log('\n=== module.exports count:', exports);

// Check if it's router.get or something else
if (tickets.includes("router.get('/birds-eye'")) {
  console.log('✓ Route defined as router.get');
} else {
  console.log('✗ Route NOT found as router.get');
}

// Try to actually load and test the routes
try {
  const { initDb } = require('./server/database');
  initDb().then(() => {
    const app = require('express')();
    app.use(require('cookie-parser')());
    app.use(require('express').json());
    const ticketRouter = require('./server/routes/tickets');
    // Check what routes are registered
    if (ticketRouter.stack) {
      ticketRouter.stack.forEach(r => {
        if (r.route) console.log('  Route:', r.route.methods, r.route.path);
      });
    }
    console.log('\nDone.');
  });
} catch(e) {
  console.log('Load error:', e.message);
}
