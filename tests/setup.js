/**
 * CareCoord Test Infrastructure
 *
 * Boots an isolated test server with a fresh in-memory database,
 * seeds test data, and provides an HTTP client with cookie tracking.
 */
const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const { createRequire } = require('module');

// Resolve modules from server/node_modules
const serverRequire = createRequire(path.join(__dirname, '..', 'server', 'index.js'));

// Set test DB path BEFORE importing database module
const testDbPath = path.join(os.tmpdir(), 'carecoord-test-' + Date.now() + '.db');
process.env.DB_PATH = testDbPath;
process.env.SESSION_SECRET = 'test-secret-key';
process.env.ANTHROPIC_API_KEY = 'sk-test-fake-key';

const express = serverRequire('express');
const session = serverRequire('express-session');
const cookieParser = serverRequire('cookie-parser');
const bcrypt = serverRequire('bcryptjs');
const database = serverRequire('./database');

// ── HTTP Test Client with Cookie Jar ──────────────────────────────────────────

class TestClient {
  constructor(port) {
    this.port = port;
    this.cookies = {};
  }

  async request(method, urlPath, body = null) {
    return new Promise((resolve, reject) => {
      const bodyStr = body ? JSON.stringify(body) : null;
      const headers = { 'Content-Type': 'application/json' };
      if (bodyStr) headers['Content-Length'] = Buffer.byteLength(bodyStr);

      const cookieStr = Object.entries(this.cookies)
        .map(([k, v]) => k + '=' + v)
        .join('; ');
      if (cookieStr) headers['Cookie'] = cookieStr;

      const req = http.request({
        hostname: '127.0.0.1',
        port: this.port,
        path: urlPath,
        method,
        headers,
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          // Extract set-cookie headers
          const setCookies = res.headers['set-cookie'] || [];
          for (const c of setCookies) {
            const mainPart = c.split(';')[0];
            const eqIdx = mainPart.indexOf('=');
            if (eqIdx === -1) continue;
            const key = mainPart.substring(0, eqIdx).trim();
            const val = mainPart.substring(eqIdx + 1).trim();
            // Detect cookie deletion
            if (c.includes('Expires=Thu, 01 Jan 1970') || (c.includes('Max-Age=') && c.match(/Max-Age=0/))) {
              delete this.cookies[key];
            } else if (val) {
              this.cookies[key] = val;
            }
          }

          let parsed;
          try { parsed = JSON.parse(data); } catch (e) { parsed = data; }
          resolve({ status: res.statusCode, data: parsed, headers: res.headers });
        });
      });
      req.on('error', reject);
      if (bodyStr) req.write(bodyStr);
      req.end();
    });
  }

  get(p) { return this.request('GET', p); }
  post(p, body) { return this.request('POST', p, body); }
  put(p, body) { return this.request('PUT', p, body); }
  del(p) { return this.request('DELETE', p); }
}

// ── Test Data Constants ───────────────────────────────────────────────────────

const TEST_PASSWORD = 'TestPassword123!';
const TEST_USERS = {
  admin:       { id: 'u-test-admin', name: 'Test Admin',       email: 'admin@test.com',       role: 'admin' },
  supervisor:  { id: 'u-test-super', name: 'Test Supervisor',  email: 'super@test.com',       role: 'supervisor' },
  coordinator: { id: 'u-test-coord', name: 'Test Coordinator', email: 'coord@test.com',       role: 'coordinator' },
};
const TEST_REGIONS = [
  { id: 'r-test-1', name: 'Test Region Alpha',  aliases: '["alpha@test.com"]' },
  { id: 'r-test-2', name: 'Test Region Beta',   aliases: '["beta@test.com"]' },
  { id: 'r-test-3', name: 'Test Region Gamma',  aliases: '["gamma@test.com"]' },
];
const TEST_TAGS = [
  { id: 't-test-1', name: 'Urgent',    color: '#ef4444' },
  { id: 't-test-2', name: 'Follow-Up', color: '#3b82f6' },
];

