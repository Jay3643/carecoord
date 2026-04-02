const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { getDb } = require('../database');
const { requireAuth, toStr } = require('../middleware');
const router = express.Router();

const TZ = 'America/New_York';
function fmtDate(ts) { return ts ? new Date(ts).toLocaleString('en-US', { timeZone: TZ }) : ''; }

function getClient() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  return new Anthropic.default({ apiKey: key });
}

// ══════════════════════════════════════════════════════════════════════
//  TOOLS — these are what the AI agent can call dynamically
// ══════════════════════════════════════════════════════════════════════

const TOOLS = [
  {
    name: 'search_tickets',
    description: 'Search and filter tickets in the Seniority Connect system. Can search by keyword, status, assignee, region, patient email, or tag. Returns matching tickets with key details.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free-text search query (searches subject, external participants, ticket ID)' },
        status: { type: 'string', enum: ['OPEN', 'WAITING_ON_EXTERNAL', 'CLOSED', 'all'], description: 'Filter by ticket status' },
        assignee_name: { type: 'string', description: 'Filter by assignee name (partial match)' },
        region_name: { type: 'string', description: 'Filter by region name (partial match)' },
        tag_name: { type: 'string', description: 'Filter by tag name' },
        unread_only: { type: 'boolean', description: 'Only return tickets with unread messages' },
        limit: { type: 'number', description: 'Max results to return (default 20, max 50)' },
      },
    },
  },
  {
    name: 'get_ticket_detail',
    description: 'Get complete details for a specific ticket including the full message thread, internal notes, tags, assignee info, and timestamps. Use this when you need to read a conversation or understand a specific case.',
    input_schema: {
      type: 'object',
      properties: {
        ticket_id: { type: 'string', description: 'The ticket ID (e.g. tk-1234567890-abcd)' },
      },
      required: ['ticket_id'],
    },
  },
  {
    name: 'get_patient_encounters',
    description: 'Find all tickets/encounters for a specific patient or contact by their email address or name. Cross-references across all tickets to build a patient history.',
    input_schema: {
      type: 'object',
      properties: {
        patient_email: { type: 'string', description: 'Patient or contact email address' },
        patient_name: { type: 'string', description: 'Patient or contact name (searches message bodies)' },
        limit: { type: 'number', description: 'Max encounters to return (default 10)' },
      },
    },
  },
  {
    name: 'search_emails',
    description: 'Search the current user\'s Gmail inbox. Can search by sender, subject, keyword, or Gmail search operators.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Gmail search query (e.g. "from:doctor@example.com", "subject:referral", "is:unread")' },
        limit: { type: 'number', description: 'Max emails to return (default 10, max 20)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_team_info',
    description: 'Get information about team members — who they are, their roles, regions, online status, workload (open ticket count). Use when asked about staff, workload, or team capacity.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Filter by name (partial match). Omit to get all team members.' },
        role: { type: 'string', enum: ['coordinator', 'supervisor', 'admin'], description: 'Filter by role' },
      },
    },
  },
  {
    name: 'get_queue_stats',
    description: 'Get statistics about the ticket queues — total counts by status, unassigned count, tickets per region, tickets per coordinator. Use when asked about workload, queue health, or operational metrics.',
    input_schema: {
      type: 'object',
      properties: {
        region_name: { type: 'string', description: 'Filter stats to a specific region (partial match). Omit for all regions.' },
      },
    },
  },
  {
    name: 'get_audit_log',
    description: 'Get recent activity/audit log entries. Shows who did what and when — assignments, status changes, logins, etc.',
    input_schema: {
      type: 'object',
      properties: {
        action_type: { type: 'string', description: 'Filter by action type (e.g. assignee_changed, status_changed, login, bulk_reassign)' },
        user_name: { type: 'string', description: 'Filter by actor name (partial match)' },
        limit: { type: 'number', description: 'Max entries to return (default 20, max 50)' },
      },
    },
  },
  {
    name: 'search_help',
    description: 'Search the Seniority Connect user manual and help documentation. Use when the user asks "how do I...", "where is...", "how to...", or any question about using the platform, features, buttons, settings, or workflows.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The help topic or question to search for (e.g. "how to reassign tickets", "what is the archive", "time tracking")' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_email_detail',
    description: 'Get the full body/content of a specific email from the user\'s Gmail by message ID. Use after search_emails to read an email\'s full content.',
    input_schema: {
      type: 'object',
      properties: {
        message_id: { type: 'string', description: 'Gmail message ID from a previous search_emails result' },
      },
      required: ['message_id'],
    },
  },
];

// ══════════════════════════════════════════════════════════════════════
//  TOOL IMPLEMENTATIONS
// ══════════════════════════════════════════════════════════════════════

