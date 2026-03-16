// fix-middleware.js
const fs = require('fs');
let f = fs.readFileSync('server/middleware.js', 'utf8');

if (!f.includes('requireSupervisor')) {
  f = f.replace(
    'module.exports = { requireAuth, addAudit, toStr };',
    `function requireSupervisor(req, res, next) {
  if (req.user.role === 'supervisor' || req.user.role === 'admin') return next();
  res.status(403).json({ error: 'Forbidden' });
}

module.exports = { requireAuth, requireSupervisor, addAudit, toStr };`
  );
  fs.writeFileSync('server/middleware.js', f, 'utf8');
  console.log('fixed');
} else {
  console.log('already there');
}