// ── Seed Test Database ────────────────────────────────────────────────────────

function seedTestData() {
  const db = database.getDb();
  const pwHash = bcrypt.hashSync(TEST_PASSWORD, 4); // Low rounds for speed
  const now = Date.now();

  // Regions
  for (const r of TEST_REGIONS) {
    db.prepare('INSERT INTO regions (id, name, routing_aliases, is_active) VALUES (?, ?, ?, 1)')
      .run(r.id, r.name, r.aliases);
  }

  // Users
  for (const [, u] of Object.entries(TEST_USERS)) {
    const initials = u.name.split(' ').map(w => w[0]).join('');
    db.prepare('INSERT INTO users (id, name, email, role, avatar, password_hash, totp_enabled, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?)')
      .run(u.id, u.name, u.email, u.role, initials, pwHash, now);
  }

  // User-region assignments
  // Admin: all regions
  for (const r of TEST_REGIONS) {
    db.prepare('INSERT INTO user_regions (user_id, region_id) VALUES (?, ?)').run('u-test-admin', r.id);
  }
  // Supervisor: regions 1 and 2
  db.prepare('INSERT INTO user_regions (user_id, region_id) VALUES (?, ?)').run('u-test-super', 'r-test-1');
  db.prepare('INSERT INTO user_regions (user_id, region_id) VALUES (?, ?)').run('u-test-super', 'r-test-2');
  // Coordinator: region 1 only
  db.prepare('INSERT INTO user_regions (user_id, region_id) VALUES (?, ?)').run('u-test-coord', 'r-test-1');

  // Tags
  for (const t of TEST_TAGS) {
    db.prepare('INSERT INTO tags (id, name, color) VALUES (?, ?, ?)').run(t.id, t.name, t.color);
  }

  // Close reasons
  db.prepare('INSERT INTO close_reasons (id, label, requires_comment) VALUES (?, ?, ?)').run('cr-test-1', 'Resolved', 0);
  db.prepare('INSERT INTO close_reasons (id, label, requires_comment) VALUES (?, ?, ?)').run('cr-test-2', 'No Response', 1);

  // Test tickets
  db.prepare('INSERT INTO tickets (id, region_id, status, assignee_user_id, subject, from_email, external_participants, last_activity_at, created_at, has_unread) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('TRA-0001', 'r-test-1', 'OPEN', 'u-test-coord', 'Test Ticket Alpha', 'patient1@example.com', '["patient1@example.com"]', now, now - 86400000, 1);
  db.prepare('INSERT INTO tickets (id, region_id, status, assignee_user_id, subject, from_email, external_participants, last_activity_at, created_at, has_unread) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('TRB-0001', 'r-test-2', 'WAITING_ON_EXTERNAL', null, 'Test Ticket Beta', 'patient2@example.com', '["patient2@example.com"]', now - 3600000, now - 172800000, 0);

  // Messages on ticket 1
  db.prepare('INSERT INTO messages (id, ticket_id, direction, channel, from_address, to_addresses, subject, body_text, sent_at, provider_message_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('msg-test-1', 'TRA-0001', 'inbound', 'email', 'patient1@example.com', '["alpha@test.com"]', 'Test Ticket Alpha', 'I need help with my referral', now - 86400000, 'provider-1', now - 86400000);
  db.prepare('INSERT INTO messages (id, ticket_id, direction, channel, from_address, to_addresses, subject, body_text, sent_at, provider_message_id, created_by_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('msg-test-2', 'TRA-0001', 'outbound', 'email', 'alpha@test.com', '["patient1@example.com"]', 'Re: Test Ticket Alpha', 'We are looking into it', now - 43200000, 'provider-2', 'u-test-coord', now - 43200000);

  // Note on ticket 1
  db.prepare('INSERT INTO notes (id, ticket_id, author_user_id, body, created_at) VALUES (?, ?, ?, ?, ?)')
    .run('note-test-1', 'TRA-0001', 'u-test-coord', 'Called insurance company', now - 21600000);

  // Tag on ticket 1
  db.prepare('INSERT INTO ticket_tags (ticket_id, tag_id) VALUES (?, ?)').run('TRA-0001', 't-test-1');

  database.saveDb();
}

// ── Create Test Server ────────────────────────────────────────────────────────

async function createTestServer() {
  // Initialize fresh database
  await database.initDb();
  seedTestData();

  // Build Express app (mirrors server/index.js, minus gmail/ai routes)
  const app = express();
  app.use(express.json({ limit: '25mb' }));
  app.use(cookieParser());
  app.use(session({
    secret: 'test-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true, maxAge: 24 * 60 * 60 * 1000, sameSite: 'lax' },
  }));

  // Mock socket.io
  app.io = { to: () => ({ emit: () => {} }) };

  // Mount routes
  app.use('/api/auth', serverRequire('./routes/auth'));
  app.use('/api/tickets', serverRequire('./routes/tickets'));
  app.use('/api/dashboard', serverRequire('./routes/dashboard'));
  app.use('/api/ref', serverRequire('./routes/ref'));
  app.use('/api/audit', serverRequire('./routes/audit'));
  app.use('/api/admin', serverRequire('./routes/admin'));
  app.use('/api/chat', serverRequire('./routes/chat'));

  // Convenience routes (from index.js)
  app.get('/api/tags', (req, res) => {
    try { res.json({ tags: database.getDb().prepare('SELECT * FROM tags').all() }); }
    catch (e) { res.json({ tags: [] }); }
  });
  app.get('/api/close-reasons', (req, res) => {
    try { res.json({ reasons: database.getDb().prepare('SELECT * FROM close_reasons').all() }); }
    catch (e) { res.json({ reasons: [] }); }
  });
  app.get('/api/regions', (req, res) => {
    try { res.json({ regions: database.getDb().prepare('SELECT * FROM regions WHERE is_active = 1').all() }); }
    catch (e) { res.json({ regions: [] }); }
  });
  app.get('/api/users', (req, res) => {
    try { res.json({ users: database.getDb().prepare('SELECT id, name, email, role, avatar FROM users WHERE is_active = 1').all() }); }
    catch (e) { res.json({ users: [] }); }
  });
  app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: Date.now() }));

  // Error handler
  app.use((err, req, res, next) => {
    res.status(500).json({ error: 'Internal server error' });
  });

  // Start on random port
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        port,
        server,
        cleanup: () => {
          server.close();
          database.closeDb();
          try { fs.unlinkSync(testDbPath); } catch (e) {}
        },
      });
    });
  });
}