function execTool(toolName, input, db, userId) {
  switch (toolName) {
    case 'search_tickets': return toolSearchTickets(db, input);
    case 'get_ticket_detail': return toolGetTicketDetail(db, input);
    case 'get_patient_encounters': return toolGetPatientEncounters(db, input);
    case 'search_emails': return toolSearchEmails(db, userId, input);
    case 'get_team_info': return toolGetTeamInfo(db, input);
    case 'get_queue_stats': return toolGetQueueStats(db, input);
    case 'get_audit_log': return toolGetAuditLog(db, input);
    case 'get_email_detail': return toolGetEmailDetail(db, userId, input);
    case 'search_help': return toolSearchHelp(input);
    default: return { error: 'Unknown tool: ' + toolName };
  }
}

function toolSearchTickets(db, { query, status, assignee_name, region_name, tag_name, unread_only, limit }) {
  const max = Math.min(limit || 20, 50);
  let where = [], params = [];

  if (query) {
    where.push("(t.subject LIKE ? OR t.external_participants LIKE ? OR t.id LIKE ? OR t.from_email LIKE ?)");
    const q = '%' + query + '%';
    params.push(q, q, q, q);
  }
  if (status && status !== 'all') { where.push('t.status = ?'); params.push(status); }
  if (unread_only) where.push('t.has_unread = 1');
  if (assignee_name) {
    where.push("t.assignee_user_id IN (SELECT id FROM users WHERE name LIKE ?)");
    params.push('%' + assignee_name + '%');
  }
  if (region_name) {
    where.push("t.region_id IN (SELECT id FROM regions WHERE name LIKE ?)");
    params.push('%' + region_name + '%');
  }
  if (tag_name) {
    where.push("t.id IN (SELECT tt.ticket_id FROM ticket_tags tt JOIN tags tg ON tg.id = tt.tag_id WHERE tg.name LIKE ?)");
    params.push('%' + tag_name + '%');
  }

  const sql = `SELECT t.id, t.subject, t.status, t.external_participants, t.assignee_user_id, t.region_id,
    t.last_activity_at, t.created_at, t.has_unread, t.from_email, t.assigned_at,
    (SELECT COUNT(*) FROM messages WHERE ticket_id = t.id) as msg_count
    FROM tickets t ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY t.last_activity_at DESC LIMIT ?`;
  params.push(max);

  const tickets = db.prepare(sql).all(...params);
  return tickets.map(t => {
    const assignee = t.assignee_user_id ? db.prepare('SELECT name FROM users WHERE id = ?').get(t.assignee_user_id) : null;
    const region = t.region_id ? db.prepare('SELECT name FROM regions WHERE id = ?').get(t.region_id) : null;
    const tags = db.prepare('SELECT tg.name FROM tags tg JOIN ticket_tags tt ON tt.tag_id = tg.id WHERE tt.ticket_id = ?').all(t.id);
    return {
      id: toStr(t.id), subject: toStr(t.subject), status: toStr(t.status),
      from: (JSON.parse(toStr(t.external_participants) || '[]'))[0] || toStr(t.from_email) || '?',
      assignee: assignee ? toStr(assignee.name) : 'Unassigned',
      region: region ? toStr(region.name) : '?',
      tags: tags.map(tg => toStr(tg.name)),
      msg_count: t.msg_count,
      has_unread: !!t.has_unread,
      created: t.created_at ? fmtDate(t.created_at) : '?',
      assigned: t.assigned_at ? fmtDate(t.assigned_at) : null,
      last_activity: t.last_activity_at ? fmtDate(t.last_activity_at) : '?',
    };
  });
}

function toolGetTicketDetail(db, { ticket_id }) {
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticket_id);
  if (!ticket) return { error: 'Ticket not found: ' + ticket_id };

  const messages = db.prepare('SELECT * FROM messages WHERE ticket_id = ? ORDER BY sent_at ASC').all(ticket_id);
  const notes = db.prepare('SELECT n.*, u.name as author_name FROM notes n LEFT JOIN users u ON u.id = n.author_user_id WHERE n.ticket_id = ? ORDER BY n.created_at ASC').all(ticket_id);
  const tags = db.prepare('SELECT t.name FROM tags t JOIN ticket_tags tt ON tt.tag_id = t.id WHERE tt.ticket_id = ?').all(ticket_id);
  const assignee = ticket.assignee_user_id ? db.prepare('SELECT name, email FROM users WHERE id = ?').get(ticket.assignee_user_id) : null;
  const region = ticket.region_id ? db.prepare('SELECT name FROM regions WHERE id = ?').get(ticket.region_id) : null;

  return {
    id: toStr(ticket.id),
    subject: toStr(ticket.subject),
    status: toStr(ticket.status),
    region: region ? toStr(region.name) : null,
    assignee: assignee ? { name: toStr(assignee.name), email: toStr(assignee.email) } : null,
    tags: tags.map(t => toStr(t.name)),
    external_participants: JSON.parse(toStr(ticket.external_participants) || '[]'),
    created: ticket.created_at ? fmtDate(ticket.created_at) : null,
    assigned: ticket.assigned_at ? fmtDate(ticket.assigned_at) : null,
    last_activity: ticket.last_activity_at ? fmtDate(ticket.last_activity_at) : null,
    messages: messages.map(m => ({
      direction: toStr(m.direction) === 'inbound' ? 'FROM EXTERNAL' : 'OUTBOUND (us)',
      from: toStr(m.from_address) || '',
      to: toStr(m.to_addresses) || '',
      date: m.sent_at ? fmtDate(m.sent_at) : '',
      body: toStr(m.body_text) || toStr(m.body) || '',
    })),
    notes: notes.map(n => ({
      author: toStr(n.author_name) || '?',
      date: n.created_at ? fmtDate(n.created_at) : '',
      body: toStr(n.body),
    })),
  };
}

