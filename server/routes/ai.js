const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { getDb } = require('../database');
const { requireAuth, toStr } = require('../middleware');
const router = express.Router();

function getClient() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  return new Anthropic.default({ apiKey: key });
}

// ── Build full system context from all areas ──
function getSystemContext(db, userId) {
  let ctx = '';

  // Current user
  const user = db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(userId);
  if (user) ctx += `CURRENT USER: ${toStr(user.name)} (${toStr(user.role)}) — ${toStr(user.email)}\n\n`;

  // All active users and their roles
  const users = db.prepare('SELECT id, name, email, role, work_status FROM users WHERE is_active = 1 ORDER BY name').all();
  ctx += '── TEAM MEMBERS ──\n';
  for (const u of users) {
    const regions = db.prepare('SELECT r.name FROM regions r JOIN user_regions ur ON ur.region_id = r.id WHERE ur.user_id = ?').all(u.id);
    ctx += `${toStr(u.name)} | ${toStr(u.role)} | ${toStr(u.email)} | Status: ${toStr(u.work_status) || 'active'} | Regions: ${regions.map(r => toStr(r.name)).join(', ') || 'none'}\n`;
  }

  // Regions
  const regions = db.prepare('SELECT id, name, routing_aliases FROM regions WHERE is_active = 1').all();
  ctx += '\n── REGIONS ──\n';
  for (const r of regions) {
    const aliases = JSON.parse(toStr(r.routing_aliases) || '[]');
    ctx += `${toStr(r.name)} (${toStr(r.id)}) — Aliases: ${aliases.join(', ') || 'none'}\n`;
  }

  // Tags
  const tags = db.prepare('SELECT name, color FROM tags').all();
  ctx += '\n── TAGS ──\n' + tags.map(t => toStr(t.name)).join(', ') + '\n';

  // All tickets summary (last 100)
  const tickets = db.prepare(`
    SELECT t.id, t.subject, t.status, t.external_participants, t.assignee_user_id, t.region_id, t.last_activity_at, t.created_at, t.has_unread, t.from_email,
      (SELECT COUNT(*) FROM messages WHERE ticket_id = t.id) as msg_count
    FROM tickets t ORDER BY t.last_activity_at DESC LIMIT 100
  `).all();
  ctx += '\n── ALL TICKETS (most recent 100) ──\n';
  for (const t of tickets) {
    const assignee = t.assignee_user_id ? db.prepare('SELECT name FROM users WHERE id = ?').get(t.assignee_user_id) : null;
    const region = t.region_id ? db.prepare('SELECT name FROM regions WHERE id = ?').get(t.region_id) : null;
    const tTags = db.prepare('SELECT tg.name FROM tags tg JOIN ticket_tags tt ON tt.tag_id = tg.id WHERE tt.ticket_id = ?').all(t.id);
    const extP = JSON.parse(toStr(t.external_participants) || '[]');
    ctx += `${toStr(t.id)} | "${toStr(t.subject)}" | ${toStr(t.status)} | From: ${extP[0] || toStr(t.from_email) || '?'} | Assigned: ${assignee ? toStr(assignee.name) : 'Unassigned'} | Region: ${region ? toStr(region.name) : '?'} | Tags: ${tTags.map(tg => toStr(tg.name)).join(',') || '-'} | Msgs: ${t.msg_count} | ${t.has_unread ? 'UNREAD' : 'read'} | Last: ${t.last_activity_at ? new Date(t.last_activity_at).toLocaleDateString() : '?'}\n`;
  }

  // Recent audit log (last 30)
  const audits = db.prepare('SELECT a.*, u.name as actor_name FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id ORDER BY a.ts DESC LIMIT 30').all();
  if (audits.length > 0) {
    ctx += '\n── RECENT AUDIT LOG (last 30) ──\n';
    for (const a of audits) {
      ctx += `${a.ts ? new Date(Number(toStr(a.ts))).toLocaleString() : '?'} | ${toStr(a.actor_name) || '?'} | ${toStr(a.action_type)} | ${toStr(a.detail)}\n`;
    }
  }

  return ctx;
}

