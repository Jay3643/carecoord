const fs = require('fs');
let t = fs.readFileSync('server/routes/tickets.js', 'utf8');

// 1. Extract the entire birds-eye block
const beComment = "// ── Bird's Eye Dashboard ──";
const beStart = t.indexOf(beComment);
const beRouteEnd = t.indexOf("module.exports = router;");
const birdsEyeBlock = t.substring(beStart, beRouteEnd).trim();

// 2. Remove it from current location
t = t.substring(0, beStart) + '\n' + t.substring(beRouteEnd);

// 3. Insert it BEFORE router.get('/:id')
t = t.replace(
  "router.get('/:id', requireAuth, (req, res) => {",
  birdsEyeBlock + "\n\nrouter.get('/:id', requireAuth, (req, res) => {"
);

fs.writeFileSync('server/routes/tickets.js', t, 'utf8');
console.log('✓ birds-eye route moved ABOVE /:id route');
console.log('Restart server.');