function toolGetPatientEncounters(db, { patient_email, patient_name, limit }) {
  const max = Math.min(limit || 10, 30);
  let tickets = [];

  if (patient_email) {
    tickets = db.prepare("SELECT * FROM tickets WHERE external_participants LIKE ? OR from_email LIKE ? ORDER BY last_activity_at DESC LIMIT ?")
      .all('%' + patient_email + '%', '%' + patient_email + '%', max);
  }
  if (patient_name && tickets.length === 0) {
    // Search message bodies for the patient name
    const msgTicketIds = db.prepare("SELECT DISTINCT ticket_id FROM messages WHERE body_text LIKE ? OR body LIKE ? LIMIT ?")
      .all('%' + patient_name + '%', '%' + patient_name + '%', max);
    if (msgTicketIds.length > 0) {
      const ids = msgTicketIds.map(m => toStr(m.ticket_id));
      const ph = ids.map(() => '?').join(',');
      tickets = db.prepare(`SELECT * FROM tickets WHERE id IN (${ph}) ORDER BY last_activity_at DESC`).all(...ids);
    }
  }

  return tickets.map(t => {
    const msgs = db.prepare('SELECT direction, from_address, body_text, body, sent_at FROM messages WHERE ticket_id = ? ORDER BY sent_at ASC').all(t.id);
    const assignee = t.assignee_user_id ? db.prepare('SELECT name FROM users WHERE id = ?').get(t.assignee_user_id) : null;
    return {
      id: toStr(t.id), subject: toStr(t.subject), status: toStr(t.status),
      assignee: assignee ? toStr(assignee.name) : 'Unassigned',
      created: t.created_at ? fmtDate(t.created_at) : '?',
      message_count: msgs.length,
      last_message_preview: msgs.length > 0 ? (toStr(msgs[msgs.length - 1].body_text) || toStr(msgs[msgs.length - 1].body) || '').substring(0, 200) : '',
    };
  });
}

async function toolSearchEmails(db, userId, { query, limit }) {
  try {
    const { google } = require('googleapis');
    const max = Math.min(limit || 10, 20);
    const auth = getGmailAuth(db, userId);
    if (!auth) return { error: 'Gmail not connected for this user' };

    const gm = google.gmail({ version: 'v1', auth });
    const list = await gm.users.messages.list({ userId: 'me', q: query, maxResults: max });
    if (!list.data.messages) return [];

    const results = await Promise.allSettled(
      list.data.messages.map(m =>
        gm.users.messages.get({ userId: 'me', id: m.id, format: 'METADATA', metadataHeaders: ['From', 'To', 'Subject', 'Date'] })
      )
    );

    return results.filter(r => r.status === 'fulfilled').map(r => {
      const msg = r.value.data;
      const h = msg.payload?.headers || [];
      const hdr = (name) => { const f = h.find(x => x.name === name); return f ? f.value : ''; };
      return {
        message_id: msg.id,
        from: hdr('From'), to: hdr('To'), subject: hdr('Subject'), date: hdr('Date'),
        snippet: msg.snippet?.substring(0, 150) || '',
        is_unread: (msg.labelIds || []).includes('UNREAD'),
      };
    });
  } catch (e) {
    return { error: 'Gmail search failed: ' + e.message };
  }
}

