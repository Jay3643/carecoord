const fs = require('fs');
const path = require('path');

console.log('Building chat system...\n');

// ═══════════════════════════════════════════════
// 1. DATABASE SCHEMA — add chat tables
// ═══════════════════════════════════════════════
let database = fs.readFileSync('server/database.js', 'utf8');

if (!database.includes('chat_channels')) {
  // Find the place where tables are created and add chat tables
  // Look for the last CREATE TABLE statement
  const chatTables = `
    // Chat tables
    r("CREATE TABLE IF NOT EXISTS chat_channels (id TEXT PRIMARY KEY, name TEXT, type TEXT DEFAULT 'direct', ticket_id TEXT, created_by TEXT, created_at INTEGER)");
    r("CREATE TABLE IF NOT EXISTS chat_members (channel_id TEXT, user_id TEXT, joined_at INTEGER, last_read_at INTEGER DEFAULT 0, PRIMARY KEY(channel_id, user_id))");
    r("CREATE TABLE IF NOT EXISTS chat_messages (id TEXT PRIMARY KEY, channel_id TEXT, user_id TEXT, body TEXT, type TEXT DEFAULT 'text', file_name TEXT, file_data TEXT, file_mime TEXT, created_at INTEGER)");
`;
  // Insert before saveDb or after the last CREATE TABLE
  database = database.replace(
    "saveDb();",
    chatTables + "\n    saveDb();"
  );
  fs.writeFileSync('server/database.js', database, 'utf8');
  console.log('  ✓ database.js — chat tables added');
} else {
  console.log('  ⊘ database.js — chat tables already exist');
}

