const fs = require('fs');
let auth = fs.readFileSync('server/routes/auth.js', 'utf8');

// Replace the success-only response with full user data
auth = auth.replace(
  "setSession(res, toStr(user.id));\n  res.json({ success: true });",
  `setSession(res, toStr(user.id));
  const regions = db.prepare('SELECT region_id FROM user_regions WHERE user_id = ?').all(toStr(user.id));
  res.json({
    user: {
      id: toStr(user.id), name: toStr(user.name), email: toStr(user.email),
      role: toStr(user.role), avatar: toStr(user.avatar),
      regionIds: regions.map(r => r.region_id),
    }
  });`
);

fs.writeFileSync('server/routes/auth.js', auth, 'utf8');
console.log('✓ Login now returns user data. Refresh browser and log in.');