async function toolGetEmailDetail(db, userId, { message_id }) {
  try {
    const { google } = require('googleapis');
    const auth = getGmailAuth(db, userId);
    if (!auth) return { error: 'Gmail not connected for this user' };

    const gm = google.gmail({ version: 'v1', auth });
    const msg = await gm.users.messages.get({ userId: 'me', id: message_id, format: 'FULL' });
    const h = msg.data.payload?.headers || [];
    const hdr = (name) => { const f = h.find(x => x.name === name); return f ? f.value : ''; };

    // Extract body
    let body = '';
    function extractBody(part) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        body += Buffer.from(part.body.data, 'base64').toString('utf8');
      } else if (part.parts) {
        part.parts.forEach(extractBody);
      }
    }
    extractBody(msg.data.payload);
    if (!body && msg.data.snippet) body = msg.data.snippet;

    return {
      message_id: msg.data.id,
      from: hdr('From'), to: hdr('To'), subject: hdr('Subject'), date: hdr('Date'),
      body: body.substring(0, 5000),
    };
  } catch (e) {
    return { error: 'Failed to fetch email: ' + e.message };
  }
}

function toolGetTeamInfo(db, { name, role }) {
  let where = ['is_active = 1'], params = [];
  if (name) { where.push('name LIKE ?'); params.push('%' + name + '%'); }
  if (role) { where.push('role = ?'); params.push(role); }

  const users = db.prepare(`SELECT id, name, email, role, work_status FROM users WHERE ${where.join(' AND ')} ORDER BY name`).all(...params);
  const now = Date.now();
  return users.map(u => {
    const regions = db.prepare('SELECT r.name FROM regions r JOIN user_regions ur ON ur.region_id = r.id WHERE ur.user_id = ?').all(u.id);
    const openTickets = db.prepare("SELECT COUNT(*) as n FROM tickets WHERE assignee_user_id = ? AND status != 'CLOSED'").get(u.id);
    const session = db.prepare('SELECT 1 FROM sessions WHERE user_id = ? AND expires > ?').get(u.id, now);
    return {
      name: toStr(u.name), email: toStr(u.email), role: toStr(u.role),
      work_status: toStr(u.work_status) || 'active',
      regions: regions.map(r => toStr(r.name)),
      open_tickets: openTickets?.n || 0,
      online: !!session,
    };
  });
}

function toolGetQueueStats(db, { region_name }) {
  let regionFilter = '';
  let params = [];
  if (region_name) {
    const region = db.prepare('SELECT id FROM regions WHERE name LIKE ?').get('%' + region_name + '%');
    if (region) { regionFilter = ' AND region_id = ?'; params.push(toStr(region.id)); }
  }

  const total = db.prepare("SELECT COUNT(*) as n FROM tickets WHERE 1=1" + regionFilter).get(...params);
  const open = db.prepare("SELECT COUNT(*) as n FROM tickets WHERE status = 'OPEN'" + regionFilter).get(...params);
  const waiting = db.prepare("SELECT COUNT(*) as n FROM tickets WHERE status = 'WAITING_ON_EXTERNAL'" + regionFilter).get(...params);
  const closed = db.prepare("SELECT COUNT(*) as n FROM tickets WHERE status = 'CLOSED'" + regionFilter).get(...params);
  const unassigned = db.prepare("SELECT COUNT(*) as n FROM tickets WHERE assignee_user_id IS NULL AND status != 'CLOSED'" + regionFilter).get(...params);
  const unread = db.prepare("SELECT COUNT(*) as n FROM tickets WHERE has_unread = 1 AND status != 'CLOSED'" + regionFilter).get(...params);

  // Per-region breakdown
  const regions = db.prepare("SELECT r.name, COUNT(t.id) as ticket_count, SUM(CASE WHEN t.assignee_user_id IS NULL AND t.status != 'CLOSED' THEN 1 ELSE 0 END) as unassigned FROM regions r LEFT JOIN tickets t ON t.region_id = r.id WHERE r.is_active = 1 GROUP BY r.id ORDER BY ticket_count DESC").all();

  // Per-coordinator breakdown
  const coordinators = db.prepare("SELECT u.name, COUNT(t.id) as ticket_count FROM users u LEFT JOIN tickets t ON t.assignee_user_id = u.id AND t.status != 'CLOSED' WHERE u.role = 'coordinator' AND u.is_active = 1 GROUP BY u.id ORDER BY ticket_count DESC").all();

  return {
    total: total?.n || 0, open: open?.n || 0, waiting: waiting?.n || 0,
    closed: closed?.n || 0, unassigned: unassigned?.n || 0, unread: unread?.n || 0,
    by_region: regions.map(r => ({ region: toStr(r.name), tickets: r.ticket_count, unassigned: r.unassigned })),
    by_coordinator: coordinators.map(c => ({ name: toStr(c.name), open_tickets: c.ticket_count })),
  };
}

