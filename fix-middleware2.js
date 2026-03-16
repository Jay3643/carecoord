// fix-middleware2.js
const fs = require('fs');
let f = fs.readFileSync('server/middleware.js', 'utf8');

f = f.replace(
  "req.user = { id: toStr(user.id), name: toStr(user.name), email: toStr(user.email), role: toStr(user.role) };",
  "const regions = db.prepare('SELECT region_id FROM user_regions WHERE user_id = ?').all(toStr(user.id));\n  req.user = { id: toStr(user.id), name: toStr(user.name), email: toStr(user.email), role: toStr(user.role), regionIds: regions.map(r => toStr(r.region_id)) };"
);

fs.writeFileSync('server/middleware.js', f, 'utf8');
console.log('fixed — regionIds now on req.user');
