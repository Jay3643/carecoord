const express = require('express');
const { v4: uuid } = require('uuid');
const { getDb, saveDb } = require('../database');
const { requireAuth, requireSupervisor, addAudit, toStr } = require('../middleware');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const router = express.Router();

// Generate short ticket ID: REGION-NNNN (e.g. CPA-0042)
function generateTicketId(db, regionId) {
  const region = regionId ? db.prepare('SELECT name FROM regions WHERE id = ?').get(regionId) : null;
  const regionName = region ? toStr(region.name) : 'GEN';
  // Build abbreviation from region name: "Central PA" -> "CPA", "South NJ" -> "SNJ"
  const abbr = regionName.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 3);
  // Get next number
  const last = db.prepare("SELECT id FROM tickets WHERE id LIKE ? ORDER BY id DESC LIMIT 1").get(abbr + '-%');
  let num = 1;
  if (last) {
    const match = toStr(last.id).match(/-(\d+)$/);
    if (match) num = parseInt(match[1]) + 1;
  }
  return abbr + '-' + String(num).padStart(4, '0');
}

// Service account key (same as gmail.js)
let serviceAccountKey = null;
if (process.env.SA_CLIENT_EMAIL && process.env.SA_PRIVATE_KEY) {
  serviceAccountKey = { client_email: process.env.SA_CLIENT_EMAIL, private_key: process.env.SA_PRIVATE_KEY.replace(/\\n/g, '\n') };
} else {
  try { serviceAccountKey = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'service-account.json'), 'utf8')); } catch(e) {}
}

