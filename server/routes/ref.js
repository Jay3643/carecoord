const express = require('express');
const { getDb } = require('../database');
const { requireAuth } = require('../middleware');

const router = express.Router();

// GET /api/ref/regions
router.get('/regions', requireAuth, (req, res) => {
  const db = getDb();
  const regions = db.prepare('SELECT * FROM regions WHERE is_active = 1').all();
  regions.forEach(r => r.routing_aliases = JSON.parse(r.routing_aliases || '[]'));
  res.json({ regions });
});

// GET /api/ref/users
router.get('/users', requireAuth, (req, res) => {
  const db = getDb();
  const users = db.prepare(`
    SELECT u.*, GROUP_CONCAT(ur.region_id) as region_ids
    FROM users u
    LEFT JOIN user_regions ur ON ur.user_id = u.id
    WHERE u.is_active = 1
    GROUP BY u.id
  `).all();
  users.forEach(u => {
    u.regionIds = u.region_ids ? u.region_ids.split(',') : [];
    delete u.region_ids;
  });
  res.json({ users });
});

// GET /api/ref/tags
router.get('/tags', requireAuth, (req, res) => {
  const db = getDb();
  res.json({ tags: db.prepare('SELECT * FROM tags').all() });
});

// GET /api/ref/close-reasons
router.get('/close-reasons', requireAuth, (req, res) => {
  const db = getDb();
  res.json({ closeReasons: db.prepare('SELECT * FROM close_reasons').all() });
});

// GET /api/ref/coordinators-for-region/:regionId
router.get('/coordinators-for-region/:regionId', requireAuth, (req, res) => {
  const db = getDb();
  const users = db.prepare(`
    SELECT u.*
    FROM users u
    JOIN user_regions ur ON ur.user_id = u.id
    WHERE ur.region_id = ? AND u.is_active = 1 AND u.role IN ('coordinator', 'supervisor')
  `).all(req.params.regionId);
  res.json({ users });
});

module.exports = router;
