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

function getTicketContext(db, ticketId) {
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
  if (!ticket) return null;

  const messages = db.prepare('SELECT * FROM messages WHERE ticket_id = ? ORDER BY sent_at ASC').all(ticketId);
  const notes = db.prepare('SELECT n.*, u.name as author_name FROM notes n LEFT JOIN users u ON u.id = n.author_user_id WHERE n.ticket_id = ? ORDER BY n.created_at ASC').all(ticketId);
  const tags = db.prepare('SELECT t.name FROM tags t JOIN ticket_tags tt ON tt.tag_id = t.id WHERE tt.ticket_id = ?').all(ticketId);
  const assignee = ticket.assignee_user_id ? db.prepare('SELECT name, email FROM users WHERE id = ?').get(ticket.assignee_user_id) : null;
  const region = ticket.region_id ? db.prepare('SELECT name FROM regions WHERE id = ?').get(ticket.region_id) : null;

  let context = `TICKET: ${toStr(ticket.id)} — ${toStr(ticket.subject)}\n`;
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

const SYSTEM_PROMPT = `You are an AI care coordination assistant for Seniority Healthcare. You help care coordinators manage patient communications efficiently.

Your capabilities:
- Summarize ticket conversations
- Extract patient information (name, DOB, insurance, medications, diagnoses, providers) from email threads
- Draft professional reply emails matching the organization's tone
- Suggest next actions and follow-ups
- Identify urgency and priority levels
- Answer questions about the ticket content

Guidelines:
- Be concise and actionable
- Use medical terminology appropriately but keep language clear
- When extracting patient data, structure it clearly with labels
- When drafting replies, be professional, empathetic, and HIPAA-conscious (never include unnecessary PHI)
- Flag any urgent or time-sensitive items
- If you're unsure about something, say so rather than guessing`;

// ── General AI chat (no ticket required) ──
router.post('/chat', requireAuth, async (req, res) => {
  const client = getClient();
  if (!client) return res.status(500).json({ error: 'AI not configured. Set ANTHROPIC_API_KEY in environment.' });

  const { message, history } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'Message required' });

  try {
    const msgs = [];
    if (history && history.length > 0) {
      for (const h of history) {
        msgs.push({ role: h.role, content: h.content });
      }
    }
    msgs.push({ role: 'user', content: message });

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

// ── Chat with AI about a ticket ──
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

    // Add conversation history
    if (history && history.length > 0) {
      for (const h of history) {
        msgs.push({ role: h.role, content: h.content });
      }
    }

    // Add current message with ticket context on first message
    if (!history || history.length === 0) {
      msgs.push({ role: 'user', content: `Here is the full ticket context:\n\n${ticketData.context}\n\n---\n\nUser request: ${message}` });
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

// ── Quick actions (no conversation history needed) ──
router.post('/ticket/:ticketId/summarize', requireAuth, async (req, res) => {
  const client = getClient();
  if (!client) return res.status(500).json({ error: 'AI not configured. Set ANTHROPIC_API_KEY in environment.' });

  const db = getDb();
  const ticketData = getTicketContext(db, req.params.ticketId);
  if (!ticketData) return res.status(404).json({ error: 'Ticket not found' });

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
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
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Extract ALL patient information from this ticket thread. Structure it as:\n\n**Patient Name:**\n**DOB:**\n**Insurance:**\n**Member ID:**\n**Phone:**\n**Address:**\n**Diagnoses/Conditions:**\n**Medications:**\n**Providers/Facilities:**\n**Referrals:**\n**Other relevant details:**\n\nIf a field is not mentioned, write "Not found". Only include information explicitly stated in the messages.\n\n${ticketData.context}` }],
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
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
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
      model: 'claude-sonnet-4-20250514',
      max_tokens: 256,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Based on this ticket, which of these existing tags should be applied? Available tags: ${tagNames.join(', ')}\n\nReturn ONLY a comma-separated list of applicable tag names. If none apply, say "None".\n\n${ticketData.context}` }],
    });
    res.json({ result: response.content[0]?.text || '' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