// ── Test Helpers ──────────────────────────────────────────────────────────────

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error((label ? label + ': ' : '') + 'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
  }
}

function assertIncludes(arr, item, label) {
  if (!Array.isArray(arr) || !arr.includes(item)) {
    throw new Error((label ? label + ': ' : '') + 'expected array to include ' + JSON.stringify(item));
  }
}

function assertOk(res, label) {
  if (res.status >= 400) {
    throw new Error((label ? label + ': ' : '') + 'expected success, got HTTP ' + res.status + ' — ' + JSON.stringify(res.data));
  }
}

async function test(name, fn) {
  try {
    await fn();
    return { name, passed: true };
  } catch (err) {
    return { name, passed: false, error: err.message };
  }
}

// Login helper — logs in and returns the authenticated client
async function loginAs(port, role) {
  const client = new TestClient(port);
  const user = TEST_USERS[role];
  const res = await client.post('/api/auth/login', { email: user.email, password: TEST_PASSWORD });
  if (res.status !== 200) throw new Error('Login failed for ' + role + ': ' + JSON.stringify(res.data));
  return client;
}

module.exports = {
  createTestServer,
  TestClient,
  TEST_PASSWORD,
  TEST_USERS,
  TEST_REGIONS,
  TEST_TAGS,
  assert,
  assertEqual,
  assertIncludes,
  assertOk,
  test,
  loginAs,
};