function toolGetAuditLog(db, { action_type, user_name, limit }) {
  const max = Math.min(limit || 20, 50);
  let where = [], params = [];
  if (action_type) { where.push('a.action_type = ?'); params.push(action_type); }
  if (user_name) { where.push('u.name LIKE ?'); params.push('%' + user_name + '%'); }

  const sql = `SELECT a.*, u.name as actor_name FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.ts DESC LIMIT ?`;
  params.push(max);

  return db.prepare(sql).all(...params).map(a => ({
    timestamp: a.ts ? fmtDate(Number(toStr(a.ts))) : '?',
    actor: toStr(a.actor_name) || '?',
    action: toStr(a.action_type),
    entity: toStr(a.entity_type) + ':' + toStr(a.entity_id),
    detail: toStr(a.detail),
  }));
}

// ── Help / User Manual search ──
let helpSections = null;

function loadHelpContent() {
  if (helpSections) return helpSections;
  const fs = require('fs');
  const path = require('path');
  // Try multiple paths for the user manual
  const paths = [
    path.join(__dirname, '..', '..', 'docs', 'user-manual.html'),
    path.join(__dirname, '..', '..', 'client', 'public', 'guides', 'admin-guide.html'),
    path.join(__dirname, '..', '..', 'client', 'dist', 'user-manual.html'),
  ];
  let html = '';
  for (const p of paths) {
    try { html += '\n' + fs.readFileSync(p, 'utf8'); } catch(e) {}
  }
  if (!html) return [];
  // Split by h2/h3 headers and strip HTML tags
  const sections = [];
  const headerRegex = /<h[23][^>]*>(.*?)<\/h[23]>/gi;
  const parts = html.split(headerRegex);
  for (let i = 1; i < parts.length; i += 2) {
    const title = parts[i].replace(/<[^>]+>/g, '').trim();
    const body = (parts[i + 1] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (title && body.length > 20) {
      sections.push({ title, content: body.substring(0, 1500) });
    }
  }
  helpSections = sections;
  return sections;
}

function toolSearchHelp({ query }) {
  const sections = loadHelpContent();
  if (sections.length === 0) return { error: 'Help content not available' };
  const q = query.toLowerCase();
  const words = q.split(/\s+/).filter(w => w.length > 2);
  // Score each section by keyword matches
  const scored = sections.map(s => {
    const text = (s.title + ' ' + s.content).toLowerCase();
    let score = 0;
    for (const w of words) {
      if (text.includes(w)) score += 1;
      if (s.title.toLowerCase().includes(w)) score += 3; // Title match weighted higher
    }
    return { ...s, score };
  }).filter(s => s.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);
  if (scored.length === 0) {
    return { message: 'No help content found for "' + query + '". Try different keywords.', availableTopics: sections.slice(0, 20).map(s => s.title) };
  }
  return scored.map(s => ({ title: s.title, content: s.content }));
}

// Helper: get Gmail auth for a user
function getGmailAuth(db, userId) {
  const { google } = require('googleapis');
  const user = db.prepare('SELECT email FROM users WHERE id = ?').get(userId);
  if (!user) return null;
  const email = toStr(user.email);

  if (process.env.SA_CLIENT_EMAIL && process.env.SA_PRIVATE_KEY) {
    return new google.auth.JWT({
      email: process.env.SA_CLIENT_EMAIL, key: process.env.SA_PRIVATE_KEY,
      scopes: ['https://www.googleapis.com/auth/gmail.readonly'], subject: email,
    });
  }
  const t = db.prepare('SELECT * FROM gmail_tokens WHERE user_id = ?').get(userId);
  if (t && t.access_token) {
    const c = new google.auth.OAuth2(process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET, process.env.GMAIL_REDIRECT_URI);
    c.setCredentials({ access_token: toStr(t.access_token), refresh_token: toStr(t.refresh_token), expiry_date: t.expiry_date });
    return c;
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════════
//  AGENTIC SYSTEM PROMPT
// ══════════════════════════════════════════════════════════════════════

const SYSTEM_PROMPT = `You are Seniority AI, an intelligent care coordination assistant for Seniority Healthcare. You are AGENTIC — you can dynamically fetch information from the Seniority Connect system using your tools rather than relying on pre-loaded data.

TIMEZONE: All timestamps in the system are in Eastern Time (ET / America/New_York). When reporting dates and times to the user, always present them in Eastern Time.

IMPORTANT BEHAVIORS:
- When the user asks about tickets, patients, encounters, emails, or team info — USE YOUR TOOLS to look it up in real-time. Do NOT guess or say you don't have access.
- You can chain multiple tool calls: search first to find what you need, then get details.
- For patient history: search by email or name to find all related encounters.
- For workload questions: use get_queue_stats and get_team_info.
- For email questions: use search_emails then get_email_detail to read full messages.
- For audit/activity: use get_audit_log.
- For "how do I..." or platform help questions: use search_help to find relevant documentation.

CAPABILITIES:
- Search and read any ticket, its full message thread, and internal notes
- Find all encounters/tickets for a specific patient
- Search the user's Gmail inbox and read full email content
- Check team workload, online status, and capacity
- View audit logs and recent activity
- Cross-reference information across tickets and emails
- Extract patient information (name, DOB, insurance, medications, diagnoses)
- Draft professional reply emails
- Summarize conversations and suggest next actions
- Search the user manual to answer "how to" questions about the platform

GUIDELINES:
- Be concise and actionable
- Use medical terminology appropriately but keep language clear
- When referencing tickets, always include the ticket ID
- Flag urgent or time-sensitive items
- If information genuinely doesn't exist in the system, say so
- When asked to "go to" or "check" something, use the appropriate tool to fetch that data
- Structure responses clearly with relevant details`;

// ══════════════════════════════════════════════════════════════════════
//  AGENTIC CHAT — tool use loop
// ══════════════════════════════════════════════════════════════════════

const MAX_TOOL_ROUNDS = 8;

router.post('/chat', requireAuth, async (req, res) => {
  const client = getClient();
  if (!client) return res.status(500).json({ error: 'AI not configured. Set ANTHROPIC_API_KEY in environment.' });

  const db = getDb();
  const { message, history } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'Message required' });

  try {
    // Build current user context (lightweight — just who they are)
    const user = db.prepare('SELECT name, email, role FROM users WHERE id = ?').get(req.user.id);
    const userCtx = user ? `Current user: ${toStr(user.name)} (${toStr(user.role)}) — ${toStr(user.email)}` : '';

    const msgs = [];
    if (history && history.length > 0) {
      for (const h of history) msgs.push({ role: h.role, content: h.content });
    }

    // First message includes lightweight user context
    if (!history || history.length === 0) {
      msgs.push({ role: 'user', content: `${userCtx}\n\n${message}` });
    } else {
      msgs.push({ role: 'user', content: message });
    }

    // Tool use loop — keep going until the agent gives a final text response
    let toolsUsed = [];
    let rounds = 0;

    while (rounds < MAX_TOOL_ROUNDS) {
      rounds++;

      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages: msgs,
      });

      // Check if the response contains tool calls
      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
      const textBlocks = response.content.filter(b => b.type === 'text');

      if (toolUseBlocks.length === 0) {
        // No tool calls — we have a final response
        const reply = textBlocks.map(b => b.text).join('\n') || 'No response generated.';
        return res.json({ reply, tools_used: toolsUsed });
      }

      // Add the assistant's response (with tool_use blocks) to the conversation
      msgs.push({ role: 'assistant', content: response.content });

      // Execute each tool call and add results
      const toolResults = [];
      for (const toolBlock of toolUseBlocks) {
        const toolName = toolBlock.name;
        const toolInput = toolBlock.input;
        toolsUsed.push(toolName);

        let result;
        try {
          // Some tools are async (email)
          result = await Promise.resolve(execTool(toolName, toolInput, db, req.user.id));
        } catch (e) {
          result = { error: 'Tool execution failed: ' + e.message };
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolBlock.id,
          content: JSON.stringify(result).substring(0, 20000), // Cap tool output size
        });
      }

      msgs.push({ role: 'user', content: toolResults });
    }

    // If we hit max rounds, return whatever text we have
    res.json({ reply: 'I performed multiple lookups but reached the limit. Please ask a more specific question.', tools_used: toolsUsed });

  } catch (e) {
    console.error('[AI] Error:', e.message);
    res.status(500).json({ error: 'AI request failed: ' + e.message });
  }
});