function getTicketContext(db, ticketId) {
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
  if (!ticket) return null;

  const messages = db.prepare('SELECT * FROM messages WHERE ticket_id = ? ORDER BY sent_at ASC').all(ticketId);
  const notes = db.prepare('SELECT n.*, u.name as author_name FROM notes n LEFT JOIN users u ON u.id = n.author_user_id WHERE n.ticket_id = ? ORDER BY n.created_at ASC').all(ticketId);
  const tags = db.prepare('SELECT t.name FROM tags t JOIN ticket_tags tt ON tt.tag_id = t.id WHERE tt.ticket_id = ?').all(ticketId);
  const assignee = ticket.assignee_user_id ? db.prepare('SELECT name, email FROM users WHERE id = ?').get(ticket.assignee_user_id) : null;
  const region = ticket.region_id ? db.prepare('SELECT name FROM regions WHERE id = ?').get(ticket.region_id) : null;

  let context = `\n── FOCUSED TICKET: ${toStr(ticket.id)} ──\n`;
  context += `Subject: ${toStr(ticket.subject)}\n`;
  context += `Status: ${toStr(ticket.status)} | Region: ${region ? toStr(region.name) : 'N/A'} | Tags: ${tags.map(t => toStr(t.name)).join(', ') || 'none'}\n`;
  context += `External participants: ${toStr(ticket.external_participants)}\n`;
  context += `Assigned to: ${assignee ? toStr(assignee.name) + ' (' + toStr(assignee.email) + ')' : 'Unassigned'}\n`;
  context += `Created: ${new Date(ticket.created_at).toLocaleString()} | Last activity: ${new Date(ticket.last_activity_at).toLocaleString()}\n\n`;

  context += '--- MESSAGE THREAD ---\n';
  for (const m of messages) {
    const dir = toStr(m.direction) === 'inbound' ? 'FROM EXTERNAL' : 'OUTBOUND (us)';
    const from = toStr(m.from_address) || '';
    const body = toStr(m.body_text) || toStr(m.body) || '';
    const date = m.sent_at ? new Date(m.sent_at).toLocaleString() : '';
    context += `\n[${dir}] ${from} — ${date}\n${body}\n`;
  }

  if (notes.length > 0) {
    context += '\n--- INTERNAL NOTES ---\n';
    for (const n of notes) {
      context += `\n[NOTE by ${toStr(n.author_name)}] ${n.created_at ? new Date(n.created_at).toLocaleString() : ''}\n${toStr(n.body)}\n`;
    }
  }

  return { ticket, context };
}

// Fetch recent Gmail messages for the user
async function getEmailContext(userId) {
  try {
    const { google } = require('googleapis');
    const db = getDb();
    const user = db.prepare('SELECT email FROM users WHERE id = ?').get(userId);
    if (!user) return '';

    // Try service account
    let auth = null;
    const email = toStr(user.email);
    if (process.env.SA_CLIENT_EMAIL && process.env.SA_PRIVATE_KEY) {
      auth = new google.auth.JWT({
        email: process.env.SA_CLIENT_EMAIL, key: process.env.SA_PRIVATE_KEY,
        scopes: ['https://www.googleapis.com/auth/gmail.readonly'], subject: email,
      });
    } else {
      const t = db.prepare('SELECT * FROM gmail_tokens WHERE user_id = ?').get(userId);
      if (t && t.access_token) {
        const c = new google.auth.OAuth2(process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET, process.env.GMAIL_REDIRECT_URI);
        c.setCredentials({ access_token: toStr(t.access_token), refresh_token: toStr(t.refresh_token), expiry_date: t.expiry_date });
        auth = c;
      }
    }
    if (!auth) return '';

    const gm = google.gmail({ version: 'v1', auth });
    const list = await gm.users.messages.list({ userId: 'me', q: 'in:inbox', maxResults: 20 });
    if (!list.data.messages) return '';

    const results = await Promise.allSettled(
      list.data.messages.slice(0, 20).map(m =>
        gm.users.messages.get({ userId: 'me', id: m.id, format: 'METADATA', metadataHeaders: ['From', 'To', 'Subject', 'Date'] })
      )
    );

    let ctx = '\n── RECENT GMAIL INBOX (last 20) ──\n';
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      const msg = r.value.data;
      const h = msg.payload?.headers || [];
      const hdr = (name) => { const f = h.find(x => x.name === name); return f ? f.value : ''; };
      const isUnread = (msg.labelIds || []).includes('UNREAD');
      ctx += `${hdr('Date')} | From: ${hdr('From')} | Subject: ${hdr('Subject')} | ${isUnread ? 'UNREAD' : 'read'} | snippet: ${msg.snippet?.substring(0, 100) || ''}\n`;
    }
    return ctx;
  } catch (e) {
    console.log('[AI] Email context fetch error:', e.message);
    return '';
  }
}

