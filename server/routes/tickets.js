const express = require('express');
const { v4: uuid } = require('uuid');
const { getDb, saveDb } = require('../database');
const { requireAuth, requireSupervisor, addAudit, toStr } = require('../middleware');
const { google } = require('googleapis');
const router = express.Router();

function sanitize(obj) {
  if (!obj) return obj;
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v instanceof Uint8Array || (v && typeof v === 'object' && v.constructor && v.constructor.name === 'Uint8Array')) obj[k] = Buffer.from(v).toString('utf8');
  }
  return obj;
}

function enrichTicket(db, ticket) {
  if (!ticket) return null;
  sanitize(ticket);
  ticket.external_participants = JSON.parse(ticket.external_participants || '[]');
  const tags = db.prepare('SELECT t.* FROM tags t JOIN ticket_tags tt ON tt.tag_id = t.id WHERE tt.ticket_id = ?').all(ticket.id);
  ticket.tags = tags;
  ticket.tagIds = tags.map(t => t.id);
  if (ticket.assignee_user_id)
    ticket.assignee = db.prepare('SELECT id, name, email, role, avatar FROM users WHERE id = ?').get(ticket.assignee_user_id);
  ticket.region = db.prepare('SELECT id, name FROM regions WHERE id = ?').get(ticket.region_id);
  return ticket;
}


router.post('/', requireAuth, async (req, res) => {
  const db = getDb();
  const { toEmail, subject, body, regionId, tagIds, attachments: newAttachments } = req.body;
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

  // Save attachments to DB
  if (newAttachments && newAttachments.length > 0) {
    const insAtt = db.prepare('INSERT INTO attachments (id, ticket_id, filename, data, message_id, mime_type, size) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const att of newAttachments) {
      insAtt.run(uuid(), ticketId, att.name, att.data, msgId, att.mimeType || 'application/octet-stream', att.size || 0);
    }
  }

  // Add tags if provided
  if (tagIds && tagIds.length > 0) {
    const insTag = db.prepare('INSERT OR IGNORE INTO ticket_tags (ticket_id, tag_id) VALUES (?, ?)');
    tagIds.forEach(tagId => insTag.run(ticketId, tagId));
  }

  saveDb();

  addAudit(db, req.user.id, 'ticket_created', 'ticket', ticketId, 'Outbound ticket created: ' + subject);
  addAudit(db, req.user.id, 'outbound_sent', 'message', msgId, 'Initial message sent to ' + toEmail.trim());

  // Actually send via Gmail
  try {
    const tokenRow = db.prepare('SELECT * FROM gmail_tokens WHERE user_id = ?').get(req.user.id);
    if (tokenRow) {
      const oauth2 = new google.auth.OAuth2(process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET, process.env.GMAIL_REDIRECT_URI);
      oauth2.setCredentials({ access_token: tokenRow.access_token, refresh_token: tokenRow.refresh_token, expiry_date: tokenRow.expiry_date });
      const gm = google.gmail({ version: 'v1', auth: oauth2 });
      const senderEmail = tokenRow.email || fromAddr;
      const CRLF = String.fromCharCode(13, 10);
      let raw;

      if (newAttachments && newAttachments.length > 0) {
        const boundary = 'boundary_' + Date.now() + '_' + Math.random().toString(36).slice(2);
        const headers = [
          'From: ' + senderEmail, 'To: ' + toEmail.trim(), 'Subject: ' + subject,
          'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="' + boundary + '"',
        ];
        let mimeBody = headers.join(CRLF) + CRLF + CRLF;
        mimeBody += '--' + boundary + CRLF + 'Content-Type: text/plain; charset=utf-8' + CRLF + 'Content-Transfer-Encoding: 7bit' + CRLF + CRLF + fullBody + CRLF + CRLF;
        for (const att of newAttachments) {
          mimeBody += '--' + boundary + CRLF;
          mimeBody += 'Content-Type: ' + (att.mimeType || 'application/octet-stream') + '; name="' + att.name + '"' + CRLF;
          mimeBody += 'Content-Disposition: attachment; filename="' + att.name + '"' + CRLF;
          mimeBody += 'Content-Transfer-Encoding: base64' + CRLF + CRLF;
          mimeBody += att.data + CRLF + CRLF;
        }
        mimeBody += '--' + boundary + '--' + CRLF;
        raw = Buffer.from(mimeBody).toString('base64url');
      } else {
        const emailLines = [
          'From: ' + senderEmail, 'To: ' + toEmail.trim(), 'Subject: ' + subject,
          'Content-Type: text/plain; charset=utf-8', 'MIME-Version: 1.0', '', fullBody,
        ];
        raw = Buffer.from(emailLines.join(CRLF)).toString('base64url');
      }

      const sent = await gm.users.messages.send({ userId: 'me', requestBody: { raw } });
      console.log('[Gmail] New message sent to', toEmail.trim(), 'threadId:', sent.data.threadId, 'msgId:', sent.data.id);
      db.prepare('UPDATE messages SET gmail_message_id = ?, gmail_thread_id = ?, gmail_user_id = ? WHERE id = ?')
        .run(sent.data.id, sent.data.threadId, req.user.id, msgId);
      saveDb();
    } else {
      console.log('[Gmail] No token — message saved but not sent');
    }
  } catch (gmailErr) {
    console.error('[Gmail] Send failed:', gmailErr.message);
  }

  const ticket = enrichTicket(db, db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId));
  res.json({ ticket });
});

