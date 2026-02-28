const express = require('express');
const { v4: uuid } = require('uuid');
const { getDb, saveDb } = require('../database');
const { requireAuth, requireSupervisor, addAudit } = require('../middleware');
const router = express.Router();

function enrichTicket(db, ticket) {
  if (!ticket) return null;
  ticket.external_participants = JSON.parse(ticket.external_participants || '[]');
  const tags = db.prepare('SELECT t.* FROM tags t JOIN ticket_tags tt ON tt.tag_id = t.id WHERE tt.ticket_id = ?').all(ticket.id);
  ticket.tags = tags;
  ticket.tagIds = tags.map(t => t.id);
  if (ticket.assignee_user_id)
    ticket.assignee = db.prepare('SELECT id, name, email, role, avatar FROM users WHERE id = ?').get(ticket.assignee_user_id);
  ticket.region = db.prepare('SELECT id, name FROM regions WHERE id = ?').get(ticket.region_id);
  return ticket;
}


router.post('/', requireAuth, (req, res) => {
  const db = getDb();
  const { toEmail, subject, body, regionId, tagIds } = req.body;
  if (!toEmail?.trim() || !subject?.trim() || !body?.trim() || !regionId) {
    return res.status(400).json({ error: 'toEmail, subject, body, and regionId are required' });
  }

  const region = db.prepare('SELECT * FROM regions WHERE id = ?').get(regionId);
  if (!region) return res.status(404).json({ error: 'Region not found' });

  const ticketId = 'tk-' + uuid().split('-')[0];
  const msgId = uuid();
  const now = Date.now();
  const aliases = JSON.parse(region.routing_aliases || '[]');
  const fromAddr = aliases[0] || 'intake@carecoord.org';
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const fullBody = body + '\n\n—\n' + user.name + '\nCare Coordinator — ' + region.name + '\n' + user.email;
  const providerMsgId = 'msg-int-' + now;

  // Create ticket
  db.prepare('INSERT INTO tickets (id, region_id, status, assignee_user_id, subject, external_participants, last_activity_at, created_at, has_unread) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)')
    .run(ticketId, regionId, 'WAITING_ON_EXTERNAL', req.user.id, subject, JSON.stringify([toEmail.trim()]), now, now);

  // Create initial outbound message
  db.prepare('INSERT INTO messages (id, ticket_id, direction, channel, from_address, to_addresses, subject, body_text, sent_at, provider_message_id, in_reply_to, reference_ids, created_by_user_id, created_at) VALUES (?, ?, \'outbound\', \'email\', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(msgId, ticketId, fromAddr, JSON.stringify([toEmail.trim()]), subject, fullBody, now, providerMsgId, null, '[]', req.user.id, now);

  // Add tags if provided
  if (tagIds && tagIds.length > 0) {
    const insTag = db.prepare('INSERT OR IGNORE INTO ticket_tags (ticket_id, tag_id) VALUES (?, ?)');
    tagIds.forEach(tagId => insTag.run(ticketId, tagId));
  }

  saveDb();

  addAudit(db, req.user.id, 'ticket_created', 'ticket', ticketId, 'Outbound ticket created: ' + subject);
  addAudit(db, req.user.id, 'outbound_sent', 'message', msgId, 'Initial message sent to ' + toEmail.trim());

  const ticket = enrichTicket(db, db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId));
  res.json({ ticket });
});

router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const { queue, region, status, search } = req.query;
  let where = [], params = [];
  if (queue === 'personal') { where.push('t.assignee_user_id = ?'); params.push(req.user.id); }
  else { const ph = req.user.regionIds.map(() => '?').join(','); where.push('t.region_id IN (' + ph + ')'); params.push(...req.user.regionIds); }
  if (region && region !== 'all') { where.push('t.region_id = ?'); params.push(region); }
  if (status === 'unassigned') { where.push("t.assignee_user_id IS NULL AND t.status != ?"); params.push('CLOSED'); }
  else if (status === 'open') where.push("t.status = 'OPEN'");
  else if (status === 'waiting') where.push("t.status = 'WAITING_ON_EXTERNAL'");
  else if (status === 'closed') where.push("t.status = 'CLOSED'");
  else where.push("t.status != 'CLOSED'");
  if (search) { where.push('(t.subject LIKE ? OR t.external_participants LIKE ? OR t.id LIKE ?)'); const q = '%' + search + '%'; params.push(q, q, q); }
  const wc = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const tickets = db.prepare('SELECT t.* FROM tickets t ' + wc + ' ORDER BY t.last_activity_at DESC').all(...params);
  res.json({ tickets: tickets.map(t => enrichTicket(db, t)) });
});