// ═══════════════════════════════════════════════
// 2. CHAT ROUTES — server/routes/chat.js
// ═══════════════════════════════════════════════
const chatRoutes = `const express = require('express');
const { getDb, saveDb } = require('../database');
const { requireAuth, toStr } = require('../middleware');
const router = express.Router();

// List channels for current user
router.get('/channels', requireAuth, (req, res) => {
  const db = getDb();
  const channels = db.prepare(\`
    SELECT c.*, cm.last_read_at,
    (SELECT COUNT(*) FROM chat_messages m WHERE m.channel_id = c.id AND m.created_at > cm.last_read_at AND m.user_id != ?) as unread
    FROM chat_channels c
    JOIN chat_members cm ON cm.channel_id = c.id AND cm.user_id = ?
    ORDER BY (SELECT MAX(created_at) FROM chat_messages WHERE channel_id = c.id) DESC
  \`).all(req.user.id, req.user.id);

  // Enrich with member info and last message
  const result = channels.map(ch => {
    const members = db.prepare('SELECT u.id, u.name, u.avatar, u.email FROM chat_members cm JOIN users u ON u.id = cm.user_id WHERE cm.channel_id = ?').all(ch.id);
    const lastMsg = db.prepare('SELECT cm.*, u.name as sender_name FROM chat_messages cm JOIN users u ON u.id = cm.user_id WHERE cm.channel_id = ? ORDER BY cm.created_at DESC LIMIT 1').get(ch.id);
    let displayName = toStr(ch.name);
    if (toStr(ch.type) === 'direct') {
      const other = members.find(m => toStr(m.id) !== req.user.id);
      displayName = other ? toStr(other.name) : 'Direct Message';
    }
    return {
      id: toStr(ch.id), name: displayName, type: toStr(ch.type),
      ticketId: toStr(ch.ticket_id), unread: ch.unread || 0,
      members: members.map(m => ({ id: toStr(m.id), name: toStr(m.name), avatar: toStr(m.avatar), email: toStr(m.email) })),
      lastMessage: lastMsg ? { body: toStr(lastMsg.body), senderName: toStr(lastMsg.sender_name), createdAt: lastMsg.created_at, type: toStr(lastMsg.type) } : null,
    };
  });
  res.json({ channels: result });
});

// Create channel (direct or group)
router.post('/channels', requireAuth, (req, res) => {
  const db = getDb();
  const { name, type, memberIds, ticketId } = req.body;

  // For direct messages, check if channel already exists
  if (type === 'direct' && memberIds && memberIds.length === 1) {
    const otherId = memberIds[0];
    const existing = db.prepare(\`
      SELECT c.id FROM chat_channels c
      WHERE c.type = 'direct'
      AND EXISTS (SELECT 1 FROM chat_members WHERE channel_id = c.id AND user_id = ?)
      AND EXISTS (SELECT 1 FROM chat_members WHERE channel_id = c.id AND user_id = ?)
      AND (SELECT COUNT(*) FROM chat_members WHERE channel_id = c.id) = 2
    \`).get(req.user.id, otherId);
    if (existing) return res.json({ channelId: toStr(existing.id), existing: true });
  }

  const id = 'ch-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  db.prepare('INSERT INTO chat_channels (id, name, type, ticket_id, created_by, created_at) VALUES (?,?,?,?,?,?)')
    .run(id, name || null, type || 'group', ticketId || null, req.user.id, Date.now());

  // Add creator as member
  db.prepare('INSERT INTO chat_members (channel_id, user_id, joined_at, last_read_at) VALUES (?,?,?,?)').run(id, req.user.id, Date.now(), Date.now());

  // Add other members
  if (memberIds) {
    for (const mid of memberIds) {
      if (mid !== req.user.id) {
        db.prepare('INSERT OR IGNORE INTO chat_members (channel_id, user_id, joined_at, last_read_at) VALUES (?,?,?,0)').run(id, mid, Date.now());
      }
    }
  }
  saveDb();
  res.json({ channelId: id });
});

// Get messages for a channel
router.get('/channels/:id/messages', requireAuth, (req, res) => {
  const db = getDb();
  // Verify membership
  const member = db.prepare('SELECT 1 FROM chat_members WHERE channel_id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!member) return res.status(403).json({ error: 'Not a member' });

  const before = req.query.before ? parseInt(req.query.before) : Date.now() + 1;
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);

  const messages = db.prepare(\`
    SELECT cm.*, u.name as sender_name, u.avatar as sender_avatar
    FROM chat_messages cm JOIN users u ON u.id = cm.user_id
    WHERE cm.channel_id = ? AND cm.created_at < ?
    ORDER BY cm.created_at DESC LIMIT ?
  \`).all(req.params.id, before, limit);

  res.json({ messages: messages.reverse().map(m => ({
    id: toStr(m.id), channelId: toStr(m.channel_id), userId: toStr(m.user_id),
    body: toStr(m.body), type: toStr(m.type),
    fileName: toStr(m.file_name), fileMime: toStr(m.file_mime),
    fileData: m.type === 'file' ? toStr(m.file_data) : undefined,
    senderName: toStr(m.sender_name), senderAvatar: toStr(m.sender_avatar),
    createdAt: m.created_at,
  }))});
});

// Send message
router.post('/channels/:id/messages', requireAuth, (req, res) => {
  const db = getDb();
  const member = db.prepare('SELECT 1 FROM chat_members WHERE channel_id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!member) return res.status(403).json({ error: 'Not a member' });

  const { body: msgBody, type, fileName, fileData, fileMime } = req.body;
  if (!msgBody && !fileData) return res.status(400).json({ error: 'Message body required' });

  const id = 'cm-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  const now = Date.now();

  db.prepare('INSERT INTO chat_messages (id, channel_id, user_id, body, type, file_name, file_data, file_mime, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, req.params.id, req.user.id, msgBody || fileName || '', type || 'text', fileName || null, fileData || null, fileMime || null, now);

  // Update sender's last_read_at
  db.prepare('UPDATE chat_members SET last_read_at = ? WHERE channel_id = ? AND user_id = ?').run(now, req.params.id, req.user.id);
  saveDb();

  const user = db.prepare('SELECT name, avatar FROM users WHERE id = ?').get(req.user.id);
  const message = {
    id, channelId: req.params.id, userId: req.user.id,
    body: msgBody || fileName || '', type: type || 'text',
    fileName: fileName || null, fileMime: fileMime || null,
    senderName: toStr(user.name), senderAvatar: toStr(user.avatar),
    createdAt: now,
  };

  // Emit via socket.io if available
  if (req.app.io) {
    req.app.io.to('channel:' + req.params.id).emit('chat:message', message);
  }

  res.json(message);
});

// Mark channel as read
router.post('/channels/:id/read', requireAuth, (req, res) => {
  getDb().prepare('UPDATE chat_members SET last_read_at = ? WHERE channel_id = ? AND user_id = ?').run(Date.now(), req.params.id, req.user.id);
  saveDb();
  res.json({ ok: true });
});

// Get or create ticket discussion channel
router.post('/ticket-channel', requireAuth, (req, res) => {
  const db = getDb();
  const { ticketId } = req.body;
  if (!ticketId) return res.status(400).json({ error: 'ticketId required' });

  // Check if channel exists for this ticket
  const existing = db.prepare("SELECT id FROM chat_channels WHERE ticket_id = ? AND type = 'ticket'").get(ticketId);
  if (existing) return res.json({ channelId: toStr(existing.id), existing: true });

  // Create ticket discussion channel
  const ticket = db.prepare('SELECT subject, assignee_user_id FROM tickets WHERE id = ?').get(ticketId);
  const id = 'ch-tk-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  db.prepare('INSERT INTO chat_channels (id, name, type, ticket_id, created_by, created_at) VALUES (?,?,?,?,?,?)')
    .run(id, ticket ? toStr(ticket.subject) : 'Ticket Discussion', 'ticket', ticketId, req.user.id, Date.now());

  // Add all active users as members (they can see ticket discussions)
  const users = db.prepare('SELECT id FROM users WHERE is_active = 1').all();
  for (const u of users) {
    db.prepare('INSERT OR IGNORE INTO chat_members (channel_id, user_id, joined_at, last_read_at) VALUES (?,?,?,0)').run(id, toStr(u.id), Date.now());
  }
  saveDb();
  res.json({ channelId: id });
});

// Total unread count across all channels
router.get('/unread', requireAuth, (req, res) => {
  const db = getDb();
  const result = db.prepare(\`
    SELECT COALESCE(SUM(sub.cnt), 0) as total FROM (
      SELECT COUNT(*) as cnt FROM chat_messages m
      JOIN chat_members cm ON cm.channel_id = m.channel_id AND cm.user_id = ?
      WHERE m.created_at > cm.last_read_at AND m.user_id != ?
    ) sub
  \`).get(req.user.id, req.user.id);
  res.json({ unread: result ? result.total : 0 });
});

module.exports = router;
`;

