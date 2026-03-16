const fs = require('fs');
let auth = fs.readFileSync('server/routes/auth.js', 'utf8');

// Add /me and /logout before module.exports
if (!auth.includes("'/me'")) {
  auth = auth.replace(
    'module.exports = router;',
    `router.get('/me', (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated' });

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id);
  if (!user) return res.status(401).json({ error: 'User not found' });

  const regions = db.prepare('SELECT region_id FROM user_regions WHERE user_id = ?').all(session.user_id);
  res.json({
    user: {
      id: toStr(user.id), name: toStr(user.name), email: toStr(user.email),
      role: toStr(user.role), avatar: toStr(user.avatar),
      regionIds: regions.map(r => r.region_id),
    }
  });
});

router.post('/logout', (req, res) => {
  const sid = req.cookies?.sid;
  if (sid) {
    try { getDb().prepare('DELETE FROM sessions WHERE sid = ?').run(sid); saveDb(); } catch(e) {}
  }
  res.clearCookie('sid');
  res.json({ success: true });
});

module.exports = router;`
  );
}

fs.writeFileSync('server/routes/auth.js', auth, 'utf8');
console.log('✓ Added /me and /logout routes to auth.js');
