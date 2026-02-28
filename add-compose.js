// add-compose.js
// Run from the carecoord folder: node add-compose.js
// Adds "New Message" compose feature: backend endpoint + frontend modal + sidebar button

const fs = require('fs');
const path = require('path');

console.log('\n✉️  Adding Compose New Message feature...\n');

// ─── 1. PATCH: server/routes/tickets.js — add POST /api/tickets (create) ─────

const ticketsPath = path.join(__dirname, 'server', 'routes', 'tickets.js');
let tickets = fs.readFileSync(ticketsPath, 'utf8');

// Add the create ticket route right before "router.get('/', requireAuth"
const createRoute = `
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
  const fullBody = body + '\\n\\n—\\n' + user.name + '\\nCare Coordinator — ' + region.name + '\\n' + user.email;
  const providerMsgId = 'msg-int-' + now;

  // Create ticket
  db.prepare('INSERT INTO tickets (id, region_id, status, assignee_user_id, subject, external_participants, last_activity_at, created_at, has_unread) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)')
    .run(ticketId, regionId, 'WAITING_ON_EXTERNAL', req.user.id, subject, JSON.stringify([toEmail.trim()]), now, now);

  // Create initial outbound message
  db.prepare('INSERT INTO messages (id, ticket_id, direction, channel, from_address, to_addresses, subject, body_text, sent_at, provider_message_id, in_reply_to, reference_ids, created_by_user_id, created_at) VALUES (?, ?, \\'outbound\\', \\'email\\', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
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

`;

// Insert before the first router.get
tickets = tickets.replace(
  "router.get('/', requireAuth,",
  createRoute + "router.get('/', requireAuth,"
);

fs.writeFileSync(ticketsPath, tickets, 'utf8');
console.log('  ✓ server/routes/tickets.js — added POST /api/tickets');

// ─── 2. PATCH: client/src/api.js — add createTicket method ──────────────────

const apiPath = path.join(__dirname, 'client', 'src', 'api.js');
let apiJs = fs.readFileSync(apiPath, 'utf8');

// Add createTicket right after getTickets
apiJs = apiJs.replace(
  "getTicket: (id) => request(`/tickets/${id}`),",
  `createTicket: (data) => request('/tickets', { method: 'POST', body: data }),
  getTicket: (id) => request(\`/tickets/\${id}\`),`
);

fs.writeFileSync(apiPath, apiJs, 'utf8');
console.log('  ✓ client/src/api.js — added createTicket method');

// ─── 3. CREATE: client/src/components/ComposeModal.jsx ───────────────────────