// ══════════════════════════════════════════════════════════════════════
//  TICKET-SCOPED AGENTIC CHAT (same tools but ticket context included)
// ══════════════════════════════════════════════════════════════════════

router.post('/ticket/:ticketId/chat', requireAuth, async (req, res) => {
  const client = getClient();
  if (!client) return res.status(500).json({ error: 'AI not configured. Set ANTHROPIC_API_KEY in environment.' });

  const db = getDb();
  const { message, history } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'Message required' });

  try {
    const user = db.prepare('SELECT name, email, role FROM users WHERE id = ?').get(req.user.id);
    const userCtx = user ? `Current user: ${toStr(user.name)} (${toStr(user.role)}) — ${toStr(user.email)}` : '';

    // Auto-fetch the ticket context for the first message
    const ticketDetail = toolGetTicketDetail(db, { ticket_id: req.params.ticketId });

    const msgs = [];
    if (history && history.length > 0) {
      for (const h of history) msgs.push({ role: h.role, content: h.content });
    }

    if (!history || history.length === 0) {
      msgs.push({ role: 'user', content: `${userCtx}\n\nCurrent ticket context:\n${JSON.stringify(ticketDetail, null, 2).substring(0, 8000)}\n\n${message}` });
    } else {
      msgs.push({ role: 'user', content: message });
    }

    let toolsUsed = [];
    let rounds = 0;

    while (rounds < MAX_TOOL_ROUNDS) {
      rounds++;

      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages: msgs,
      });

      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
      const textBlocks = response.content.filter(b => b.type === 'text');

      if (toolUseBlocks.length === 0) {
        const reply = textBlocks.map(b => b.text).join('\n') || 'No response generated.';
        return res.json({ reply, tools_used: toolsUsed });
      }

      msgs.push({ role: 'assistant', content: response.content });

      const toolResults = [];
      for (const toolBlock of toolUseBlocks) {
        toolsUsed.push(toolBlock.name);
        let result;
        try {
          result = await Promise.resolve(execTool(toolBlock.name, toolBlock.input, db, req.user.id));
        } catch (e) {
          result = { error: 'Tool execution failed: ' + e.message };
        }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolBlock.id,
          content: JSON.stringify(result).substring(0, 20000),
        });
      }
      msgs.push({ role: 'user', content: toolResults });
    }

    res.json({ reply: 'Reached tool call limit. Please be more specific.', tools_used: toolsUsed });
  } catch (e) {
    console.error('[AI] Error:', e.message);
    res.status(500).json({ error: 'AI request failed: ' + e.message });
  }
});

