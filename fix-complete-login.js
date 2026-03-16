// fix-complete-login.js
const fs = require('fs');
const path = require('path');

const authPath = path.join(__dirname, 'server', 'routes', 'auth.js');
let auth = fs.readFileSync(authPath, 'utf8');

auth = auth.replace(
  `function completeLogin(req, res, user) {
  const db = getDb();
  const regions = db.prepare('SELECT region_id FROM user_regions WHERE user_id = ?').all(user.id);
  delete req.session.pendingUserId;
  delete req.session.pending2FA;
  delete req.session.requireSetup2FA;
  delete req.session.requirePasswordChange;

  req.session.userId = user.id;
  addAudit(db, user.id, 'login', 'user', user.id, 'User logged in');

  res.json({
    step: 'done',
    user: {
      id: user.id,
      name: toStr(user.name),
      email: toStr(user.email),
      role: toStr(user.role),
      avatar: toStr(user.avatar),
      regionIds: regions.map(r => r.region_id),
    },
  });
}`,
  `function completeLogin(req, res, user) {
  const db = getDb();
  const userId = toStr(user.id);
  const regions = db.prepare('SELECT region_id FROM user_regions WHERE user_id = ?').all(userId);
  delete req.session.pendingUserId;
  delete req.session.pending2FA;
  delete req.session.requireSetup2FA;
  delete req.session.requirePasswordChange;

  req.session.userId = userId;
  addAudit(db, userId, 'login', 'user', userId, 'User logged in');

  res.json({
    step: 'done',
    user: {
      id: userId,
      name: toStr(user.name),
      email: toStr(user.email),
      role: toStr(user.role),
      avatar: toStr(user.avatar),
      regionIds: regions.map(r => toStr(r.region_id)),
    },
  });
}`
);

fs.writeFileSync(authPath, auth, 'utf8');
console.log('✓ completeLogin now converts all Uint8Arrays');