router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const { queue, region, status, search } = req.query;
  let where = [], params = [];
  if (queue === 'personal') { where.push('t.assignee_user_id = ?'); params.push(req.user.id); }
  else { const rids = req.user.regionIds || []; if (rids.length) { const ph = rids.map(() => '?').join(','); where.push('t.region_id IN (' + ph + ')'); params.push(...rids); } else { where.push('1=0'); } }
  if (region && region !== 'all') { where.push('t.region_id = ?'); params.push(region); }
  if (status === 'unassigned') { where.push("t.assignee_user_id IS NULL AND t.status != ?"); params.push('CLOSED'); }
  else if (status === 'open') where.push("t.status = 'OPEN'");
  else if (status === 'waiting') where.push("t.status = 'WAITING_ON_EXTERNAL'");
  else if (status === 'closed') where.push("t.status = 'CLOSED'");
  else if (status !== 'all') where.push("t.status != 'CLOSED'");
  if (search) { where.push('(t.subject LIKE ? OR t.external_participants LIKE ? OR t.id LIKE ?)'); const q = '%' + search + '%'; params.push(q, q, q); }
  const wc = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const tickets = db.prepare('SELECT t.* FROM tickets t ' + wc + ' ORDER BY t.last_activity_at DESC').all(...params);
  res.json({ tickets: tickets.map(t => enrichTicket(db, t)) });
});