router.get('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Not found' });
  res.json({ ticket: enrichTicket(db, ticket) });
});

router.get('/:id/messages', requireAuth, (req, res) => {
  const db = getDb();
  const messages = db.prepare('SELECT * FROM messages WHERE ticket_id = ? ORDER BY sent_at ASC').all(req.params.id);
  messages.forEach(m => {
    m.to_addresses = JSON.parse(m.to_addresses || '[]');
    m.cc_addresses = JSON.parse(m.cc_addresses || '[]');
    m.reference_ids = JSON.parse(m.reference_ids || '[]');
    if (m.created_by_user_id) m.sender = db.prepare('SELECT id, name, email, avatar FROM users WHERE id = ?').get(m.created_by_user_id);
  });
  res.json({ messages });
});

router.get('/:id/notes', requireAuth, (req, res) => {
  const db = getDb();
  const notes = db.prepare('SELECT n.*, u.name as author_name, u.avatar as author_avatar FROM notes n JOIN users u ON u.id = n.author_user_id WHERE n.ticket_id = ? ORDER BY n.created_at ASC').all(req.params.id);
  res.json({ notes });
});

router.post('/:id/assign', requireAuth, (req, res) => {
  const db = getDb();
  const { userId } = req.body;
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Not found' });
  if (req.user.role === 'coordinator' && userId && userId !== req.user.id)
    return res.status(403).json({ error: 'Coordinators can only assign to themselves' });
  db.prepare('UPDATE tickets SET assignee_user_id = ?, last_activity_at = ? WHERE id = ?').run(userId || null, Date.now(), req.params.id);
  saveDb();
  const assignee = userId ? db.prepare('SELECT name FROM users WHERE id = ?').get(userId) : null;
  addAudit(db, req.user.id, 'assignee_changed', 'ticket', req.params.id, userId ? 'Assigned to ' + assignee.name : 'Unassigned / returned to queue');
  res.json({ ticket: enrichTicket(db, db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id)) });
});