// ══════════════════════════════════════════════════════════════════════
//  EXISTING ENDPOINTS (kept for quick actions)
// ══════════════════════════════════════════════════════════════════════

function getTicketContext(db, ticketId) {
  const result = toolGetTicketDetail(db, { ticket_id: ticketId });
  if (result.error) return null;
  // Convert to legacy format for quick actions
  let context = `\nTicket: ${result.id} — "${result.subject}"\n`;
  context += `Status: ${result.status} | Region: ${result.region || 'N/A'} | Tags: ${result.tags.join(', ') || 'none'}\n`;
  context += `Assignee: ${result.assignee ? result.assignee.name : 'Unassigned'}\n\n`;
  context += '--- MESSAGE THREAD ---\n';
  for (const m of result.messages) {
    context += `\n[${m.direction}] ${m.from} — ${m.date}\n${m.body}\n`;
  }
  if (result.notes.length > 0) {
    context += '\n--- INTERNAL NOTES ---\n';
    for (const n of result.notes) context += `\n[NOTE by ${n.author}] ${n.date}\n${n.body}\n`;
  }
  return { ticket: result, context };
}

// Clinical Snapshot
router.post('/clinical-snapshot', requireAuth, async (req, res) => {
  const client = getClient();
  if (!client) return res.status(500).json({ error: 'AI not configured. Set ANTHROPIC_API_KEY in environment.' });
  const { chartData } = req.body;
  if (!chartData) return res.status(400).json({ error: 'chartData required' });
  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 3000,
      system: `You are a care coordinator at Seniority Healthcare writing a brief clinical overview of a patient. Write it as a short, readable narrative — the kind of summary you'd give a colleague in 60 seconds.
Format: 2-4 short paragraphs, no headers, no bullet points, no markdown formatting. Include: who the patient is, primary conditions, current medications, care team, recent activity, concerns, advance directives if relevant. Keep it under 300 words.`,
      messages: [{ role: 'user', content: `Generate a Clinical Snapshot:\n\n${JSON.stringify(chartData, null, 2).substring(0, 8000)}` }],
    });
    res.json({ snapshot: response.content[0]?.text || '' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Proactive suggestions
router.post('/suggestions', requireAuth, async (req, res) => {
  const client = getClient();
  if (!client) return res.status(500).json({ error: 'AI not configured.' });
  const db = getDb();
  // Lightweight context for suggestions
  const user = db.prepare('SELECT name, role FROM users WHERE id = ?').get(req.user.id);
  const stats = toolGetQueueStats(db, {});
  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 512,
      system: `Generate 3-5 brief, actionable suggestions for a care coordination user. Each should be one short sentence (under 15 words). Return ONLY a JSON array of strings.`,
      messages: [{ role: 'user', content: `User: ${toStr(user?.name)} (${toStr(user?.role)})\nQueue stats: ${JSON.stringify(stats)}` }],
    });
    const text = response.content[0]?.text || '[]';
    const match = text.match(/\[[\s\S]*\]/);
    res.json({ suggestions: match ? JSON.parse(match[0]) : [] });
  } catch (e) { res.json({ suggestions: [] }); }
});

