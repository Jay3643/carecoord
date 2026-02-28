const express = require('express');
const { getDb } = require('../database');
const { requireAuth } = require('../middleware');

const router = express.Router();

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  const db = getDb();
  const user = db.prepare(`
    SELECT u.*, GROUP_CONCAT(ur.region_id) as region_ids
    FROM users u
    LEFT JOIN user_regions ur ON ur.user_id = u.id
    WHERE u.id = ? AND u.is_active = 1
    GROUP BY u.id
  `).get(userId);

  if (!user) return res.status(404).json({ error: 'User not found' });

  user.regionIds = user.region_ids ? user.region_ids.split(',') : [];
  delete user.region_ids;

  req.session.userId = user.id;
  res.json({ user });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
