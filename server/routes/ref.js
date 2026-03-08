const express = require('express');
const { getDb } = require('../database');
const { requireAuth } = require('../middleware');
const router = express.Router();

router.get('/tags', requireAuth, (req, res) => {
  try { res.json({ tags: getDb().prepare('SELECT * FROM tags').all() }); }
  catch(e) { res.json({ tags: [] }); }
});

router.get('/close-reasons', requireAuth, (req, res) => {
  try { res.json({ reasons: getDb().prepare('SELECT * FROM close_reasons').all() }); }
  catch(e) { res.json({ reasons: [] }); }
});

router.get('/regions', requireAuth, (req, res) => {
  try { res.json({ regions: getDb().prepare('SELECT * FROM regions WHERE is_active = 1').all() }); }
  catch(e) { res.json({ regions: [] }); }
});

router.get('/users', requireAuth, (req, res) => {
  try { res.json({ users: getDb().prepare('SELECT id, name, email, role, avatar FROM users WHERE is_active = 1').all() }); }
  catch(e) { res.json({ users: [] }); }
});

module.exports = router;