const SYSTEM_PROMPT = `You are an AI care coordination assistant for Seniority Healthcare. You have full access to the organization's CareCoord system including all tickets, team members, regions, tags, audit logs, and the current user's Gmail inbox.

Your capabilities:
- Answer questions about ANY ticket, patient, or communication in the system
- Search across all tickets by patient name, provider, subject, status, etc.
- Summarize ticket conversations
- Extract patient information (name, DOB, insurance, medications, diagnoses, providers)
- Draft professional reply emails matching the organization's tone
- Suggest next actions and follow-ups
- Identify urgency and priority levels
- Report on team workload, ticket distribution, and audit activity
- Reference recent emails from the user's Gmail inbox
- Cross-reference information across multiple tickets for the same patient

Guidelines:
- Be concise and actionable
- Use medical terminology appropriately but keep language clear
- When extracting patient data, structure it clearly with labels
- When drafting replies, be professional, empathetic, and HIPAA-conscious
- Flag any urgent or time-sensitive items
- If information is not in the system, say so rather than guessing
- When referencing tickets, include the ticket ID so the user can navigate to it
- You can see all tickets, not just the one currently open`;

// ── Clinical Snapshot from chart scan data ──
router.post('/clinical-snapshot', requireAuth, async (req, res) => {
  const client = getClient();
  if (!client) return res.status(500).json({ error: 'AI not configured. Set ANTHROPIC_API_KEY in environment.' });

  const { chartData } = req.body;
  if (!chartData) return res.status(400).json({ error: 'chartData required' });

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 3000,
      system: `You are a care coordinator at Seniority Healthcare writing a brief clinical overview of a patient. Write it as a short, readable narrative — the kind of summary you'd give a colleague in 60 seconds.

Format: 2-4 short paragraphs, no headers, no bullet points, no markdown formatting. Write in plain professional language. Include:
- Who the patient is (name, age, key demographics)
- Primary conditions and what's driving their care
- Current medications (mention count and key ones, don't list all)
- Care team involved
- Recent activity (what happened in recent encounters)
- Any concerns or follow-up items
- Advance directives if relevant

Keep it under 300 words. Write like a person, not a template. If encounter details are provided, summarize what happened in those visits.`,
      messages: [{ role: 'user', content: `Generate a Clinical Snapshot from this Practice Fusion chart data:\n\n${JSON.stringify(chartData, null, 2).substring(0, 8000)}` }],
    });
    res.json({ snapshot: response.content[0]?.text || '' });
  } catch (e) {
    console.error('[AI] Snapshot error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── General AI chat (full system access) ──
router.post('/chat', requireAuth, async (req, res) => {
  const client = getClient();
  if (!client) return res.status(500).json({ error: 'AI not configured. Set ANTHROPIC_API_KEY in environment.' });

  const db = getDb();
  const { message, history } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'Message required' });

  try {
    const msgs = [];
    if (history && history.length > 0) {
      for (const h of history) {
        msgs.push({ role: h.role, content: h.content });
      }
    }

    // On first message, include full system context + email
    if (!history || history.length === 0) {
      const sysCtx = getSystemContext(db, req.user.id);
      const emailCtx = await getEmailContext(req.user.id);
      msgs.push({ role: 'user', content: `Here is the full system context:\n\n${sysCtx}${emailCtx}\n\n---\n\nUser request: ${message}` });
    } else {
      msgs.push({ role: 'user', content: message });
    }

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: msgs,
    });

    const reply = response.content[0]?.text || 'No response generated.';
    res.json({ reply });
  } catch (e) {
    console.error('[AI] Error:', e.message);
    res.status(500).json({ error: 'AI request failed: ' + e.message });
  }
});

