const fs = require('fs');
let f = fs.readFileSync('client/src/components/ui.jsx', 'utf8');
f = f.replace(
  "const idx = user ? (user.id.charCodeAt(1) * 7) % AVATAR_COLORS.length : 0;",
  "const idx = user && user.id ? (user.id.charCodeAt(Math.min(1, user.id.length - 1)) * 7) % AVATAR_COLORS.length : 0;"
);
fs.writeFileSync('client/src/components/ui.jsx', f, 'utf8');
console.log('fixed');