// ── Bird's Eye Dashboard ──
router.get('/birds-eye', requireAuth, (req, res) => {
  if (req.user.role !== 'supervisor' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Supervisor access required' });
  }
  const db = getDb();

  // All open tickets with details
  const allTickets = db.prepare(`
    SELECT t.*, 
      (SELECT body_text FROM messages WHERE ticket_id = t.id ORDER BY created_at DESC LIMIT 1) as last_message
    FROM tickets t WHERE t.status != 'CLOSED'
    ORDER BY t.last_activity_at DESC
  `).all();

  const now = Date.now();
  const tickets = allTickets.map(t => {
    const age = now - (t.created_at || now);
    const lastActivity = now - (t.last_activity_at || now);
    const assignee = t.assignee_user_id ? db.prepare('SELECT id,name,email,role FROM users WHERE id=?').get(t.assignee_user_id) : null;
    const region = t.region_id ? db.prepare('SELECT id,name FROM regions WHERE id=?').get(t.region_id) : null;
    return {
      id: toStr(t.id), subject: toStr(t.subject), status: toStr(t.status),
      fromEmail: toStr(t.from_email), createdAt: t.created_at, lastActivityAt: t.last_activity_at,
      hasUnread: !!t.has_unread, ageMs: age, lastActivityMs: lastActivity,
      aging: lastActivity > 86400000 ? '24h+' : lastActivity > 14400000 ? '4h+' : lastActivity > 3600000 ? '1h+' : 'fresh',
      assignee: assignee ? { id: toStr(assignee.id), name: toStr(assignee.name) } : null,
      region: region ? { id: toStr(region.id), name: toStr(region.name) } : null,
    };
  });

  // Coordinator stats
  const coordinators = db.prepare("SELECT id,name,email,role FROM users WHERE role='coordinator' AND is_active=1").all();
  const coordStats = coordinators.map(c => {
    const open = db.prepare("SELECT COUNT(*) as n FROM tickets WHERE assignee_user_id=? AND status!='CLOSED'").get(c.id);
    const lastActive = db.prepare("SELECT MAX(last_activity_at) as t FROM tickets WHERE assignee_user_id=?").get(c.id);
    // Check if user has an active session (online indicator)
    const session = db.prepare("SELECT 1 FROM sessions WHERE user_id=? AND expires > ?").get(c.id, now);
    return {
      id: toStr(c.id), name: toStr(c.name), email: toStr(c.email),
      openTickets: open?.n || 0,
      lastActive: lastActive?.t || 0,
      isOnline: !!session,
    };
  });

  // Region stats
  const regions = db.prepare("SELECT id,name FROM regions WHERE is_active=1").all();
  const regionStats = regions.map(r => {
    const total = db.prepare("SELECT COUNT(*) as n FROM tickets WHERE region_id=? AND status!='CLOSED'").get(r.id);
    const unassigned = db.prepare("SELECT COUNT(*) as n FROM tickets WHERE region_id=? AND assignee_user_id IS NULL AND status!='CLOSED'").get(r.id);
    return {
      id: toStr(r.id), name: toStr(r.name),
      totalOpen: total?.n || 0, unassigned: unassigned?.n || 0,
    };
  });

  res.json({ tickets, coordinators: coordStats, regions: regionStats });
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
  // Add attachments to each message
  messages.forEach(m => {
    m.attachments = db.prepare('SELECT id, filename, mime_type, size FROM attachments WHERE message_id = ?').all(m.id);
  });
  // Also get ticket-level attachments
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
  // Block inactive coordinators from claiming tickets
  const assigneeUser = userId ? db.prepare('SELECT work_status FROM users WHERE id = ?').get(userId) : null;
  if (assigneeUser && assigneeUser.work_status === 'inactive' && req.user.role === 'coordinator')
    return res.status(400).json({ error: 'You are currently inactive. Set your status to Active to claim tickets.' });
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

router.post('/:id/reply', requireAuth, async (req, res) => {
  const db = getDb();
  const { body, attachments: replyAttachments } = req.body;
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

  // Save reply attachments to DB
  if (replyAttachments && replyAttachments.length > 0) {
    const insAtt = db.prepare('INSERT INTO attachments (id, ticket_id, filename, data, message_id, mime_type, size) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const att of replyAttachments) {
      insAtt.run(uuid(), req.params.id, att.name, att.data, msgId, att.mimeType || 'application/octet-stream', att.size || 0);
    }
  }

  db.prepare("UPDATE tickets SET status = 'WAITING_ON_EXTERNAL', last_activity_at = ?, has_unread = 0 WHERE id = ?").run(Date.now(), req.params.id);
  saveDb();

  // Actually send via Gmail
  try {
    const tokenRow = db.prepare('SELECT * FROM gmail_tokens WHERE user_id = ?').get(req.user.id);
    if (tokenRow) {
      const oauth2 = new google.auth.OAuth2(process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET, process.env.GMAIL_REDIRECT_URI);
      oauth2.setCredentials({ access_token: tokenRow.access_token, refresh_token: tokenRow.refresh_token, expiry_date: tokenRow.expiry_date });
      const gmail = google.gmail({ version: 'v1', auth: oauth2 });

      const toAddr = extP[0] || '';
      const subject = 'Re: ' + ticket.subject;
      const replyTo = lastIn?.provider_message_id || '';

      // Build RFC 2822 email (with optional attachments)
      const senderEmail = tokenRow.email || fromAddr;
      const CRLF = String.fromCharCode(13, 10);
      let raw;

      if (replyAttachments && replyAttachments.length > 0) {
        const boundary = 'boundary_' + Date.now() + '_' + Math.random().toString(36).slice(2);
        const headers = [
          'From: ' + senderEmail, 'To: ' + toAddr, 'Subject: ' + subject,
          'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="' + boundary + '"',
        ];
        if (replyTo) { headers.push('In-Reply-To: <' + replyTo + '>'); headers.push('References: <' + replyTo + '>'); }
        let mimeBody = headers.join(CRLF) + CRLF + CRLF;
        mimeBody += '--' + boundary + CRLF + 'Content-Type: text/plain; charset=utf-8' + CRLF + 'Content-Transfer-Encoding: 7bit' + CRLF + CRLF + fullBody + CRLF + CRLF;
        for (const att of replyAttachments) {
          mimeBody += '--' + boundary + CRLF;
          mimeBody += 'Content-Type: ' + (att.mimeType || 'application/octet-stream') + '; name="' + att.name + '"' + CRLF;
          mimeBody += 'Content-Disposition: attachment; filename="' + att.name + '"' + CRLF;
          mimeBody += 'Content-Transfer-Encoding: base64' + CRLF + CRLF;
          mimeBody += att.data + CRLF + CRLF;
        }
        mimeBody += '--' + boundary + '--' + CRLF;
        raw = Buffer.from(mimeBody).toString('base64url');
      } else {
        const emailLines = [
          'From: ' + senderEmail, 'To: ' + toAddr, 'Subject: ' + subject,
          'Content-Type: text/plain; charset=utf-8', 'MIME-Version: 1.0',
        ];
        if (replyTo) { emailLines.push('In-Reply-To: <' + replyTo + '>'); emailLines.push('References: <' + replyTo + '>'); }
        emailLines.push(''); emailLines.push(fullBody);
        raw = Buffer.from(emailLines.join(CRLF)).toString('base64url');
      }
      await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
      console.log('[Gmail] Reply sent to', toAddr);
    } else {
      console.log('[Gmail] No token for user', req.user.id, '— message saved but not sent');
    }
  } catch (gmailErr) {
    console.error('[Gmail] Send failed:', gmailErr.message);
    // Message is still saved in DB, just not sent via Gmail
  }

  addAudit(db, req.user.id, 'outbound_sent', 'message', msgId, 'Reply sent to ' + extP[0]);
  const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(msgId);
  message.to_addresses = JSON.parse(message.to_addresses);
  message.reference_ids = JSON.parse(message.reference_ids);
  // Auto-assign to replier if unassigned (skip if replier is inactive)
  const ticketCheck = db.prepare('SELECT assignee_user_id FROM tickets WHERE id = ?').get(req.params.id);
  const replierStatus = db.prepare('SELECT work_status FROM users WHERE id = ?').get(req.user.id);
  if (ticketCheck && !ticketCheck.assignee_user_id && (!replierStatus || replierStatus.work_status !== 'inactive')) {
    db.prepare('UPDATE tickets SET assignee_user_id = ? WHERE id = ?').run(req.user.id, req.params.id);
    addAudit(db, req.user.id, 'auto_assigned', 'ticket', req.params.id, 'Auto-assigned on reply');
  }
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

router.get('/:id/attachments', requireAuth, (req, res) => {
  const db = getDb();
  const atts = db.prepare('SELECT id, filename, mime_type, size FROM attachments WHERE ticket_id = ?').all(req.params.id);
  res.json({ attachments: atts });
});

router.get('/:ticketId/attachments/:attId/download', requireAuth, (req, res) => {
  const db = getDb();
  const att = db.prepare('SELECT * FROM attachments WHERE id = ? AND ticket_id = ?').get(req.params.attId, req.params.ticketId);
  if (!att) return res.status(404).json({ error: 'Not found' });
  const buf = Buffer.from(att.data, 'base64');
  res.set('Content-Type', att.mime_type || 'application/octet-stream');
  res.set('Content-Disposition', 'attachment; filename="' + att.filename + '"');
  res.send(buf);
});


module.exports = router;