fs.writeFileSync('server/routes/chat.js', chatRoutes, 'utf8');
console.log('  ✓ server/routes/chat.js — full chat API');

// ═══════════════════════════════════════════════
// 3. INDEX.JS — add socket.io + chat routes
// ═══════════════════════════════════════════════
let index = fs.readFileSync('server/index.js', 'utf8');

if (!index.includes('socket.io')) {
  // Add http server + socket.io
  index = index.replace(
    "const app = express();",
    "const http = require('http');\nconst { Server } = require('socket.io');\nconst app = express();\nconst server = http.createServer(app);\nconst io = new Server(server, { cors: { origin: ['http://localhost:5173', 'http://localhost:3000', 'https://carecoord-o3en.onrender.com'], credentials: true } });\napp.io = io;"
  );

  // Add chat routes
  index = index.replace(
    "app.use('/api/gmail', require('./routes/gmail'));",
    "app.use('/api/gmail', require('./routes/gmail'));\napp.use('/api/chat', require('./routes/chat'));"
  );

  // Add socket.io connection handler before initDb
  index = index.replace(
    "initDb().then(() => {",
    `// Socket.io
io.on('connection', (socket) => {
  socket.on('join', (channelId) => { socket.join('channel:' + channelId); });
  socket.on('leave', (channelId) => { socket.leave('channel:' + channelId); });
  socket.on('typing', (data) => { socket.to('channel:' + data.channelId).emit('chat:typing', { userId: data.userId, name: data.name }); });
  socket.on('stop-typing', (data) => { socket.to('channel:' + data.channelId).emit('chat:stop-typing', { userId: data.userId }); });
});

initDb().then(() => {`
  );

  // Change app.listen to server.listen
  index = index.replace(
    "app.listen(PORT, () => {",
    "server.listen(PORT, () => {"
  );

  fs.writeFileSync('server/index.js', index, 'utf8');
  console.log('  ✓ server/index.js — socket.io + chat routes added');
} else {
  console.log('  ⊘ server/index.js — socket.io already present');
}