router.post('/:id/status', requireAuth, (req, res) => {
  const db = getDb();
  const { status, closeReasonId } = req.body;
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Not found' });
  if (!['OPEN', 'WAITING_ON_EXTERNAL', 'CLOSED'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  if (ticket.status === 'CLOSED' && status !== 'CLOSED' && req.user.role === 'coordinator')
    return res.status(403).json({ error: 'Supervisor override required to reopen' });
  db.prepare('UPDATE tickets SET status = ?, last_activity_at = ?, closed_at = ?, close_reason_id = ?, locked_closed = ? WHERE id = ?')
    .run(status, Date.now(), status === 'CLOSED' ? Date.now() : null, closeReasonId || null, status === 'CLOSED' ? 1 : 0, req.params.id);
  saveDb();
  addAudit(db, req.user.id, 'status_changed', 'ticket', req.params.id, 'Status -> ' + status);
  res.json({ ticket: enrichTicket(db, db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id)) });
});

router.post('/:id/reply', requireAuth, (req, res) => {
  const db = getDb();
  const { body } = req.body;
  if (!body?.trim()) return res.status(400).json({ error: 'Body required' });
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Not found' });
  const region = db.prepare('SELECT * FROM regions WHERE id = ?').get(ticket.region_id);
  const aliases = JSON.parse(region.routing_aliases || '[]');
  const fromAddr = aliases[0] || 'intake@carecoord.org';
  const extP = JSON.parse(ticket.external_participants || '[]');
  const lastIn = db.prepare("SELECT * FROM messages WHERE ticket_id = ? AND direction = 'inbound' ORDER BY sent_at DESC LIMIT 1").get(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const fullBody = body + '\n\n—\n' + user.name + '\nCare Coordinator — ' + region.name + '\n' + user.email;
  const msgId = uuid();
  const refs = lastIn ? JSON.parse(lastIn.reference_ids || '[]').concat(lastIn.provider_message_id) : [];
  db.prepare('INSERT INTO messages (id, ticket_id, direction, channel, from_address, to_addresses, subject, body_text, sent_at, provider_message_id, in_reply_to, reference_ids, created_by_user_id, created_at) VALUES (?, ?, \'outbound\', \'email\', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(msgId, req.params.id, fromAddr, JSON.stringify(extP), 'Re: ' + ticket.subject, fullBody, Date.now(), 'msg-int-' + Date.now(), lastIn?.provider_message_id || null, JSON.stringify(refs), req.user.id, Date.now());
  db.prepare("UPDATE tickets SET status = 'WAITING_ON_EXTERNAL', last_activity_at = ?, has_unread = 0 WHERE id = ?").run(Date.now(), req.params.id);
  saveDb();
  addAudit(db, req.user.id, 'outbound_sent', 'message', msgId, 'Reply sent to ' + extP[0]);
  const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(msgId);
  message.to_addresses = JSON.parse(message.to_addresses);
  message.reference_ids = JSON.parse(message.reference_ids);
  res.json({ message });
});

router.post('/:id/notes', requireAuth, (req, res) => {
  const db = getDb();
  const { body } = req.body;
  if (!body?.trim()) return res.status(400).json({ error: 'Body required' });
  const noteId = uuid();
  db.prepare('INSERT INTO notes (id, ticket_id, author_user_id, body, created_at) VALUES (?, ?, ?, ?, ?)').run(noteId, req.params.id, req.user.id, body, Date.now());
  db.prepare('UPDATE tickets SET last_activity_at = ? WHERE id = ?').run(Date.now(), req.params.id);
  saveDb();
  addAudit(db, req.user.id, 'note_added', 'note', noteId, 'Internal note added');
  res.json({ note: db.prepare('SELECT n.*, u.name as author_name, u.avatar as author_avatar FROM notes n JOIN users u ON u.id = n.author_user_id WHERE n.id = ?').get(noteId) });
});

router.post('/:id/tags', requireAuth, (req, res) => {
  const db = getDb();
  try { db.prepare('INSERT OR IGNORE INTO ticket_tags (ticket_id, tag_id) VALUES (?, ?)').run(req.params.id, req.body.tagId); saveDb(); } catch(e) {}
  res.json({ ticket: enrichTicket(db, db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id)) });
});

router.delete('/:id/tags/:tagId', requireAuth, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM ticket_tags WHERE ticket_id = ? AND tag_id = ?').run(req.params.id, req.params.tagId);
  saveDb();
  res.json({ ticket: enrichTicket(db, db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id)) });
});

router.post('/:id/region', requireAuth, (req, res) => {
  const db = getDb();
  const region = db.prepare('SELECT * FROM regions WHERE id = ?').get(req.body.regionId);
  if (!region) return res.status(404).json({ error: 'Region not found' });
  db.prepare('UPDATE tickets SET region_id = ?, assignee_user_id = NULL, last_activity_at = ? WHERE id = ?').run(req.body.regionId, Date.now(), req.params.id);
  saveDb();
  addAudit(db, req.user.id, 'region_changed', 'ticket', req.params.id, 'Region -> ' + region.name);
  res.json({ ticket: enrichTicket(db, db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id)) });
});

router.post('/bulk/reassign', requireAuth, requireSupervisor, (req, res) => {
  const db = getDb();
  const { fromUserId, toUserId } = req.body;
  const affected = db.prepare("SELECT id FROM tickets WHERE assignee_user_id = ? AND status != 'CLOSED'").all(fromUserId);
  db.prepare("UPDATE tickets SET assignee_user_id = ?, last_activity_at = ? WHERE assignee_user_id = ? AND status != 'CLOSED'").run(toUserId || null, Date.now(), fromUserId);
  saveDb();
  const fromUser = db.prepare('SELECT name FROM users WHERE id = ?').get(fromUserId);
  const toUser = toUserId ? db.prepare('SELECT name FROM users WHERE id = ?').get(toUserId) : null;
  addAudit(db, req.user.id, 'bulk_reassign', 'user', fromUserId, affected.length + ' tickets from ' + fromUser.name + ' -> ' + (toUser ? toUser.name : 'region queue'));
  res.json({ reassigned: affected.length });
});

module.exports = router;
