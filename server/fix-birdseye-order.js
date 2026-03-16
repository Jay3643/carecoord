const fs = require('fs');
let t = fs.readFileSync('server/routes/tickets.js', 'utf8');

// Extract the birds-eye route block
const start = t.indexOf("// ── Bird's Eye Dashboard ──");
if (start === -1) { console.log('birds-eye block not found'); process.exit(1); }

// Find the end of the route handler
let depth = 0, foundStart = false, end = start;
const routeStart = t.indexOf("router.get('/birds-eye'", start);
for (let i = routeStart; i < t.length; i++) {
  if (t[i] === '{') { depth++; foundStart = true; }
  if (t[i] === '}') { depth--; }
  if (foundStart && depth === 0) {
    // Find the closing );
    end = t.indexOf(');', i) + 2;
    break;
  }
}

const birdsEyeBlock = t.substring(start, end);
console.log('Extracted birds-eye block:', birdsEyeBlock.length, 'chars');

// Remove it from current location
t = t.substring(0, start) + t.substring(end);

// Insert it right after "const router = express.Router();" 
t = t.replace(
  "const router = express.Router();",
  "const router = express.Router();\n\n" + birdsEyeBlock + "\n"
);

fs.writeFileSync('server/routes/tickets.js', t, 'utf8');
console.log('✓ birds-eye route moved to TOP of tickets.js (before any :id routes)');
console.log('Restart server.');