// ═══════════════════════════════════════════════
// 4. API.JS — add chat API methods
// ═══════════════════════════════════════════════
let api = fs.readFileSync('client/src/api.js', 'utf8');

if (!api.includes('chatChannels')) {
  api = api.replace(
    'gmailStatus:',
    `chatChannels: () => request('/chat/channels'),
  chatCreateChannel: (data) => request('/chat/channels', { method: 'POST', body: JSON.stringify(data) }),
  chatMessages: (channelId, before) => request('/chat/channels/' + channelId + '/messages' + (before ? '?before=' + before : '')),
  chatSend: (channelId, data) => request('/chat/channels/' + channelId + '/messages', { method: 'POST', body: JSON.stringify(data) }),
  chatMarkRead: (channelId) => request('/chat/channels/' + channelId + '/read', { method: 'POST' }),
  chatUnread: () => request('/chat/unread'),
  chatTicketChannel: (ticketId) => request('/chat/ticket-channel', { method: 'POST', body: JSON.stringify({ ticketId }) }),
  gmailStatus:`
  );
  fs.writeFileSync('client/src/api.js', api, 'utf8');
  console.log('  ✓ client/src/api.js — chat methods added');
}

// ═══════════════════════════════════════════════
// 5. CHAT COMPONENT — client/src/components/ChatScreen.jsx
// ═══════════════════════════════════════════════
const chatComponent = `import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api';
import { Avatar } from './ui';
import io from 'socket.io-client';

const socket = io(window.location.origin, { transports: ['websocket', 'polling'] });

function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export default function ChatScreen({ currentUser, allUsers, showToast }) {
  const [channels, setChannels] = useState([]);
  const [activeChannel, setActiveChannel] = useState(null);
  const [messages, setMessages] = useState([]);
  const [msgText, setMsgText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [newType, setNewType] = useState('direct');
  const [newName, setNewName] = useState('');
  const [selectedMembers, setSelectedMembers] = useState([]);
  const [typingUsers, setTypingUsers] = useState([]);
  const [searchUser, setSearchUser] = useState('');
  const messagesEndRef = useRef(null);
  const typingTimer = useRef(null);
  const fileRef = useRef(null);

  const loadChannels = useCallback(() => {
    api.chatChannels().then(d => { setChannels(d.channels || []); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  useEffect(() => { loadChannels(); }, []);

  useEffect(() => {
    if (!activeChannel) return;
    socket.emit('join', activeChannel.id);
    api.chatMessages(activeChannel.id).then(d => setMessages(d.messages || []));
    api.chatMarkRead(activeChannel.id);

    const onMsg = (msg) => {
      if (msg.channelId === activeChannel.id) {
        setMessages(prev => [...prev, msg]);
        api.chatMarkRead(activeChannel.id);
      }
      loadChannels();
    };
    const onTyping = (data) => {
      if (data.userId !== currentUser.id) setTypingUsers(prev => prev.includes(data.name) ? prev : [...prev, data.name]);
    };
    const onStopTyping = (data) => {
      setTypingUsers(prev => prev.filter(n => n !== data.name));
    };

    socket.on('chat:message', onMsg);
    socket.on('chat:typing', onTyping);
    socket.on('chat:stop-typing', onStopTyping);

    return () => {
      socket.emit('leave', activeChannel.id);
      socket.off('chat:message', onMsg);
      socket.off('chat:typing', onTyping);
      socket.off('chat:stop-typing', onStopTyping);
    };
  }, [activeChannel?.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!msgText.trim() || !activeChannel) return;
    setSending(true);
    try {
      await api.chatSend(activeChannel.id, { body: msgText, type: 'text' });
      setMsgText('');
      socket.emit('stop-typing', { channelId: activeChannel.id, userId: currentUser.id });
    } catch(e) { showToast?.(e.message); }
    setSending(false);
  };

  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file || !activeChannel) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result.split(',')[1];
      try {
        await api.chatSend(activeChannel.id, { body: file.name, type: 'file', fileName: file.name, fileData: base64, fileMime: file.type });
      } catch(e) { showToast?.(e.message); }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleTyping = () => {
    socket.emit('typing', { channelId: activeChannel.id, userId: currentUser.id, name: currentUser.name });
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      socket.emit('stop-typing', { channelId: activeChannel.id, userId: currentUser.id });
    }, 2000);
  };

  const createChannel = async () => {
    if (selectedMembers.length === 0) return;
    try {
      const d = await api.chatCreateChannel({
        type: selectedMembers.length === 1 ? 'direct' : 'group',
        name: selectedMembers.length > 1 ? newName || selectedMembers.map(id => allUsers.find(u => u.id === id)?.name).join(', ') : null,
        memberIds: selectedMembers,
      });
      loadChannels();
      setShowNew(false);
      setSelectedMembers([]);
      setNewName('');
      // Open the new channel
      setTimeout(() => {
        api.chatChannels().then(data => {
          const ch = (data.channels || []).find(c => c.id === d.channelId);
          if (ch) setActiveChannel(ch);
        });
      }, 200);
    } catch(e) { showToast?.(e.message); }
  };

  const otherUsers = (allUsers || []).filter(u => u.id !== currentUser.id);
  const filteredUsers = searchUser ? otherUsers.filter(u => u.name.toLowerCase().includes(searchUser.toLowerCase()) || u.email.toLowerCase().includes(searchUser.toLowerCase())) : otherUsers;

  const css = \`.chat-msg:hover{background:#f5f7fa}.chat-ch:hover{background:#e8edf3}\`;

  return (
    <div style={{ display: 'flex', height: '100%', background: '#fff', fontFamily: "'IBM Plex Sans', -apple-system, sans-serif" }}>
      <style>{css}</style>

      {/* Channel List */}
      <div style={{ width: 300, borderRight: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', background: '#f8fafc' }}>
        <div style={{ padding: '16px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: '#1e3a4f' }}>Messages</span>
          <button onClick={() => setShowNew(true)} style={{ background: '#1a5e9a', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>+ New</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {channels.map(ch => (
            <div key={ch.id} className="chat-ch" onClick={() => { setActiveChannel(ch); setTypingUsers([]); }}
              style={{ padding: '12px 16px', cursor: 'pointer', borderBottom: '1px solid #f1f5f9',
                background: activeChannel?.id === ch.id ? '#e0ecf7' : 'transparent' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {ch.type === 'direct' && ch.members.length > 0 && (
                  <Avatar user={ch.members.find(m => m.id !== currentUser.id) || ch.members[0]} size={36} />
                )}
                {ch.type !== 'direct' && (
                  <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#1a5e9a', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 14, fontWeight: 600 }}>
                    {ch.members.length}
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 14, fontWeight: ch.unread > 0 ? 700 : 500, color: '#1e3a4f', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ch.name}</span>
                    {ch.unread > 0 && <span style={{ background: '#d94040', color: '#fff', fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 99, flexShrink: 0 }}>{ch.unread}</span>}
                  </div>
                  {ch.lastMessage && (
                    <div style={{ fontSize: 12, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
                      {ch.lastMessage.senderName}: {ch.lastMessage.type === 'file' ? '📎 ' + ch.lastMessage.body : ch.lastMessage.body}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
          {!loading && channels.length === 0 && (
            <div style={{ padding: 32, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>No conversations yet</div>
          )}
        </div>
      </div>

      {/* Chat Area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {!activeChannel && !showNew ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>
            <div style={{ textAlign: 'center' }}>
              <svg width="64" height="64" viewBox="0 0 24 24" fill="#cbd5e1"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>
              <p style={{ marginTop: 12, fontSize: 14 }}>Select a conversation or start a new one</p>
            </div>
          </div>
        ) : showNew ? (
          <div style={{ flex: 1, padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1e3a4f', margin: 0 }}>New Conversation</h2>
              <button onClick={() => { setShowNew(false); setSelectedMembers([]); setNewName(''); }} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#64748b' }}>✕</button>
            </div>

            {selectedMembers.length > 1 && (
              <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Group name (optional)"
                style={{ width: '100%', padding: '10px 14px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 14, marginBottom: 16, outline: 'none' }} />
            )}

            <input value={searchUser} onChange={e => setSearchUser(e.target.value)} placeholder="Search people..."
              style={{ width: '100%', padding: '10px 14px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 14, marginBottom: 12, outline: 'none' }} />

            {selectedMembers.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                {selectedMembers.map(id => {
                  const u = allUsers.find(u => u.id === id);
                  return u ? (
                    <span key={id} onClick={() => setSelectedMembers(prev => prev.filter(x => x !== id))}
                      style={{ background: '#e0ecf7', color: '#1e3a4f', padding: '4px 10px', borderRadius: 16, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                      {u.name} ✕
                    </span>
                  ) : null;
                })}
              </div>
            )}

            <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 8 }}>
              {filteredUsers.map(u => (
                <div key={u.id} onClick={() => setSelectedMembers(prev => prev.includes(u.id) ? prev.filter(x => x !== u.id) : [...prev, u.id])}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer', background: selectedMembers.includes(u.id) ? '#e0ecf7' : '#fff', borderBottom: '1px solid #f1f5f9' }}>
                  <Avatar user={u} size={32} />
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{u.name}</div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>{u.email}</div>
                  </div>
                  {selectedMembers.includes(u.id) && <span style={{ marginLeft: 'auto', color: '#1a5e9a', fontWeight: 700 }}>✓</span>}
                </div>
              ))}
            </div>

            <button onClick={createChannel} disabled={selectedMembers.length === 0}
              style={{ marginTop: 16, padding: '10px 24px', background: selectedMembers.length ? '#1a5e9a' : '#cbd5e1', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: selectedMembers.length ? 'pointer' : 'default' }}>
              Start Conversation
            </button>
          </div>
        ) : (
          <>
            {/* Header */}
            <div style={{ padding: '12px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 10, background: '#fafbfc' }}>
              <button onClick={() => setActiveChannel(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: 18, padding: 4, display: 'none' }}>←</button>
              <span style={{ fontSize: 16, fontWeight: 700, color: '#1e3a4f' }}>{activeChannel.name}</span>
              <span style={{ fontSize: 12, color: '#94a3b8', marginLeft: 8 }}>{activeChannel.members.length} members</span>
            </div>

            {/* Messages */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
              {messages.map((m, i) => {
                const isMe = m.userId === currentUser.id;
                const showAvatar = i === 0 || messages[i-1]?.userId !== m.userId;
                return (
                  <div key={m.id} className="chat-msg" style={{ display: 'flex', gap: 10, marginBottom: showAvatar ? 12 : 2, padding: '2px 4px', borderRadius: 8 }}>
                    <div style={{ width: 32, flexShrink: 0 }}>
                      {showAvatar && <Avatar user={{ name: m.senderName, avatar: m.senderAvatar }} size={32} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {showAvatar && (
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2 }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: isMe ? '#1a5e9a' : '#1e3a4f' }}>{m.senderName}</span>
                          <span style={{ fontSize: 11, color: '#94a3b8' }}>{fmtTime(m.createdAt)}</span>
                        </div>
                      )}
                      {m.type === 'file' ? (
                        <a href={'data:' + (m.fileMime || 'application/octet-stream') + ';base64,' + (m.fileData || '')} download={m.fileName || m.body}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: '#f1f5f9', borderRadius: 8, fontSize: 13, color: '#1a5e9a', textDecoration: 'none' }}>
                          📎 {m.body || m.fileName}
                        </a>
                      ) : (
                        <div style={{ fontSize: 14, color: '#334155', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.body}</div>
                      )}
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Typing indicator */}
            {typingUsers.length > 0 && (
              <div style={{ padding: '4px 20px', fontSize: 12, color: '#64748b', fontStyle: 'italic' }}>
                {typingUsers.join(', ')} {typingUsers.length === 1 ? 'is' : 'are'} typing...
              </div>
            )}

            {/* Input */}
            <div style={{ padding: '12px 20px', borderTop: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 8, background: '#fafbfc' }}>
              <input type="file" ref={fileRef} onChange={handleFile} style={{ display: 'none' }} />
              <button onClick={() => fileRef.current?.click()} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, padding: 4, color: '#64748b' }} title="Attach file">📎</button>
              <input value={msgText} onChange={e => { setMsgText(e.target.value); handleTyping(); }}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                placeholder="Type a message..."
                style={{ flex: 1, padding: '10px 14px', border: '1px solid #e2e8f0', borderRadius: 24, fontSize: 14, outline: 'none', background: '#fff' }} />
              <button onClick={handleSend} disabled={sending || !msgText.trim()}
                style={{ background: msgText.trim() ? '#1a5e9a' : '#cbd5e1', color: '#fff', border: 'none', borderRadius: '50%', width: 36, height: 36, cursor: msgText.trim() ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
`;