// ── Proactive suggestions based on user role and system state ──
router.post('/suggestions', requireAuth, async (req, res) => {
  const client = getClient();
  if (!client) return res.status(500).json({ error: 'AI not configured.' });

  const db = getDb();
  const sysCtx = getSystemContext(db, req.user.id);

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 512,
      system: `You generate brief, actionable suggestions for a care coordination platform user. Based on their role and the current system state, suggest 3-5 specific actions they should take right now. Each suggestion should be one short sentence (under 15 words) that the user can click to ask you about. Format: return ONLY a JSON array of strings, nothing else. Example: ["Review 3 unassigned tickets in Northern PA","Follow up on the Smith referral from last week","Check unread email from Dr. Johnson"]`,
      messages: [{ role: 'user', content: `Here is the system state. Generate suggestions for this user.\n\nUser role: ${req.user.role}\n\n${sysCtx}` }],
    });

    const text = response.content[0]?.text || '[]';
    let suggestions;
    try {
      // Extract JSON array from response (handle markdown code blocks)
      const match = text.match(/\[[\s\S]*\]/);
      suggestions = match ? JSON.parse(match[0]) : [];
    } catch (e) { suggestions = []; }

    res.json({ suggestions });
  } catch (e) {
    console.error('[AI] Suggestions error:', e.message);
    res.json({ suggestions: [] });
  }
});

// ── Draft email reply based on email content ──
router.post('/draft-email-reply', requireAuth, async (req, res) => {
  const client = getClient();
  if (!client) return res.status(500).json({ error: 'AI not configured. Set ANTHROPIC_API_KEY in environment.' });

  const db = getDb();
  const user = db.prepare('SELECT name, email FROM users WHERE id = ?').get(req.user.id);
  const { from, subject, body, instructions } = req.body;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Draft a professional reply email for ${toStr(user.name)} at Seniority Healthcare.\n\nOriginal email:\nFrom: ${from || '(unknown)'}\nSubject: ${subject || '(no subject)'}\nBody:\n${body || '(empty)'}\n\n${instructions ? 'Special instructions: ' + instructions + '\n\n' : ''}Write ONLY the reply body. Be professional, empathetic, and concise. Do not include a signature.` }],
    });
    res.json({ result: response.content[0]?.text || '' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Draft email from scratch (for compose) ──
router.post('/draft-email', requireAuth, async (req, res) => {
  const client = getClient();
  if (!client) return res.status(500).json({ error: 'AI not configured. Set ANTHROPIC_API_KEY in environment.' });

  const db = getDb();
  const user = db.prepare('SELECT name, email FROM users WHERE id = ?').get(req.user.id);
  const { instructions, to, subject } = req.body;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Draft a professional email for ${toStr(user.name)} at Seniority Healthcare.\n\nTo: ${to || '(not specified)'}\nSubject: ${subject || '(not specified)'}\nInstructions: ${instructions || 'Write an appropriate professional email'}\n\nWrite ONLY the email body (no greeting header like "Dear..." unless appropriate, no signature — it's added automatically). Be professional, empathetic, and concise.` }],
    });
    res.json({ result: response.content[0]?.text || '' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Chat with AI about a specific ticket (full system + ticket detail) ──
router.post('/ticket/:ticketId/chat', requireAuth, async (req, res) => {
  const client = getClient();
  if (!client) return res.status(500).json({ error: 'AI not configured. Set ANTHROPIC_API_KEY in environment.' });

  const db = getDb();
  const { message, history } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'Message required' });

  const ticketData = getTicketContext(db, req.params.ticketId);
  if (!ticketData) return res.status(404).json({ error: 'Ticket not found' });

  try {
    const msgs = [];

    if (history && history.length > 0) {
      for (const h of history) {
        msgs.push({ role: h.role, content: h.content });
      }
    }

    if (!history || history.length === 0) {
      const sysCtx = getSystemContext(db, req.user.id);
      const emailCtx = await getEmailContext(req.user.id);
      msgs.push({ role: 'user', content: `Here is the full system context:\n\n${sysCtx}${emailCtx}${ticketData.context}\n\n---\n\nUser request: ${message}` });
    } else {
      msgs.push({ role: 'user', content: message });
    }

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: msgs,
    });

    const reply = response.content[0]?.text || 'No response generated.';
    res.json({ reply });
  } catch (e) {
    console.error('[AI] Error:', e.message);
    res.status(500).json({ error: 'AI request failed: ' + e.message });
  }
});

