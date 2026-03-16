const express = require('express');
const { getDb, saveDb } = require('../database');
const { requireAuth, toStr } = require('../middleware');
const router = express.Router();

// List channels for current user
router.get('/channels', requireAuth, (req, res) => {
  const db = getDb();
  const channels = db.prepare(`
    SELECT c.*, cm.last_read_at,
    (SELECT COUNT(*) FROM chat_messages m WHERE m.channel_id = c.id AND m.created_at > cm.last_read_at AND m.user_id != ?) as unread
    FROM chat_channels c
    JOIN chat_members cm ON cm.channel_id = c.id AND cm.user_id = ?
    ORDER BY COALESCE((SELECT MAX(created_at) FROM chat_messages WHERE channel_id = c.id), c.created_at) DESC
  `).all(req.user.id, req.user.id);

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

  // For direct messages, check if channel already exists between these two users
  if (type === 'direct' && memberIds && memberIds.length === 1) {
    const otherId = memberIds[0];
    const existing = db.prepare(`
      SELECT c.id FROM chat_channels c
      WHERE c.type = 'direct'
      AND EXISTS (SELECT 1 FROM chat_members WHERE channel_id = c.id AND user_id = ?)
      AND EXISTS (SELECT 1 FROM chat_members WHERE channel_id = c.id AND user_id = ?)
      AND (SELECT COUNT(*) FROM chat_members WHERE channel_id = c.id) = 2
    `).get(req.user.id, otherId);
    if (existing) return res.json({ channelId: toStr(existing.id), existing: true });
  }

  // For group chats, check if a group with the exact same members already exists
  if (type === 'group' && memberIds && memberIds.length > 1) {
    const allMembers = [req.user.id, ...memberIds].sort();
    const memberCount = allMembers.length;
    // Find channels where the current user is a member and member count matches
    const candidates = db.prepare(`
      SELECT c.id FROM chat_channels c
      WHERE c.type = 'group'
      AND (SELECT COUNT(*) FROM chat_members WHERE channel_id = c.id) = ?
      AND EXISTS (SELECT 1 FROM chat_members WHERE channel_id = c.id AND user_id = ?)
    `).all(memberCount, req.user.id);
    
    for (const cand of candidates) {
      const members = db.prepare('SELECT user_id FROM chat_members WHERE channel_id = ? ORDER BY user_id').all(toStr(cand.id));
      const candMembers = members.map(m => toStr(m.user_id)).sort();
      if (JSON.stringify(candMembers) === JSON.stringify(allMembers)) {
        return res.json({ channelId: toStr(cand.id), existing: true });
      }
    }
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

  const messages = db.prepare(`
    SELECT cm.*, u.name as sender_name, u.avatar as sender_avatar
    FROM chat_messages cm JOIN users u ON u.id = cm.user_id
    WHERE cm.channel_id = ? AND cm.created_at < ?
    ORDER BY cm.created_at ASC LIMIT ?
  `).all(req.params.id, before, limit);

  res.json({ messages: messages.map(m => ({
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

// Hide/leave a chat channel for the current user (removes them from members)
// The channel is only fully deleted when no members remain.
router.delete('/channels/:id', requireAuth, (req, res) => {
  const db = getDb();
  const channel = db.prepare('SELECT * FROM chat_channels WHERE id = ?').get(req.params.id);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });

  const isMember = db.prepare('SELECT 1 FROM chat_members WHERE channel_id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!isMember) return res.status(403).json({ error: 'Not a member of this channel' });

  // Remove the user from the channel (hides it for them)
  db.prepare('DELETE FROM chat_members WHERE channel_id = ? AND user_id = ?').run(req.params.id, req.user.id);

  // If no members remain, clean up the channel and its messages entirely
  const remaining = db.prepare('SELECT COUNT(*) as cnt FROM chat_members WHERE channel_id = ?').get(req.params.id);
  if (remaining.cnt === 0) {
    db.prepare('DELETE FROM chat_messages WHERE channel_id = ?').run(req.params.id);
    db.prepare('DELETE FROM chat_channels WHERE id = ?').run(req.params.id);
  }
  saveDb();

  res.json({ ok: true });
});

// Delete a single message (only sender, admin, or supervisor can delete)
router.delete('/channels/:channelId/messages/:msgId', requireAuth, (req, res) => {
  const db = getDb();
  const msg = db.prepare('SELECT * FROM chat_messages WHERE id = ? AND channel_id = ?').get(req.params.msgId, req.params.channelId);
  if (!msg) return res.status(404).json({ error: 'Message not found' });

  const isSender = toStr(msg.user_id) === req.user.id;
  const isAdminOrSup = req.user.role === 'admin' || req.user.role === 'supervisor';
  if (!isSender && !isAdminOrSup) return res.status(403).json({ error: 'Not authorized' });

  db.prepare('DELETE FROM chat_messages WHERE id = ?').run(req.params.msgId);
  saveDb();

  if (req.app.io) req.app.io.to('channel:' + req.params.channelId).emit('chat:msg-deleted', { channelId: req.params.channelId, messageId: req.params.msgId });

  res.json({ ok: true });
});

// Total unread count across all channels
router.get('/unread', requireAuth, (req, res) => {
  const db = getDb();
  const result = db.prepare(`
    SELECT COALESCE(SUM(sub.cnt), 0) as total FROM (
      SELECT COUNT(*) as cnt FROM chat_messages m
      JOIN chat_members cm ON cm.channel_id = m.channel_id AND cm.user_id = ?
      WHERE m.created_at > cm.last_read_at AND m.user_id != ?
    ) sub
  `).get(req.user.id, req.user.id);
  res.json({ unread: result ? result.total : 0 });
});

module.exports = router;