fs.writeFileSync('client/src/components/ChatScreen.jsx', chatComponent, 'utf8');
console.log('  ✓ client/src/components/ChatScreen.jsx — full chat UI');

// ═══════════════════════════════════════════════
// 6. APP.JSX — add Chat to sidebar
// ═══════════════════════════════════════════════
let appJsx = fs.readFileSync('client/src/App.jsx', 'utf8');

if (!appJsx.includes('ChatScreen')) {
  // Add import
  appJsx = appJsx.replace(
    "import PersonalInbox from './components/PersonalInbox';",
    "import PersonalInbox from './components/PersonalInbox';\nimport ChatScreen from './components/ChatScreen';"
  );

  // Add chat unread count state
  appJsx = appJsx.replace(
    "const [unassignedCount, setUnassignedCount] = useState(0);",
    "const [unassignedCount, setUnassignedCount] = useState(0);\n  const [chatUnread, setChatUnread] = useState(0);"
  );

  // Fetch chat unread in the polling interval
  appJsx = appJsx.replace(
    "api.getTickets({ queue: 'personal', status: 'all' })\n        .then(d => setPersonalCount(d.tickets.filter(t => t.status !== 'CLOSED').length))\n        .catch(() => {});",
    "api.getTickets({ queue: 'personal', status: 'all' })\n        .then(d => setPersonalCount(d.tickets.filter(t => t.status !== 'CLOSED').length))\n        .catch(() => {});\n      api.chatUnread().then(d => setChatUnread(d.unread || 0)).catch(() => {});"
  );

  // Add Chat nav item after Email
  appJsx = appJsx.replace(
    "{ key: 'personalEmail', icon: 'mail', label: 'Email' },",
    "{ key: 'personalEmail', icon: 'mail', label: 'Email' },\n            { key: 'chat', icon: 'send', label: 'Chat', badge: chatUnread, badgeColor: '#1a5e9a' },"
  );

  // Add Chat screen render
  appJsx = appJsx.replace(
    "{screen === 'personalEmail' && (",
    "{screen === 'chat' && (\n          <ChatScreen currentUser={currentUser} allUsers={allUsers} showToast={showToast} />\n        )}\n        {screen === 'personalEmail' && ("
  );

  fs.writeFileSync('client/src/App.jsx', appJsx, 'utf8');
  console.log('  ✓ client/src/App.jsx — Chat added to sidebar');
} else {
  console.log('  ⊘ App.jsx — Chat already present');
}

console.log('\n✅ Chat system complete!');
console.log('   Features: 1-on-1 DMs, group chats, real-time via socket.io');
console.log('   Typing indicators, file sharing, unread badges');
console.log('   Ticket discussion channels');
console.log('\nPush and redeploy.');
