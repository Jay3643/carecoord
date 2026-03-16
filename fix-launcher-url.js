const fs = require('fs');
let f = fs.readFileSync('client/src/components/AppLauncher.jsx', 'utf8');

f = f.replace(
  "'https://about.google/products/'",
  "'https://mail.google.com'"
);

f = f.replace(
  "const w = 400, h = 600;",
  "const w = 1100, h = 700;"
);

fs.writeFileSync('client/src/components/AppLauncher.jsx', f, 'utf8');
console.log('✓ Opens Gmail in popup — click the waffle icon there for all apps');
