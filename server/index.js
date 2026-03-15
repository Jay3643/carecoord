require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const { initDb, closeDb } = require('./database');
const http = require('http');
const { Server } = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: ['http://localhost:5173', 'http://localhost:3000', 'https://carecoord-o3en.onrender.com'], credentials: true } });
app.io = io;
const PORT = process.env.PORT || 3001;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'],
  credentials: true,
}));
app.use(express.json({ limit: '25mb' }));
app.use(cookieParser());
app.use(morgan('dev'));
app.use(session({
  secret: process.env.SESSION_SECRET || 'carecoord-dev-secret-change-in-production',
  resave: false, saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, maxAge: 24 * 60 * 60 * 1000, sameSite: 'lax' },
}));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/tickets', require('./routes/tickets'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/ref', require('./routes/ref'));
app.use('/api/audit', require('./routes/audit'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/gmail', require('./routes/gmail'));
app.use('/api/chat', require('./routes/chat'));

// Convenience routes (some components call /api/tags directly)
app.get('/api/tags', (req, res) => {
  try { const { getDb } = require('./database'); res.json({ tags: getDb().prepare('SELECT * FROM tags').all() }); }
  catch(e) { res.json({ tags: [] }); }
});
app.get('/api/close-reasons', (req, res) => {
  try { const { getDb } = require('./database'); res.json({ reasons: getDb().prepare('SELECT * FROM close_reasons').all() }); }
  catch(e) { res.json({ reasons: [] }); }
});
app.get('/api/regions', (req, res) => {
  try { const { getDb } = require('./database'); res.json({ regions: getDb().prepare('SELECT * FROM regions WHERE is_active = 1').all() }); }
  catch(e) { res.json({ regions: [] }); }
});
app.get('/api/users', (req, res) => {
  const regionId = req.query.regionId;
  if (regionId) {
    try {
      const { getDb } = require('./database');
      const users = getDb().prepare('SELECT u.id, u.name, u.email, u.role, u.avatar FROM users u JOIN user_regions ur ON ur.user_id = u.id WHERE ur.region_id = ? AND u.is_active = 1').all(regionId);
      return res.json({ users });
    } catch(e) { return res.json({ users: [] }); }
  }
  try { const { getDb } = require('./database'); res.json({ users: getDb().prepare('SELECT id, name, email, role, avatar FROM users WHERE is_active = 1').all() }); }
  catch(e) { res.json({ users: [] }); }
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: Date.now() }));

const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) res.sendFile(path.join(clientDist, 'index.html'));
});

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Socket.io
io.on('connection', (socket) => {
  socket.on('join', (channelId) => { socket.join('channel:' + channelId); });
  socket.on('leave', (channelId) => { socket.leave('channel:' + channelId); });
  socket.on('typing', (data) => { socket.to('channel:' + data.channelId).emit('chat:typing', { userId: data.userId, name: data.name }); });
  socket.on('stop-typing', (data) => { socket.to('channel:' + data.channelId).emit('chat:stop-typing', { userId: data.userId }); });
});

initDb().then(() => {
  // Migrate: ensure chat tables exist
  try {
    const { getDb, saveDb } = require('./database');
    const db = getDb();
    db.exec("CREATE TABLE IF NOT EXISTS chat_channels (id TEXT PRIMARY KEY, name TEXT, type TEXT DEFAULT 'direct', ticket_id TEXT, created_by TEXT, created_at INTEGER)");
    db.exec("CREATE TABLE IF NOT EXISTS chat_members (channel_id TEXT, user_id TEXT, joined_at INTEGER, last_read_at INTEGER DEFAULT 0, PRIMARY KEY(channel_id, user_id))");
    db.exec("CREATE TABLE IF NOT EXISTS chat_messages (id TEXT PRIMARY KEY, channel_id TEXT, user_id TEXT, body TEXT, type TEXT DEFAULT 'text', file_name TEXT, file_data TEXT, file_mime TEXT, created_at INTEGER)");
    saveDb();
    console.log('[DB] Chat tables ready');
  } catch(e) { console.log('[DB] Chat migration:', e.message); }
  // Migrate: add work_status column to users
  try {
    const { getDb: gDb, saveDb: sDb } = require('./database');
    const db2 = gDb();
    try { db2.exec("ALTER TABLE users ADD COLUMN work_status TEXT DEFAULT 'active'"); sDb(); console.log('[DB] Added work_status column'); }
    catch(e) { /* column already exists */ }
  } catch(e) { console.log('[DB] work_status migration:', e.message); }
  server.listen(PORT, () => {
    console.log('\n🏥 CareCoord server running on http://localhost:' + PORT);
    console.log('   API: http://localhost:' + PORT + '/api/health\n');
  });
}).catch(err => { console.error('Failed to init DB:', err); process.exit(1); });

process.on('SIGINT', () => { closeDb(); process.exit(0); });