const composePath = path.join(__dirname, 'client', 'src', 'components', 'ComposeModal.jsx');
fs.writeFileSync(composePath, `import React, { useState } from 'react';
import { api } from '../api';
import Icon from './Icons';
import { TagPill } from './ui';

export default function ComposeModal({ currentUser, regions, allTags, onClose, onCreated, showToast }) {
  const [toEmail, setToEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [regionId, setRegionId] = useState(currentUser.regionIds?.[0] || '');
  const [selectedTags, setSelectedTags] = useState([]);
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [sending, setSending] = useState(false);

  const userRegions = regions.filter(r => currentUser.regionIds.includes(r.id));
  const canSend = toEmail.trim() && subject.trim() && body.trim() && regionId;

  const handleSend = async () => {
    if (!canSend || sending) return;
    setSending(true);
    try {
      const data = await api.createTicket({ toEmail, subject, body, regionId, tagIds: selectedTags });
      showToast('Ticket created — message sent');
      onCreated(data.ticket.id);
    } catch (e) {
      showToast(e.message || 'Failed to create ticket');
    } finally {
      setSending(false);
    }
  };

  const toggleTag = (tagId) => {
    setSelectedTags(prev => prev.includes(tagId) ? prev.filter(id => id !== tagId) : [...prev, tagId]);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={onClose}>
      <div style={{ background: '#161822', borderRadius: 16, border: '1px solid #2a2d3e', width: 580, maxHeight: '90vh', overflow: 'auto', animation: 'fadeIn 0.2s ease' }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', borderBottom: '1px solid #1e2030' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: '#6366f120', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="send" size={16} />
            </div>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>New Message</h2>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: 4 }}>
            <Icon name="x" size={18} />
          </button>
        </div>

        {/* Form */}
        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* To */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: '#64748b', display: 'block', marginBottom: 6 }}>To (email) *</label>
            <input type="email" value={toEmail} onChange={e => setToEmail(e.target.value)}
              placeholder="provider@hospital.org"
              style={{ width: '100%', padding: '10px 14px', background: '#1e2030', border: '1px solid #2a2d3e', borderRadius: 8, color: '#e2e8f0', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
          </div>

          {/* Subject */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: '#64748b', display: 'block', marginBottom: 6 }}>Subject *</label>
            <input type="text" value={subject} onChange={e => setSubject(e.target.value)}
              placeholder="Patient Name — Topic"
              style={{ width: '100%', padding: '10px 14px', background: '#1e2030', border: '1px solid #2a2d3e', borderRadius: 8, color: '#e2e8f0', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
          </div>

          {/* Region */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: '#64748b', display: 'block', marginBottom: 6 }}>Send from Region *</label>
            <select value={regionId} onChange={e => setRegionId(e.target.value)}
              style={{ width: '100%', padding: '10px 14px', background: '#1e2030', border: '1px solid #2a2d3e', borderRadius: 8, color: '#e2e8f0', fontSize: 13, cursor: 'pointer', boxSizing: 'border-box' }}>
              <option value="">Select region...</option>
              {(currentUser.role === 'supervisor' || currentUser.role === 'admin' ? regions : userRegions)
                .filter(r => r.id !== 'r4')
                .map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>

          {/* Tags */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: '#64748b', display: 'block', marginBottom: 6 }}>Tags (optional)</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              {selectedTags.map(tagId => {
                const tag = allTags.find(t => t.id === tagId);
                return tag ? <TagPill key={tag.id} tag={tag} onRemove={() => toggleTag(tag.id)} /> : null;
              })}
              <div style={{ position: 'relative' }}>
                <button onClick={() => setShowTagPicker(!showTagPicker)}
                  style={{ padding: '4px 10px', background: '#1e2030', border: '1px dashed #2a2d3e', borderRadius: 6, color: '#64748b', fontSize: 11, cursor: 'pointer' }}>
                  + Add tag
                </button>
                {showTagPicker && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, background: '#1e2030', border: '1px solid #2a2d3e', borderRadius: 8, marginTop: 4, zIndex: 10, overflow: 'hidden', minWidth: 160 }}>
                    {allTags.filter(t => !selectedTags.includes(t.id)).map(tag => (
                      <button key={tag.id} onClick={() => { toggleTag(tag.id); setShowTagPicker(false); }}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '8px 12px', background: 'transparent', border: 'none', color: '#e2e8f0', cursor: 'pointer', fontSize: 12, textAlign: 'left' }}
                        onMouseEnter={e => e.currentTarget.style.background = '#252840'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: tag.color }} />
                        {tag.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Body */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: '#64748b', display: 'block', marginBottom: 6 }}>Message *</label>
            <textarea value={body} onChange={e => setBody(e.target.value)}
              placeholder="Type your message..."
              rows={8}
              style={{ width: '100%', padding: '12px 14px', background: '#1e2030', border: '1px solid #2a2d3e', borderRadius: 8, color: '#e2e8f0', fontSize: 13, resize: 'vertical', outline: 'none', lineHeight: 1.6, boxSizing: 'border-box' }} />
            <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>
              Your signature ({currentUser.name} — {regions.find(r => r.id === regionId)?.name || 'Region'}) will be appended automatically.
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', borderTop: '1px solid #1e2030' }}>
          <div style={{ fontSize: 11, color: '#475569' }}>
            This creates a new ticket assigned to you.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose}
              style={{ padding: '8px 18px', background: '#1e2030', color: '#94a3b8', border: '1px solid #2a2d3e', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
              Cancel
            </button>
            <button onClick={handleSend} disabled={!canSend || sending}
              style={{ padding: '8px 22px', background: canSend && !sending ? '#6366f1' : '#1e2030', color: canSend && !sending ? '#fff' : '#475569', border: 'none', borderRadius: 8, cursor: canSend && !sending ? 'pointer' : 'default', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="send" size={12} />
              {sending ? 'Sending...' : 'Send Message'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
`, 'utf8');
console.log('  ✓ client/src/components/ComposeModal.jsx — created');

// ─── 4. PATCH: client/src/App.jsx — add compose button + modal ──────────────

const appPath = path.join(__dirname, 'client', 'src', 'App.jsx');
let appJsx = fs.readFileSync(appPath, 'utf8');

// Add import for ComposeModal
appJsx = appJsx.replace(
  "import AuditLog from './components/AuditLog';",
  "import AuditLog from './components/AuditLog';\nimport ComposeModal from './components/ComposeModal';"
);

// Add showCompose state — add it after the toast state
appJsx = appJsx.replace(
  "const [toast, setToast] = useState(null);",
  "const [toast, setToast] = useState(null);\n  const [showCompose, setShowCompose] = useState(false);"
);

// Add compose button to the sidebar nav — insert a "New Message" button before the nav items
// We'll add it as a button right above the nav section
appJsx = appJsx.replace(
  "<nav style={{ flex: 1, padding: '12px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>",
  `<div style={{ padding: sidebarCollapsed ? '12px 8px' : '12px 12px' }}>
          <button onClick={() => setShowCompose(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%',
              padding: sidebarCollapsed ? '10px 14px' : '10px 14px',
              borderRadius: 8, border: 'none',
              background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
              color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600,
              justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
              boxShadow: '0 2px 8px rgba(99,102,241,0.3)',
            }} title="New Message">
            <Icon name="send" size={16} />
            {!sidebarCollapsed && <span>New Message</span>}
          </button>
        </div>

        <nav style={{ flex: 1, padding: '4px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>`
);

// Add ComposeModal rendering — insert before the toast div
appJsx = appJsx.replace(
  "{/* Toast */}",
  `{/* Compose Modal */}
        {showCompose && (
          <ComposeModal
            currentUser={currentUser}
            regions={regions}
            allTags={allTags}
            onClose={() => setShowCompose(false)}
            onCreated={(ticketId) => { setShowCompose(false); openTicket(ticketId); }}
            showToast={showToast}
          />
        )}

        {/* Toast */}`
);

fs.writeFileSync(appPath, appJsx, 'utf8');
console.log('  ✓ client/src/App.jsx — added compose button + modal wiring');

console.log('\n✅ Compose feature added!');
console.log('\nRestart the app:');
console.log('  1. Press Ctrl+C to stop');
console.log('  2. npm run dev');
console.log('  3. Look for the purple "New Message" button in the sidebar\n');