// ── Quick actions ──
router.post('/ticket/:ticketId/summarize', requireAuth, async (req, res) => {
  const client = getClient();
  if (!client) return res.status(500).json({ error: 'AI not configured. Set ANTHROPIC_API_KEY in environment.' });
  const db = getDb();
  const ticketData = getTicketContext(db, req.params.ticketId);
  if (!ticketData) return res.status(404).json({ error: 'Ticket not found' });
  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514', max_tokens: 1024, system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Summarize this ticket thread concisely. Include: key issue, current status, who's involved, and any pending actions.\n\n${ticketData.context}` }],
    });
    res.json({ result: response.content[0]?.text || '' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/ticket/:ticketId/extract-patient', requireAuth, async (req, res) => {
  const client = getClient();
  if (!client) return res.status(500).json({ error: 'AI not configured. Set ANTHROPIC_API_KEY in environment.' });
  const db = getDb();
  const ticketData = getTicketContext(db, req.params.ticketId);
  if (!ticketData) return res.status(404).json({ error: 'Ticket not found' });
  try {
    // Also search other tickets for this patient
    const extP = JSON.parse(toStr(ticketData.ticket.external_participants) || '[]');
    let crossRef = '';
    if (extP[0]) {
      const related = db.prepare("SELECT id, subject, status FROM tickets WHERE external_participants LIKE ? AND id != ? ORDER BY last_activity_at DESC LIMIT 5")
        .all('%' + extP[0] + '%', toStr(ticketData.ticket.id));
      if (related.length > 0) {
        crossRef = '\n\nRELATED TICKETS for same contact:\n';
        for (const r of related) {
          const rMsgs = db.prepare('SELECT body_text FROM messages WHERE ticket_id = ? ORDER BY sent_at DESC LIMIT 3').all(r.id);
          crossRef += `\n[${toStr(r.id)}] "${toStr(r.subject)}" (${toStr(r.status)})\n`;
          for (const rm of rMsgs) crossRef += (toStr(rm.body_text) || '').substring(0, 300) + '\n';
        }
      }
    }
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514', max_tokens: 1024, system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Extract ALL patient information from this ticket thread and any related tickets. Structure it as:\n\n**Patient Name:**\n**DOB:**\n**Insurance:**\n**Member ID:**\n**Phone:**\n**Address:**\n**Diagnoses/Conditions:**\n**Medications:**\n**Providers/Facilities:**\n**Referrals:**\n**Other relevant details:**\n\nIf a field is not mentioned, write "Not found". Only include information explicitly stated in the messages.\n\n${ticketData.context}${crossRef}` }],
    });
    res.json({ result: response.content[0]?.text || '' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/ticket/:ticketId/draft-reply', requireAuth, async (req, res) => {
  const client = getClient();
  if (!client) return res.status(500).json({ error: 'AI not configured. Set ANTHROPIC_API_KEY in environment.' });
  const db = getDb();
  const ticketData = getTicketContext(db, req.params.ticketId);
  if (!ticketData) return res.status(404).json({ error: 'Ticket not found' });
  const user = db.prepare('SELECT name, email FROM users WHERE id = ?').get(req.user.id);
  const region = ticketData.ticket.region_id ? db.prepare('SELECT name FROM regions WHERE id = ?').get(ticketData.ticket.region_id) : null;
  const { instructions } = req.body;
  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514', max_tokens: 1024, system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Draft a professional reply email for this ticket. The reply is from ${toStr(user.name)}, Care Coordinator at ${region ? toStr(region.name) : 'Seniority Healthcare'}.\n\n${instructions ? 'Special instructions: ' + instructions + '\n\n' : ''}Write ONLY the email body (no signature — it's added automatically). Be professional, empathetic, and concise.\n\n${ticketData.context}` }],
    });
    res.json({ result: response.content[0]?.text || '' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/ticket/:ticketId/suggest-tags', requireAuth, async (req, res) => {
  const client = getClient();
  if (!client) return res.status(500).json({ error: 'AI not configured. Set ANTHROPIC_API_KEY in environment.' });
  const db = getDb();
  const ticketData = getTicketContext(db, req.params.ticketId);
  if (!ticketData) return res.status(404).json({ error: 'Ticket not found' });
  const allTags = db.prepare('SELECT name FROM tags').all();
  const tagNames = allTags.map(t => toStr(t.name));
  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514', max_tokens: 256, system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Based on this ticket, which of these existing tags should be applied? Available tags: ${tagNames.join(', ')}\n\nReturn ONLY a comma-separated list of applicable tag names. If none apply, say "None".\n\n${ticketData.context}` }],
    });
    res.json({ result: response.content[0]?.text || '' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
