// fix-seed-order.js
const fs = require('fs');
const path = require('path');

const seedPath = path.join(__dirname, 'server', 'seed.js');
let seed = fs.readFileSync(seedPath, 'utf8');

// Remove the misplaced DEMO_HASH line
seed = seed.replace("const DEMO_HASH = bcrypt.hashSync('Seniority2024!', 12);\n", '');

// Make sure bcrypt require is at the very top
seed = seed.replace("const bcrypt = require('bcryptjs');\n", '');
seed = "const bcrypt = require('bcryptjs');\n" + seed;

fs.writeFileSync(seedPath, seed, 'utf8');
console.log('✓ Fixed seed.js line order');
console.log('Now run: npm run seed');
