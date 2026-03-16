const fs = require('fs');
let auth = fs.readFileSync('server/routes/auth.js', 'utf8');

// Add requireAuth import from middleware at the top
auth = auth.replace(
  "const router = express.Router();",
  "const { requireAuth } = require('../middleware');\nconst router = express.Router();"
);

fs.writeFileSync('server/routes/auth.js', auth, 'utf8');

try { require('./server/routes/auth'); console.log('✓ auth.js compiles OK'); }
catch(e) { console.log('ERROR:', e.message); }