// Get Gmail auth for a user — tries service account, then OAuth tokens
function getGmailAuth(userId) {
  const db = getDb();
  const user = db.prepare('SELECT email FROM users WHERE id = ?').get(userId);
  if (!user) return null;
  const email = toStr(user.email);

  // Try service account first
  if (serviceAccountKey) {
    const auth = new google.auth.JWT({
      email: serviceAccountKey.client_email,
      key: serviceAccountKey.private_key,
      scopes: ['https://www.googleapis.com/auth/gmail.send'],
      subject: email,
    });
    return { auth, email };
  }

  // Fall back to OAuth tokens
  const t = db.prepare('SELECT * FROM gmail_tokens WHERE user_id = ?').get(userId);
  if (t && t.access_token) {
    const oauth2 = new google.auth.OAuth2(process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET, process.env.GMAIL_REDIRECT_URI);
    oauth2.setCredentials({ access_token: toStr(t.access_token), refresh_token: toStr(t.refresh_token), expiry_date: t.expiry_date });
    return { auth: oauth2, email: toStr(t.email) || email };
  }

  return null;
}

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
  const rawTags = db.prepare('SELECT t.* FROM tags t JOIN ticket_tags tt ON tt.tag_id = t.id WHERE tt.ticket_id = ?').all(ticket.id);
  const tags = rawTags.map(t => {
    const tag = { id: toStr(t.id), name: toStr(t.name), color: toStr(t.color), parentId: toStr(t.parent_id) || null, regionId: toStr(t.region_id) || null };
    if (tag.parentId) {
      const parent = db.prepare('SELECT name, color FROM tags WHERE id = ?').get(tag.parentId);
      if (parent) tag.parentName = toStr(parent.name);
    }
    return tag;
  });
  ticket.tags = tags;
  ticket.tagIds = tags.map(t => t.id);
  if (ticket.assignee_user_id)
    ticket.assignee = db.prepare('SELECT id, name, email, role, avatar, profile_photo_url as photoUrl FROM users WHERE id = ?').get(ticket.assignee_user_id);
  ticket.region = db.prepare('SELECT id, name FROM regions WHERE id = ?').get(ticket.region_id);
  // Compute response time (assigned -> read)
  if (ticket.assigned_at && ticket.read_at) {
    ticket.response_time_ms = ticket.read_at - ticket.assigned_at;
  }
  if (ticket.read_by_user_id) {
    ticket.read_by = db.prepare('SELECT id, name FROM users WHERE id = ?').get(ticket.read_by_user_id);
  }
  if (ticket.synced_for_user_id) {
    ticket.syncedFor = db.prepare('SELECT id, name, avatar, profile_photo_url as photoUrl FROM users WHERE id = ?').get(ticket.synced_for_user_id);
  }
  // Multiple intended recipients
  const syncedIds = JSON.parse(toStr(ticket.synced_for_user_ids) || '[]');
  if (syncedIds.length > 0) {
    ticket.syncedForUsers = syncedIds.map(uid => db.prepare('SELECT id, name, avatar, profile_photo_url as photoUrl FROM users WHERE id = ?').get(uid)).filter(Boolean);
  }
  // Linked tickets (multi-recipient siblings)
  const linkedIds = JSON.parse(toStr(ticket.linked_ticket_ids) || '[]');
  if (linkedIds.length > 0) {
    ticket.linkedTickets = linkedIds.map(lid => {
      const lt = db.prepare('SELECT id, subject, status, assignee_user_id, synced_for_user_id FROM tickets WHERE id = ?').get(lid);
      if (!lt) return null;
      const assignee = lt.assignee_user_id ? db.prepare('SELECT id, name FROM users WHERE id = ?').get(lt.assignee_user_id) : null;
      const syncedFor = lt.synced_for_user_id ? db.prepare('SELECT id, name FROM users WHERE id = ?').get(lt.synced_for_user_id) : null;
      return { id: toStr(lt.id), subject: toStr(lt.subject), status: toStr(lt.status), assignee, syncedFor };
    }).filter(Boolean);
  }
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

  const ticketId = generateTicketId(db, regionId);
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
    const gmailAuth = getGmailAuth(req.user.id);
    if (gmailAuth) {
      const gm = google.gmail({ version: 'v1', auth: gmailAuth.auth });
      const senderEmail = gmailAuth.email || fromAddr;
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
      console.log('[Gmail] No auth available — message saved but not sent via Gmail');
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
  else {
    const rids = req.user.regionIds || [];
    if (rids.length) { const ph = rids.map(() => '?').join(','); where.push('t.region_id IN (' + ph + ')'); params.push(...rids); } else { where.push('1=0'); }
    // Coordinators only see unassigned tickets and their own in the region queue
    if (req.user.role === 'coordinator') {
      where.push('(t.assignee_user_id IS NULL OR t.assignee_user_id = ?)');
      params.push(req.user.id);
    }
  }
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

// ── Pending import: unassigned tickets synced for this user (exclude ones they sent) ──
router.get('/my/pending', requireAuth, (req, res) => {
  const db = getDb();
  const tickets = db.prepare(
    "SELECT * FROM tickets WHERE (synced_for_user_id = ? OR synced_for_user_ids LIKE ?) AND assignee_user_id IS NULL AND status != 'CLOSED' ORDER BY created_at DESC"
  ).all(req.user.id, '%' + req.user.id + '%');
  // Filter out tickets where the first message is outbound from this user (they sent it)
  const filtered = tickets.filter(t => {
    const firstMsg = db.prepare("SELECT direction, created_by_user_id FROM messages WHERE ticket_id = ? ORDER BY sent_at ASC LIMIT 1").get(t.id);
    if (firstMsg && toStr(firstMsg.direction) === 'outbound' && toStr(firstMsg.created_by_user_id) === req.user.id) return false;
    return true;
  });
  res.json({ tickets: filtered.map(t => enrichTicket(db, t)), count: filtered.length });
});

// ── Claim pending tickets (import into my queue) ──
router.post('/my/claim-pending', requireAuth, (req, res) => {
  const db = getDb();
  const { ticketIds } = req.body;
  const now = Date.now();
  let claimed = 0;
  // If ticketIds provided, claim those; otherwise claim all pending
  const pending = ticketIds
    ? ticketIds.map(id => db.prepare("SELECT id FROM tickets WHERE id = ? AND (synced_for_user_id = ? OR synced_for_user_ids LIKE ?) AND assignee_user_id IS NULL AND status != 'CLOSED'").get(id, req.user.id, '%' + req.user.id + '%')).filter(Boolean)
    : db.prepare("SELECT id FROM tickets WHERE (synced_for_user_id = ? OR synced_for_user_ids LIKE ?) AND assignee_user_id IS NULL AND status != 'CLOSED'").all(req.user.id, '%' + req.user.id + '%');
  for (const t of pending) {
    db.prepare('UPDATE tickets SET assignee_user_id = ?, assigned_at = ?, has_unread = 1 WHERE id = ?').run(req.user.id, now, toStr(t.id));
    claimed++;
  }
  saveDb();
  if (claimed > 0) addAudit(db, req.user.id, 'bulk_claim', 'user', req.user.id, 'Claimed ' + claimed + ' pending tickets');
  res.json({ claimed });
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
  // Mark as read when opened — record who read it and when
  if (ticket.has_unread) {
    db.prepare('UPDATE tickets SET has_unread = 0, read_at = ?, read_by_user_id = ? WHERE id = ?').run(Date.now(), req.user.id, req.params.id);
    saveDb();
    ticket.has_unread = 0;
    ticket.read_at = Date.now();
    ticket.read_by_user_id = req.user.id;
  }
  res.json({ ticket: enrichTicket(db, ticket) });
});

router.get('/:id/messages', requireAuth, (req, res) => {
  const db = getDb();
  const messages = db.prepare('SELECT * FROM messages WHERE ticket_id = ? ORDER BY sent_at ASC').all(req.params.id);
  messages.forEach(m => {
    sanitize(m);
    m.to_addresses = JSON.parse(toStr(m.to_addresses) || '[]');
    m.cc_addresses = JSON.parse(toStr(m.cc_addresses) || '[]');
    m.reference_ids = JSON.parse(toStr(m.reference_ids) || '[]');
    if (m.created_by_user_id) m.sender = db.prepare('SELECT id, name, email, avatar, profile_photo_url as photoUrl FROM users WHERE id = ?').get(m.created_by_user_id);
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
  const notes = db.prepare('SELECT n.*, u.name as author_name, u.avatar as author_avatar, u.profile_photo_url as author_photo_url FROM notes n JOIN users u ON u.id = n.author_user_id WHERE n.ticket_id = ? ORDER BY n.created_at ASC').all(req.params.id);
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
  const now = Date.now();
  db.prepare('UPDATE tickets SET assignee_user_id = ?, last_activity_at = ?, assigned_at = ?, has_unread = 1, read_at = NULL, read_by_user_id = NULL WHERE id = ?').run(userId || null, now, userId ? now : null, req.params.id);
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

  // When closing: stop any running clocks and archive the chat channel
  if (status === 'CLOSED') {
    // Stop any running clocks on this ticket
    const runningClocks = db.prepare('SELECT id, user_id, started_at FROM time_entries WHERE ticket_id = ? AND stopped_at IS NULL').all(req.params.id);
    for (const clock of runningClocks) {
      const dur = Date.now() - clock.started_at;
      db.prepare('UPDATE time_entries SET stopped_at = ?, duration_ms = ? WHERE id = ?').run(Date.now(), dur, toStr(clock.id));
    }
    const chatChannel = db.prepare("SELECT id FROM chat_channels WHERE ticket_id = ? AND type = 'ticket'").get(req.params.id);
    if (chatChannel) {
      const chId = toStr(chatChannel.id);
      // Save chat messages as a single archived note
      const chatMsgs = db.prepare('SELECT cm.body, cm.created_at, u.name as sender_name FROM chat_messages cm LEFT JOIN users u ON u.id = cm.user_id WHERE cm.channel_id = ? ORDER BY cm.created_at ASC').all(chId);
      if (chatMsgs.length > 0) {
        const transcript = chatMsgs.map(m => {
          const time = m.created_at ? new Date(m.created_at).toLocaleString('en-US', { timeZone: 'America/New_York' }) : '';
          return '[' + (toStr(m.sender_name) || 'Unknown') + ' — ' + time + ']\n' + toStr(m.body);
        }).join('\n\n');
        const noteBody = '--- Archived Chat (' + chatMsgs.length + ' messages) ---\n\n' + transcript;
        db.prepare('INSERT INTO notes (id, ticket_id, author_user_id, body, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(uuid(), req.params.id, req.user.id, noteBody, Date.now());
      }
      // Remove chat channel, members, and messages
      db.prepare('DELETE FROM chat_messages WHERE channel_id = ?').run(chId);
      db.prepare('DELETE FROM chat_members WHERE channel_id = ?').run(chId);
      db.prepare('DELETE FROM chat_channels WHERE id = ?').run(chId);
    }
  }

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
    const gmailAuth = getGmailAuth(req.user.id);
    if (gmailAuth) {
      const gmail = google.gmail({ version: 'v1', auth: gmailAuth.auth });

      const toAddr = extP[0] || '';
      const subject = 'Re: ' + ticket.subject;
      const replyTo = lastIn?.provider_message_id || '';

      // Build RFC 2822 email (with optional attachments)
      const senderEmail = gmailAuth.email || fromAddr;
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
      const sent = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
      // Save Gmail thread ID and message ID on the outbound message so future replies thread correctly
      if (sent.data) {
        db.prepare('UPDATE messages SET gmail_message_id = ?, gmail_thread_id = ?, gmail_user_id = ? WHERE id = ?')
          .run(sent.data.id, sent.data.threadId, req.user.id, msgId);
        saveDb();
      }
      console.log('[Gmail] Reply sent to', toAddr, 'threadId:', sent.data?.threadId);
    } else {
      console.log('[Gmail] No auth for user', req.user.id, '— message saved but not sent via Gmail');
    }
  } catch (gmailErr) {
    console.error('[Gmail] Send failed:', gmailErr.message);
    // Message is still saved in DB, just not sent via Gmail
  }

  addAudit(db, req.user.id, 'outbound_sent', 'message', msgId, 'Reply sent to ' + extP[0]);
  const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(msgId);
  message.to_addresses = JSON.parse(message.to_addresses);
  message.reference_ids = JSON.parse(message.reference_ids);
  // Auto-assign to replier if not already assigned to them (skip if replier is inactive)
  const ticketCheck = db.prepare('SELECT assignee_user_id FROM tickets WHERE id = ?').get(req.params.id);
  const replierStatus = db.prepare('SELECT work_status FROM users WHERE id = ?').get(req.user.id);
  const currentAssignee = ticketCheck ? toStr(ticketCheck.assignee_user_id) : null;
  if (ticketCheck && currentAssignee !== req.user.id && (!replierStatus || replierStatus.work_status !== 'inactive')) {
    db.prepare('UPDATE tickets SET assignee_user_id = ?, assigned_at = ? WHERE id = ?').run(req.user.id, Date.now(), req.params.id);
    addAudit(db, req.user.id, 'auto_assigned', 'ticket', req.params.id, 'Auto-assigned on reply');
    saveDb();
  }
  res.json({ message });
});

// Reply All — sends reply and copies to all linked tickets
router.post('/:id/reply-all', requireAuth, async (req, res) => {
  const db = getDb();
  const { body: replyBody, attachments: replyAttachments } = req.body;
  if (!replyBody?.trim()) return res.status(400).json({ error: 'Body required' });
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Not found' });

  // Send the normal reply on this ticket (reuse existing reply logic inline)
  const region = db.prepare('SELECT * FROM regions WHERE id = ?').get(ticket.region_id);
  const aliases = JSON.parse(region?.routing_aliases || '[]');
  const fromAddr = aliases[0] || 'intake@carecoord.org';
  const extP = JSON.parse(ticket.external_participants || '[]');
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const fullBody = replyBody + '\n\n—\n' + user.name + '\nCare Coordinator — ' + (region?.name || '') + '\n' + user.email;
  const msgId = uuid();
  db.prepare('INSERT INTO messages (id, ticket_id, direction, channel, from_address, to_addresses, subject, body_text, sent_at, provider_message_id, created_by_user_id, created_at) VALUES (?, ?, \'outbound\', \'email\', ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(msgId, req.params.id, fromAddr, JSON.stringify(extP), 'Re: ' + ticket.subject, fullBody, Date.now(), 'msg-int-' + Date.now(), req.user.id, Date.now());
  db.prepare("UPDATE tickets SET status = 'WAITING_ON_EXTERNAL', last_activity_at = ?, has_unread = 0 WHERE id = ?").run(Date.now(), req.params.id);

  // Copy the reply as a message on all linked tickets
  const linkedIds = JSON.parse(toStr(ticket.linked_ticket_ids) || '[]');
  for (const lid of linkedIds) {
    const lt = db.prepare('SELECT * FROM tickets WHERE id = ?').get(lid);
    if (lt) {
      const copyMsgId = uuid();
      db.prepare('INSERT INTO messages (id, ticket_id, direction, channel, from_address, to_addresses, subject, body_text, sent_at, created_by_user_id, created_at) VALUES (?, ?, \'outbound\', \'email\', ?, ?, ?, ?, ?, ?, ?)')
        .run(copyMsgId, toStr(lt.id), fromAddr, JSON.stringify(JSON.parse(toStr(lt.external_participants) || '[]')), 'Re: ' + toStr(lt.subject), fullBody, Date.now(), req.user.id, Date.now());
      db.prepare('UPDATE tickets SET last_activity_at = ?, has_unread = 1 WHERE id = ?').run(Date.now(), toStr(lt.id));
    }
  }

  saveDb();
  addAudit(db, req.user.id, 'reply_all_sent', 'ticket', req.params.id, 'Reply All to ' + (linkedIds.length + 1) + ' tickets');

  // Save reply attachments to DB
  if (replyAttachments && replyAttachments.length > 0) {
    const insAtt = db.prepare('INSERT INTO attachments (id, ticket_id, filename, data, message_id, mime_type, size) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const att of replyAttachments) {
      insAtt.run(uuid(), req.params.id, att.name, att.data, msgId, att.mimeType || 'application/octet-stream', att.size || 0);
    }
  }

  // Send via Gmail to ALL external participants across main + linked tickets
  try {
    const gmailAuth = getGmailAuth(req.user.id);
    if (gmailAuth) {
      const gmail = google.gmail({ version: 'v1', auth: gmailAuth.auth });
      // Collect all external participants from main ticket + linked tickets
      const allRecipients = new Set(extP);
      for (const lid of linkedIds) {
        const lt = db.prepare('SELECT external_participants FROM tickets WHERE id = ?').get(lid);
        if (lt) {
          const lep = JSON.parse(toStr(lt.external_participants) || '[]');
          lep.forEach(e => allRecipients.add(e));
        }
      }
      // Remove sender from recipients
      allRecipients.delete(gmailAuth.email);
      const toAddr = Array.from(allRecipients).join(', ') || '';
      const CRLF = '\r\n';
      const senderEmail = gmailAuth.email || fromAddr;

      let raw;
      if (replyAttachments && replyAttachments.length > 0) {
        const boundary = 'boundary_' + Date.now() + '_' + Math.random().toString(36).slice(2);
        const headers = [
          'From: ' + senderEmail, 'To: ' + toAddr, 'Subject: Re: ' + ticket.subject,
          'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="' + boundary + '"',
        ];
        let mimeBody = headers.join(CRLF) + CRLF + CRLF;
        mimeBody += '--' + boundary + CRLF + 'Content-Type: text/plain; charset=utf-8' + CRLF + 'Content-Transfer-Encoding: 7bit' + CRLF + CRLF + fullBody + CRLF + CRLF;
        for (const att of replyAttachments) {
          mimeBody += '--' + boundary + CRLF;
          mimeBody += 'Content-Type: ' + (att.mimeType || 'application/octet-stream') + '; name="' + att.name + '"' + CRLF;
          mimeBody += 'Content-Disposition: attachment; filename="' + att.name + '"' + CRLF;
          mimeBody += 'Content-Transfer-Encoding: base64' + CRLF + CRLF;
          mimeBody += att.data + CRLF + CRLF;
        }
        mimeBody += '--' + boundary + '--';
        raw = Buffer.from(mimeBody).toString('base64url');
      } else {
        const emailLines = ['From: ' + senderEmail, 'To: ' + toAddr, 'Subject: Re: ' + ticket.subject, 'Content-Type: text/plain; charset=utf-8', 'MIME-Version: 1.0', '', fullBody];
        raw = Buffer.from(emailLines.join(CRLF)).toString('base64url');
      }
      await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
    }
  } catch(e) { console.error('[Gmail] Reply-all send failed:', e.message); }

  res.json({ sent: linkedIds.length + 1 });
});

// Forward ticket to a new recipient
router.post('/:id/forward', requireAuth, async (req, res) => {
  const db = getDb();
  const { toEmail, body: fwdBody, attachments: fwdAttachments } = req.body;
  if (!toEmail?.trim()) return res.status(400).json({ error: 'Recipient email required' });
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Not found' });
  const region = db.prepare('SELECT * FROM regions WHERE id = ?').get(ticket.region_id);
  const aliases = JSON.parse(region?.routing_aliases || '[]');
  const fromAddr = aliases[0] || 'intake@carecoord.org';
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

  // Build forwarded message body with original messages
  const allMsgs = db.prepare('SELECT * FROM messages WHERE ticket_id = ? ORDER BY sent_at ASC').all(req.params.id);
  allMsgs.forEach(m => sanitize(m));
  let forwardedContent = (fwdBody || '').trim();
  forwardedContent += '\n\n---------- Forwarded message ----------\n';
  forwardedContent += 'Subject: ' + toStr(ticket.subject) + '\n\n';
  for (const msg of allMsgs) {
    const dir = toStr(msg.direction) === 'inbound' ? 'From' : 'Sent by';
    const bodyText = toStr(msg.body_text) || '';
    // Strip HTML tags for plain-text forwarding
    const plainBody = bodyText.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
    forwardedContent += dir + ': ' + toStr(msg.from_address) + ' (' + new Date(msg.sent_at).toLocaleString() + ')\n';
    forwardedContent += (plainBody || bodyText) + '\n\n---\n\n';
  }
  const fullBody = forwardedContent + '\n—\n' + user.name + '\nCare Coordinator — ' + (region?.name || '') + '\n' + user.email;

  const msgId = uuid();
  db.prepare('INSERT INTO messages (id, ticket_id, direction, channel, from_address, to_addresses, subject, body_text, sent_at, provider_message_id, created_by_user_id, created_at) VALUES (?, ?, \'outbound\', \'email\', ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(msgId, req.params.id, fromAddr, JSON.stringify([toEmail.trim()]), 'Fwd: ' + toStr(ticket.subject), fullBody, Date.now(), 'msg-fwd-' + Date.now(), req.user.id, Date.now());

  if (fwdAttachments && fwdAttachments.length > 0) {
    const insAtt = db.prepare('INSERT INTO attachments (id, ticket_id, filename, data, message_id, mime_type, size) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const att of fwdAttachments) {
      insAtt.run(uuid(), req.params.id, att.name, att.data, msgId, att.mimeType || 'application/octet-stream', att.size || 0);
    }
  }

  // Add the forwarded-to address to external participants
  const extP = JSON.parse(toStr(ticket.external_participants) || '[]');
  if (!extP.includes(toEmail.trim())) {
    extP.push(toEmail.trim());
    db.prepare('UPDATE tickets SET external_participants = ? WHERE id = ?').run(JSON.stringify(extP), req.params.id);
  }
  db.prepare('UPDATE tickets SET last_activity_at = ? WHERE id = ?').run(Date.now(), req.params.id);
  saveDb();

  // Send via Gmail
  try {
    const gmailAuth = getGmailAuth(req.user.id);
    if (gmailAuth) {
      const gmail = google.gmail({ version: 'v1', auth: gmailAuth.auth });
      const senderEmail = gmailAuth.email || fromAddr;
      const CRLF = '\r\n';
      let raw;
      if (fwdAttachments && fwdAttachments.length > 0) {
        const boundary = 'boundary_' + Date.now() + '_' + Math.random().toString(36).slice(2);
        const headers = [
          'From: ' + senderEmail, 'To: ' + toEmail.trim(), 'Subject: Fwd: ' + toStr(ticket.subject),
          'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="' + boundary + '"',
        ];
        let mimeBody = headers.join(CRLF) + CRLF + CRLF;
        mimeBody += '--' + boundary + CRLF + 'Content-Type: text/plain; charset=utf-8' + CRLF + 'Content-Transfer-Encoding: 7bit' + CRLF + CRLF + fullBody + CRLF + CRLF;
        for (const att of fwdAttachments) {
          mimeBody += '--' + boundary + CRLF;
          mimeBody += 'Content-Type: ' + (att.mimeType || 'application/octet-stream') + '; name="' + att.name + '"' + CRLF;
          mimeBody += 'Content-Disposition: attachment; filename="' + att.name + '"' + CRLF;
          mimeBody += 'Content-Transfer-Encoding: base64' + CRLF + CRLF;
          mimeBody += att.data + CRLF + CRLF;
        }
        mimeBody += '--' + boundary + '--';
        raw = Buffer.from(mimeBody).toString('base64url');
      } else {
        const emailLines = ['From: ' + senderEmail, 'To: ' + toEmail.trim(), 'Subject: Fwd: ' + toStr(ticket.subject), 'Content-Type: text/plain; charset=utf-8', 'MIME-Version: 1.0', '', fullBody];
        raw = Buffer.from(emailLines.join(CRLF)).toString('base64url');
      }
      await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
    }
  } catch(e) { console.error('[Gmail] Forward failed:', e.message); }

  addAudit(db, req.user.id, 'forwarded', 'ticket', req.params.id, 'Forwarded to ' + toEmail.trim());
  res.json({ success: true });
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
  res.json({ note: db.prepare('SELECT n.*, u.name as author_name, u.avatar as author_avatar, u.profile_photo_url as author_photo_url FROM notes n JOIN users u ON u.id = n.author_user_id WHERE n.id = ?').get(noteId) });
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
  db.prepare("UPDATE tickets SET assignee_user_id = ?, last_activity_at = ?, has_unread = 1, read_at = NULL, read_by_user_id = NULL WHERE assignee_user_id = ? AND status != 'CLOSED'").run(toUserId || null, Date.now(), fromUserId);
  saveDb();
  const fromUser = db.prepare('SELECT name FROM users WHERE id = ?').get(fromUserId);
  const toUser = toUserId ? db.prepare('SELECT name FROM users WHERE id = ?').get(toUserId) : null;
  addAudit(db, req.user.id, 'bulk_reassign', 'user', fromUserId, affected.length + ' tickets from ' + fromUser.name + ' -> ' + (toUser ? toUser.name : 'region queue'));
  res.json({ reassigned: affected.length });
});

// Bulk reassign specific tickets by ID (any authenticated user — coordinators can assign to self)
router.post('/bulk/reassign-selected', requireAuth, (req, res) => {
  const db = getDb();
  const { ticketIds, toUserId } = req.body;
  if (!ticketIds || !ticketIds.length) return res.status(400).json({ error: 'ticketIds required' });
  // Coordinators can only assign to themselves or unassign
  if (req.user.role === 'coordinator' && toUserId && toUserId !== req.user.id) {
    return res.status(403).json({ error: 'Coordinators can only assign tickets to themselves' });
  }
  let count = 0;
  for (const tid of ticketIds) {
    const now = Date.now();
    const r = db.prepare("UPDATE tickets SET assignee_user_id = ?, last_activity_at = ?, assigned_at = ?, has_unread = 1, read_at = NULL, read_by_user_id = NULL WHERE id = ? AND status != 'CLOSED'").run(toUserId || null, now, toUserId ? now : null, tid);
    if (r.changes) count++;
  }
  saveDb();
  const toUser = toUserId ? db.prepare('SELECT name FROM users WHERE id = ?').get(toUserId) : null;
  addAudit(db, req.user.id, 'bulk_reassign', 'tickets', ticketIds.join(','), count + ' tickets -> ' + (toUser ? toStr(toUser.name) : 'unassigned'));
  res.json({ reassigned: count });
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


// ── Time Tracking ──

// Get time entries for a ticket
router.get('/:id/time', requireAuth, (req, res) => {
  const db = getDb();
  const entries = db.prepare('SELECT te.*, u.name as user_name, u.avatar as user_avatar FROM time_entries te LEFT JOIN users u ON u.id = te.user_id WHERE te.ticket_id = ? ORDER BY te.started_at DESC').all(req.params.id);
  // Check if current user has a running clock on this ticket
  const running = db.prepare('SELECT * FROM time_entries WHERE ticket_id = ? AND user_id = ? AND stopped_at IS NULL').get(req.params.id, req.user.id);
  // Total time for this ticket
  // Only count completed entries in the total — running entry is shown live on client
  const totalMs = entries.reduce((sum, e) => sum + (e.stopped_at ? (e.duration_ms || e.stopped_at - e.started_at) : 0), 0);
  // Per-user breakdown
  const byUser = {};
  for (const e of entries) {
    const uid = toStr(e.user_id);
    const name = toStr(e.user_name) || 'Unknown';
    if (!byUser[uid]) byUser[uid] = { userId: uid, userName: name, userAvatar: toStr(e.user_avatar), totalMs: 0, entries: 0 };
    const dur = e.stopped_at ? (e.duration_ms || e.stopped_at - e.started_at) : 0;
    byUser[uid].totalMs += dur;
    byUser[uid].entries++;
  }
  res.json({
    entries: entries.map(e => ({
      id: toStr(e.id), ticketId: toStr(e.ticket_id), userId: toStr(e.user_id),
      userName: toStr(e.user_name), userAvatar: toStr(e.user_avatar),
      startedAt: e.started_at, stoppedAt: e.stopped_at,
      durationMs: e.duration_ms || (e.stopped_at ? e.stopped_at - e.started_at : null),
      note: toStr(e.note), running: !e.stopped_at,
    })),
    running: running ? { id: toStr(running.id), startedAt: running.started_at } : null,
    totalMs,
    byUser: Object.values(byUser).sort((a, b) => b.totalMs - a.totalMs),
  });
});

// Start clock
router.post('/:id/time/start', requireAuth, (req, res) => {
  const db = getDb();
  // Stop any existing running clock for this user on any ticket
  const existing = db.prepare('SELECT id, ticket_id, started_at FROM time_entries WHERE user_id = ? AND stopped_at IS NULL').get(req.user.id);
  if (existing) {
    const dur = Date.now() - existing.started_at;
    db.prepare('UPDATE time_entries SET stopped_at = ?, duration_ms = ? WHERE id = ?').run(Date.now(), dur, existing.id);
  }
  const id = 'te-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  db.prepare('INSERT INTO time_entries (id, ticket_id, user_id, started_at) VALUES (?, ?, ?, ?)').run(id, req.params.id, req.user.id, Date.now());
  saveDb();
  addAudit(db, req.user.id, 'clock_started', 'ticket', req.params.id, 'Started time clock');
  res.json({ id, startedAt: Date.now(), stoppedPrevious: existing ? toStr(existing.ticket_id) : null });
});

// Stop clock
router.post('/:id/time/stop', requireAuth, (req, res) => {
  const db = getDb();
  const { note } = req.body;
  const entry = db.prepare('SELECT * FROM time_entries WHERE ticket_id = ? AND user_id = ? AND stopped_at IS NULL').get(req.params.id, req.user.id);
  if (!entry) return res.status(400).json({ error: 'No running clock' });
  const now = Date.now();
  const dur = now - entry.started_at;
  db.prepare('UPDATE time_entries SET stopped_at = ?, duration_ms = ?, note = ? WHERE id = ?').run(now, dur, note || null, entry.id);
  saveDb();
  addAudit(db, req.user.id, 'clock_stopped', 'ticket', req.params.id, 'Stopped clock — ' + Math.round(dur / 60000) + ' min');
  res.json({ id: toStr(entry.id), durationMs: dur });
});

// Get current user's running clock (any ticket)
router.get('/my/active-clock', requireAuth, (req, res) => {
  const db = getDb();
  const entry = db.prepare('SELECT te.*, t.subject FROM time_entries te LEFT JOIN tickets t ON t.id = te.ticket_id WHERE te.user_id = ? AND te.stopped_at IS NULL').get(req.user.id);
  if (!entry) return res.json({ active: null });
  res.json({ active: { id: toStr(entry.id), ticketId: toStr(entry.ticket_id), subject: toStr(entry.subject), startedAt: entry.started_at } });
});

module.exports = router;
