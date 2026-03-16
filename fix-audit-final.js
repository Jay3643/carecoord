const fs = require('fs');

// 1. Add fmt.initials to utils.js
let utils = fs.readFileSync('client/src/utils.js', 'utf8');
if (!utils.includes('initials')) {
  utils = utils.replace(
    "  date(ts) {",
    `  initials(name) {
    if (!name) return '?';
    return name.split(' ').map(w => w[0]).join('').toUpperCase().substring(0, 2);
  },
  date(ts) {`
  );
  fs.writeFileSync('client/src/utils.js', utils, 'utf8');
  console.log('  ✓ utils.js — added fmt.initials');
}

// 2. Fix AuditLog: system entries (null actor) should not render Avatar
let audit = fs.readFileSync('client/src/components/AuditLog.jsx', 'utf8');

// Check if it imports fmt
if (!audit.includes("import { fmt }")) {
  // It already does per the uploaded file, so this is fine
}

// The issue: entries with actor_name = 'System' still pass to Avatar with null id
// Fix: only show Avatar when actor_user_id exists
audit = audit.replace(
  "entry.actor_name ? (",
  "entry.actor_user_id ? ("
);

fs.writeFileSync('client/src/components/AuditLog.jsx', audit, 'utf8');
console.log('  ✓ AuditLog.jsx — only show Avatar when real user');

console.log('Done. Refresh browser.');