// Quick actions (kept as-is, use legacy context format)
router.post('/ticket/:ticketId/summarize', requireAuth, async (req, res) => {
  const client = getClient();
  if (!client) return res.status(500).json({ error: 'AI not configured.' });
  const db = getDb();
  const ticketData = getTicketContext(db, req.params.ticketId);
  if (!ticketData) return res.status(404).json({ error: 'Ticket not found' });
  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 1024, system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Summarize this ticket concisely. Include: key issue, current status, who's involved, pending actions.\n\n${ticketData.context}` }],
    });
    res.json({ result: response.content[0]?.text || '' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/ticket/:ticketId/extract-patient', requireAuth, async (req, res) => {
  const client = getClient();
  if (!client) return res.status(500).json({ error: 'AI not configured.' });
  const db = getDb();
  const ticketData = getTicketContext(db, req.params.ticketId);
  if (!ticketData) return res.status(404).json({ error: 'Ticket not found' });
  const extP = ticketData.ticket.external_participants || [];
  let crossRef = '';
  if (extP[0]) {
    const related = db.prepare("SELECT id, subject, status FROM tickets WHERE external_participants LIKE ? AND id != ? ORDER BY last_activity_at DESC LIMIT 5")
      .all('%' + extP[0] + '%', toStr(ticketData.ticket.id));
    if (related.length > 0) {
      crossRef = '\n\nRELATED TICKETS:\n';
      for (const r of related) {
        const rMsgs = db.prepare('SELECT body_text FROM messages WHERE ticket_id = ? ORDER BY sent_at DESC LIMIT 3').all(r.id);
        crossRef += `[${toStr(r.id)}] "${toStr(r.subject)}" (${toStr(r.status)})\n`;
        for (const rm of rMsgs) crossRef += (toStr(rm.body_text) || '').substring(0, 300) + '\n';
      }
    }
  }
  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 1024, system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Extract ALL patient information. Structure as: **Patient Name:**, **DOB:**, **Insurance:**, **Member ID:**, **Phone:**, **Address:**, **Diagnoses:**, **Medications:**, **Providers:**, **Referrals:**, **Other:**\n\nIf not mentioned, write "Not found".\n\n${ticketData.context}${crossRef}` }],
    });
    res.json({ result: response.content[0]?.text || '' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/ticket/:ticketId/draft-reply', requireAuth, async (req, res) => {
  const client = getClient();
  if (!client) return res.status(500).json({ error: 'AI not configured.' });
  const db = getDb();
  const ticketData = getTicketContext(db, req.params.ticketId);
  if (!ticketData) return res.status(404).json({ error: 'Ticket not found' });
  const user = db.prepare('SELECT name FROM users WHERE id = ?').get(req.user.id);
  const { instructions } = req.body;
  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 1024, system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Draft a professional reply for ${toStr(user?.name)} at Seniority Healthcare.\n${instructions ? 'Instructions: ' + instructions + '\n' : ''}Write ONLY the email body (no signature). Be professional and concise.\n\n${ticketData.context}` }],
    });
    res.json({ result: response.content[0]?.text || '' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/ticket/:ticketId/suggest-tags', requireAuth, async (req, res) => {
  const client = getClient();
  if (!client) return res.status(500).json({ error: 'AI not configured.' });
  const db = getDb();
  const ticketData = getTicketContext(db, req.params.ticketId);
  if (!ticketData) return res.status(404).json({ error: 'Ticket not found' });
  const tagNames = db.prepare('SELECT name FROM tags').all().map(t => toStr(t.name));
  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 256, system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Which of these tags apply? Available: ${tagNames.join(', ')}\n\nReturn ONLY a comma-separated list. If none, say "None".\n\n${ticketData.context}` }],
    });
    res.json({ result: response.content[0]?.text || '' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Draft email (compose)
router.post('/draft-email', requireAuth, async (req, res) => {
  const client = getClient();
  if (!client) return res.status(500).json({ error: 'AI not configured.' });
  const db = getDb();
  const user = db.prepare('SELECT name FROM users WHERE id = ?').get(req.user.id);
  const { instructions, to, subject } = req.body;
  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 1024, system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Draft email for ${toStr(user?.name)} at Seniority Healthcare.\nTo: ${to || '?'}\nSubject: ${subject || '?'}\nInstructions: ${instructions || 'Write an appropriate email'}\n\nWrite ONLY the body. Be professional and concise.` }],
    });
    res.json({ result: response.content[0]?.text || '' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Draft email reply (for personal inbox)
router.post('/draft-email-reply', requireAuth, async (req, res) => {
  const client = getClient();
  if (!client) return res.status(500).json({ error: 'AI not configured.' });
  const db = getDb();
  const user = db.prepare('SELECT name FROM users WHERE id = ?').get(req.user.id);
  const { from, subject, body, instructions } = req.body;
  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 1024, system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Draft a professional reply for ${toStr(user?.name)} at Seniority Healthcare.\n\nOriginal email:\nFrom: ${from || '?'}\nSubject: ${subject || '?'}\nBody:\n${body || '(empty)'}\n\n${instructions ? 'Instructions: ' + instructions + '\n\n' : ''}Write ONLY the reply body. No signature.` }],
    });
    res.json({ result: response.content[0]?.text || '' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
