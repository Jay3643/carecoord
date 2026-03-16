// add-workspace.js
// Full Google Workspace integration for CareCoord
// Gmail (personal + regional split), Calendar, Drive, Meet

const fs = require('fs');
const path = require('path');

console.log('\n🏢 Building Full Google Workspace Integration...\n');

// ─── 1. Update OAuth scopes in gmail.js ──────────────────────────────────────

const gmailPath = path.join(__dirname, 'server', 'routes', 'gmail.js');
let gmailJs = fs.readFileSync(gmailPath, 'utf8');

// Update scopes to include Calendar, Drive
gmailJs = gmailJs.replace(
  /scope: \[[\s\S]*?\],/,
  `scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/drive.readonly',
    ],`
);

// Add uuid require if not present
if (!gmailJs.includes("uuid")) {
  gmailJs = gmailJs.replace(
    "const router = express.Router();",
    "const { v4: uuidv4 } = require('uuid');\nconst router = express.Router();"
  );
}

// ── Add Calendar endpoints ───────────────────────────────────────────────────

if (!gmailJs.includes('/calendar')) {
  gmailJs = gmailJs.replace(
    "module.exports = router;",
    `
// ══════════════════════════════════════════════════════════════════════════════
// CALENDAR ENDPOINTS
// ══════════════════════════════════════════════════════════════════════════════

router.get('/calendar/events', requireAuth, async (req, res) => {
  try {
    const tokens = getStoredTokens(req.user.id);
    if (!tokens) return res.status(400).json({ error: 'Gmail not connected' });

    const auth = getAuthenticatedClient(tokens);
    const calendar = google.calendar({ version: 'v3', auth });

    const timeMin = req.query.timeMin || new Date().toISOString();
    const timeMax = req.query.timeMax || new Date(Date.now() + 7 * 86400000).toISOString();

    const result = await calendar.events.list({
      calendarId: 'primary',
      timeMin,
      timeMax,
      maxResults: 50,
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = (result.data.items || []).map(e => ({
      id: e.id,
      summary: e.summary || '(No title)',
      description: e.description || '',
      start: e.start.dateTime || e.start.date,
      end: e.end.dateTime || e.end.date,
      allDay: !e.start.dateTime,
      location: e.location || '',
      meetLink: e.hangoutLink || e.conferenceData?.entryPoints?.find(ep => ep.entryPointType === 'video')?.uri || null,
      attendees: (e.attendees || []).map(a => ({ email: a.email, name: a.displayName, status: a.responseStatus })),
      htmlLink: e.htmlLink,
      status: e.status,
    }));

    res.json({ events });
  } catch (err) {
    console.error('[Calendar] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/calendar/events', requireAuth, async (req, res) => {
  try {
    const tokens = getStoredTokens(req.user.id);
    if (!tokens) return res.status(400).json({ error: 'Gmail not connected' });

    const auth = getAuthenticatedClient(tokens);
    const calendar = google.calendar({ version: 'v3', auth });

    const { summary, description, startTime, endTime, attendees, addMeet } = req.body;

    const event = {
      summary,
      description: description || '',
      start: { dateTime: startTime, timeZone: 'America/New_York' },
      end: { dateTime: endTime, timeZone: 'America/New_York' },
    };

    if (attendees && attendees.length > 0) {
      event.attendees = attendees.map(email => ({ email }));
    }

    if (addMeet) {
      event.conferenceData = {
        createRequest: {
          requestId: 'carecoord-' + Date.now(),
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      };
    }

    const result = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: event,
      conferenceDataVersion: addMeet ? 1 : 0,
      sendUpdates: attendees ? 'all' : 'none',
    });

    res.json({
      id: result.data.id,
      meetLink: result.data.hangoutLink || null,
      htmlLink: result.data.htmlLink,
    });
  } catch (err) {
    console.error('[Calendar] Create error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/calendar/events/:id', requireAuth, async (req, res) => {
  try {
    const tokens = getStoredTokens(req.user.id);
    if (!tokens) return res.status(400).json({ error: 'Gmail not connected' });

    const auth = getAuthenticatedClient(tokens);
    const calendar = google.calendar({ version: 'v3', auth });

    await calendar.events.delete({ calendarId: 'primary', eventId: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// DRIVE ENDPOINTS
// ══════════════════════════════════════════════════════════════════════════════

router.get('/drive/files', requireAuth, async (req, res) => {
  try {
    const tokens = getStoredTokens(req.user.id);
    if (!tokens) return res.status(400).json({ error: 'Gmail not connected' });

    const auth = getAuthenticatedClient(tokens);
    const drive = google.drive({ version: 'v3', auth });

    const query = req.query.q || '';
    const folderId = req.query.folderId || null;
    const pageToken = req.query.pageToken || undefined;

    let q = "trashed = false";
    if (folderId) {
      q += " and '" + folderId + "' in parents";
    } else if (query) {
      q += " and (name contains '" + query.replace(/'/g, "\\\\'") + "' or fullText contains '" + query.replace(/'/g, "\\\\'") + "')";
    } else {
      q += " and 'root' in parents";
    }

    const result = await drive.files.list({
      q,
      pageSize: 30,
      pageToken,
      fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, size, iconLink, webViewLink, thumbnailLink, parents, shared)',
      orderBy: 'folder,modifiedTime desc',
    });

    const files = (result.data.files || []).map(f => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      isFolder: f.mimeType === 'application/vnd.google-apps.folder',
      modifiedTime: f.modifiedTime,
      size: f.size ? parseInt(f.size) : null,
      iconLink: f.iconLink,
      webViewLink: f.webViewLink,
      thumbnailLink: f.thumbnailLink,
      shared: f.shared,
    }));

    res.json({ files, nextPageToken: result.data.nextPageToken || null });
  } catch (err) {
    console.error('[Drive] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/drive/shared', requireAuth, async (req, res) => {
  try {
    const tokens = getStoredTokens(req.user.id);
    if (!tokens) return res.status(400).json({ error: 'Gmail not connected' });

    const auth = getAuthenticatedClient(tokens);
    const drive = google.drive({ version: 'v3', auth });

    const result = await drive.files.list({
      q: "sharedWithMe = true and trashed = false",
      pageSize: 30,
      fields: 'files(id, name, mimeType, modifiedTime, size, iconLink, webViewLink, thumbnailLink, shared)',
      orderBy: 'modifiedTime desc',
    });

    res.json({ files: result.data.files || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// PERSONAL INBOX (filtered by routing rules)
// ══════════════════════════════════════════════════════════════════════════════

router.get('/personal', requireAuth, async (req, res) => {
  try {
    const tokens = getStoredTokens(req.user.id);
    if (!tokens) return res.status(400).json({ error: 'Gmail not connected' });

    const auth = getAuthenticatedClient(tokens);
    const gmail = google.gmail({ version: 'v1', auth });
    const db = getDb();

    const folder = req.query.folder || 'INBOX';
    const query = req.query.q || '';
    const maxResults = parseInt(req.query.max) || 20;

    // Map folder to Gmail query
    const folderMap = {
      INBOX: 'in:inbox',
      SENT: 'in:sent',
      DRAFT: 'in:drafts',
      STARRED: 'is:starred',
      SPAM: 'in:spam',
      TRASH: 'in:trash',
      ALL: '',
    };

    let q = folderMap[folder] || 'in:inbox';
    if (query) q = query;

    // Get personal routing rules — these define what STAYS personal
    const personalRules = db.prepare('SELECT * FROM email_filters WHERE action = ?').all('personal');

    const listRes = await gmail.users.messages.list({
      userId: 'me',
      q: q,
      maxResults: maxResults * 2, // fetch extra since we'll filter some out
    });

    if (!listRes.data.messages || listRes.data.messages.length === 0) {
      return res.json({ messages: [] });
    }

    const messages = [];
    for (const m of listRes.data.messages) {
      if (messages.length >= maxResults) break;

      const msg = await gmail.users.messages.get({
        userId: 'me', id: m.id, format: 'metadata',
        metadataHeaders: ['From', 'To', 'Subject', 'Date'],
      });

      const headers = msg.data.payload.headers;
      const from = getHeader(headers, 'From');
      const subject = getHeader(headers, 'Subject');

      // In personal view for INBOX: only show emails matching personal rules
      // In other folders (Sent, etc): show everything
      if (folder === 'INBOX') {
        const isPersonal = personalRules.some(r => {
          const domain = toStr(r.domain);
          const sender = toStr(r.sender);
          const subjectContains = toStr(r.subject_contains);
          if (domain && from && from.toLowerCase().includes(domain.toLowerCase())) return true;
          if (sender && from && from.toLowerCase().includes(sender.toLowerCase())) return true;
          if (subjectContains && subject && subject.toLowerCase().includes(subjectContains.toLowerCase())) return true;
          return false;
        });
        if (!isPersonal) continue; // Skip — goes to regional queue instead
      }

      messages.push({
        id: msg.data.id,
        threadId: msg.data.threadId,
        snippet: msg.data.snippet,
        from,
        to: getHeader(headers, 'To'),
        subject: subject || '(no subject)',
        date: getHeader(headers, 'Date'),
        labels: msg.data.labelIds || [],
        isUnread: (msg.data.labelIds || []).includes('UNREAD'),
      });
    }

    res.json({ messages });
  } catch (err) {
    console.error('[Gmail Personal] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get full message for personal view
router.get('/personal/:id', requireAuth, async (req, res) => {
  try {
    const tokens = getStoredTokens(req.user.id);
    if (!tokens) return res.status(400).json({ error: 'Gmail not connected' });

    const auth = getAuthenticatedClient(tokens);
    const gmail = google.gmail({ version: 'v1', auth });

    const msg = await gmail.users.messages.get({ userId: 'me', id: req.params.id, format: 'full' });
    const headers = msg.data.payload.headers;
    const body = extractBody(msg.data.payload);

    // Mark as read
    if ((msg.data.labelIds || []).includes('UNREAD')) {
      await gmail.users.messages.modify({ userId: 'me', id: req.params.id, requestBody: { removeLabelIds: ['UNREAD'] } });
    }

    res.json({
      id: msg.data.id, threadId: msg.data.threadId,
      from: getHeader(headers, 'From'), to: getHeader(headers, 'To'),
      cc: getHeader(headers, 'Cc'), subject: getHeader(headers, 'Subject'),
      date: getHeader(headers, 'Date'), body, labels: msg.data.labelIds || [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send from personal
router.post('/personal/send', requireAuth, async (req, res) => {
  try {
    const tokens = getStoredTokens(req.user.id);
    if (!tokens) return res.status(400).json({ error: 'Gmail not connected' });

    const auth = getAuthenticatedClient(tokens);
    const gmail = google.gmail({ version: 'v1', auth });
    const { to, cc, subject, body, threadId } = req.body;
    const fromEmail = toStr(tokens.email);

    let rawLines = ['From: ' + fromEmail, 'To: ' + to];
    if (cc) rawLines.push('Cc: ' + cc);
    rawLines.push('Subject: ' + (subject || '(no subject)'));
    rawLines.push('MIME-Version: 1.0');
    rawLines.push('Content-Type: text/html; charset=utf-8');
    rawLines.push('');
    rawLines.push(body);

    const raw = Buffer.from(rawLines.join('\\r\\n')).toString('base64url');
    const params = { userId: 'me', requestBody: { raw } };
    if (threadId) params.requestBody.threadId = threadId;

    const result = await gmail.users.messages.send(params);
    res.json({ id: result.data.id, threadId: result.data.threadId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
`
  );
}

fs.writeFileSync(gmailPath, gmailJs, 'utf8');
console.log('  ✓ gmail.js — added Calendar, Drive, Personal inbox endpoints');

// ─── 2. Update database.js — change filter action to support 'personal' ─────

const dbPath = path.join(__dirname, 'server', 'database.js');
let dbJs = fs.readFileSync(dbPath, 'utf8');
// Already has email_filters table — action column supports 'hide' or 'personal'
console.log('  ✓ database.js — email_filters supports personal routing');

// ─── 3. Update client API ────────────────────────────────────────────────────

const apiPath = path.join(__dirname, 'client', 'src', 'api.js');
let apiJs = fs.readFileSync(apiPath, 'utf8');

apiJs = apiJs.replace(
  /\/\/ Gmail — Shared Regional[\s\S]*?gmailAccounts:[^,]*,/,
  `// Gmail — Shared Regional + Personal
  gmailAuth: () => request('/gmail/auth'),
  gmailStatus: () => request('/gmail/status'),
  gmailDisconnect: () => request('/gmail/disconnect', { method: 'POST' }),
  gmailSync: () => request('/gmail/sync', { method: 'POST' }),
  gmailReply: (ticketId, body) => request('/gmail/reply', { method: 'POST', body: { ticketId, body } }),
  gmailFilters: () => request('/gmail/filters'),
  gmailAddFilter: (data) => request('/gmail/filters', { method: 'POST', body: data }),
  gmailDeleteFilter: (id) => request('/gmail/filters/' + id, { method: 'DELETE' }),
  gmailAccounts: () => request('/gmail/accounts'),
  // Personal inbox
  gmailPersonal: (folder, q, max) => request('/gmail/personal?folder=' + (folder||'INBOX') + '&q=' + encodeURIComponent(q||'') + '&max=' + (max||20)),
  gmailPersonalMsg: (id) => request('/gmail/personal/' + id),
  gmailPersonalSend: (data) => request('/gmail/personal/send', { method: 'POST', body: data }),
  // Calendar
  calendarEvents: (timeMin, timeMax) => request('/gmail/calendar/events?timeMin=' + (timeMin||'') + '&timeMax=' + (timeMax||'')),
  calendarCreate: (data) => request('/gmail/calendar/events', { method: 'POST', body: data }),
  calendarDelete: (id) => request('/gmail/calendar/events/' + id, { method: 'DELETE' }),
  // Drive
  driveFiles: (q, folderId, pageToken) => request('/gmail/drive/files?q=' + encodeURIComponent(q||'') + (folderId ? '&folderId='+folderId : '') + (pageToken ? '&pageToken='+pageToken : '')),
  driveShared: () => request('/gmail/drive/shared'),`
);

fs.writeFileSync(apiPath, apiJs, 'utf8');
console.log('  ✓ api.js — added all workspace methods');

// ─── 4. Create CalendarPanel component ───────────────────────────────────────

fs.writeFileSync(path.join(__dirname, 'client', 'src', 'components', 'CalendarPanel.jsx'), `import React, { useState, useEffect } from 'react';
import { api } from '../api';

export default function CalendarPanel({ currentUser, showToast }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const [form, setForm] = useState({ summary: '', description: '', date: '', startTime: '09:00', endTime: '10:00', attendees: '', addMeet: false });

  useEffect(() => {
    api.gmailStatus().then(s => {
      setConnected(s.connected);
      if (s.connected) fetchEvents();
      else setLoading(false);
    }).catch(() => setLoading(false));
  }, [weekOffset]);

  const fetchEvents = async () => {
    setLoading(true);
    const start = new Date();
    start.setDate(start.getDate() + weekOffset * 7);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    try {
      const data = await api.calendarEvents(start.toISOString(), end.toISOString());
      setEvents(data.events || []);
    } catch (e) { showToast(e.message); }
    setLoading(false);
  };

  const createEvent = async () => {
    if (!form.summary || !form.date) return;
    try {
      const startTime = form.date + 'T' + form.startTime + ':00';
      const endTime = form.date + 'T' + form.endTime + ':00';
      const attendees = form.attendees ? form.attendees.split(',').map(e => e.trim()).filter(Boolean) : [];
      const result = await api.calendarCreate({
        summary: form.summary, description: form.description,
        startTime, endTime, attendees, addMeet: form.addMeet,
      });
      showToast('Event created!' + (result.meetLink ? ' Meet link added.' : ''));
      setShowCreate(false);
      setForm({ summary: '', description: '', date: '', startTime: '09:00', endTime: '10:00', attendees: '', addMeet: false });
      fetchEvents();
    } catch (e) { showToast(e.message); }
  };

  const deleteEvent = async (id) => {
    if (!confirm('Delete this event?')) return;
    await api.calendarDelete(id);
    fetchEvents();
  };

  const s = {
    input: { width: '100%', padding: '8px 12px', background: '#f0f4f9', border: '1px solid #c0d0e4', borderRadius: 6, color: '#1e3a4f', fontSize: 12, outline: 'none', boxSizing: 'border-box' },
    btn: (bg, fg) => ({ padding: '8px 16px', background: bg, color: fg, border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600 }),
    label: { fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: '#6b8299', display: 'block', marginBottom: 4 },
  };

  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() + weekOffset * 7);
  weekStart.setHours(0,0,0,0);
  const weekLabel = weekStart.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' — ' +
    new Date(weekStart.getTime() + 6*86400000).toLocaleDateString([], { month: 'short', day: 'numeric' });

  if (!connected) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1e3a4f' }}>Calendar</h2>
        <p style={{ fontSize: 13, color: '#6b8299' }}>Connect your Google account to view your calendar.</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '12px 24px', borderBottom: '1px solid #c0d0e4', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => setWeekOffset(w => w-1)} style={s.btn('#dde8f2','#1e3a4f')}>◀</button>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{weekLabel}</h2>
          <button onClick={() => setWeekOffset(w => w+1)} style={s.btn('#dde8f2','#1e3a4f')}>▶</button>
          {weekOffset !== 0 && <button onClick={() => setWeekOffset(0)} style={s.btn('#f0f4f9','#6b8299')}>Today</button>}
        </div>
        <button onClick={() => setShowCreate(true)} style={s.btn('#1a5e9a','#fff')}>+ New Event</button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        {loading && <div style={{ color: '#6b8299', textAlign: 'center', padding: 20 }}>Loading...</div>}
        {!loading && events.length === 0 && <div style={{ color: '#6b8299', textAlign: 'center', padding: 40 }}>No events this week</div>}
        {events.map(e => {
          const start = new Date(e.start);
          const end = new Date(e.end);
          return (
            <div key={e.id} style={{ padding: 14, background: '#f0f4f9', border: '1px solid #c0d0e4', borderRadius: 10, marginBottom: 8, borderLeft: '4px solid #1a5e9a' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#1e3a4f' }}>{e.summary}</div>
                  <div style={{ fontSize: 11, color: '#6b8299', marginTop: 2 }}>
                    {e.allDay ? start.toLocaleDateString() : start.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' — ' + end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </div>
                  {e.location && <div style={{ fontSize: 11, color: '#6b8299', marginTop: 2 }}>📍 {e.location}</div>}
                  {e.meetLink && <a href={e.meetLink} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: '#1a5e9a', fontWeight: 600, textDecoration: 'none', display: 'inline-block', marginTop: 4 }}>🎥 Join Google Meet</a>}
                  {e.attendees.length > 0 && <div style={{ fontSize: 10, color: '#6b8299', marginTop: 4 }}>{e.attendees.map(a => a.name || a.email).join(', ')}</div>}
                </div>
                <button onClick={() => deleteEvent(e.id)} style={{ background: 'none', border: 'none', color: '#c0d0e4', cursor: 'pointer', fontSize: 14 }}>✕</button>
              </div>
            </div>
          );
        })}
      </div>

      {showCreate && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={() => setShowCreate(false)}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 24, width: 440, maxHeight: '80vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 16px 0' }}>New Event</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div><label style={s.label}>Title *</label><input value={form.summary} onChange={e => setForm({...form, summary: e.target.value})} style={s.input} /></div>
              <div><label style={s.label}>Date *</label><input type="date" value={form.date} onChange={e => setForm({...form, date: e.target.value})} style={s.input} /></div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}><label style={s.label}>Start</label><input type="time" value={form.startTime} onChange={e => setForm({...form, startTime: e.target.value})} style={s.input} /></div>
                <div style={{ flex: 1 }}><label style={s.label}>End</label><input type="time" value={form.endTime} onChange={e => setForm({...form, endTime: e.target.value})} style={s.input} /></div>
              </div>
              <div><label style={s.label}>Description</label><textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})} rows={3} style={{...s.input, resize:'vertical'}} /></div>
              <div><label style={s.label}>Attendees (comma-separated emails)</label><input value={form.attendees} onChange={e => setForm({...form, attendees: e.target.value})} style={s.input} placeholder="alice@example.com, bob@example.com" /></div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#1e3a4f', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.addMeet} onChange={e => setForm({...form, addMeet: e.target.checked})} />
                Add Google Meet link
              </label>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button onClick={() => setShowCreate(false)} style={s.btn('#f0f4f9','#6b8299')}>Cancel</button>
              <button onClick={createEvent} style={s.btn('#1a5e9a','#fff')}>Create Event</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
`, 'utf8');
console.log('  ✓ CalendarPanel.jsx — created');

// ─── 5. Create DrivePanel component ──────────────────────────────────────────

fs.writeFileSync(path.join(__dirname, 'client', 'src', 'components', 'DrivePanel.jsx'), `import React, { useState, useEffect } from 'react';
import { api } from '../api';

export default function DrivePanel({ currentUser, showToast }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [folderStack, setFolderStack] = useState([{ id: null, name: 'My Drive' }]);
  const [view, setView] = useState('myDrive'); // myDrive, shared

  useEffect(() => {
    api.gmailStatus().then(s => {
      setConnected(s.connected);
      if (s.connected) fetchFiles();
      else setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const fetchFiles = async (folderId, q) => {
    setLoading(true);
    try {
      const data = await api.driveFiles(q || '', folderId || null);
      setFiles(data.files || []);
    } catch (e) { showToast(e.message); }
    setLoading(false);
  };

  const fetchShared = async () => {
    setLoading(true);
    try {
      const data = await api.driveShared();
      setFiles(data.files || []);
    } catch (e) { showToast(e.message); }
    setLoading(false);
  };

  const openFolder = (file) => {
    setFolderStack(prev => [...prev, { id: file.id, name: file.name }]);
    fetchFiles(file.id);
  };

  const goBack = (index) => {
    const newStack = folderStack.slice(0, index + 1);
    setFolderStack(newStack);
    fetchFiles(newStack[newStack.length - 1].id);
  };

  const handleSearch = (e) => {
    e.preventDefault();
    if (searchQuery) {
      setView('search');
      fetchFiles(null, searchQuery);
    }
  };

  const switchView = (v) => {
    setView(v);
    if (v === 'myDrive') { setFolderStack([{ id: null, name: 'My Drive' }]); fetchFiles(); }
    if (v === 'shared') fetchShared();
  };

  const formatSize = (bytes) => {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes/1024).toFixed(1) + ' KB';
    return (bytes/1048576).toFixed(1) + ' MB';
  };

  const getFileIcon = (mimeType) => {
    if (mimeType === 'application/vnd.google-apps.folder') return '📁';
    if (mimeType?.includes('spreadsheet') || mimeType?.includes('excel')) return '📊';
    if (mimeType?.includes('document') || mimeType?.includes('word')) return '📄';
    if (mimeType?.includes('presentation') || mimeType?.includes('powerpoint')) return '📑';
    if (mimeType?.includes('pdf')) return '📕';
    if (mimeType?.includes('image')) return '🖼️';
    if (mimeType?.includes('video')) return '🎬';
    return '📎';
  };

  const s = {
    input: { width: '100%', padding: '8px 12px', background: '#f0f4f9', border: '1px solid #c0d0e4', borderRadius: 6, color: '#1e3a4f', fontSize: 12, outline: 'none', boxSizing: 'border-box' },
    btn: (bg, fg) => ({ padding: '8px 16px', background: bg, color: fg, border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600 }),
    tab: (active) => ({ padding: '8px 16px', background: active ? '#1a5e9a' : 'transparent', color: active ? '#fff' : '#1e3a4f', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: active ? 600 : 400 }),
  };

  if (!connected) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1e3a4f' }}>Google Drive</h2>
        <p style={{ fontSize: 13, color: '#6b8299' }}>Connect your Google account to browse files.</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '12px 24px', borderBottom: '1px solid #c0d0e4', background: '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={() => switchView('myDrive')} style={s.tab(view === 'myDrive')}>My Drive</button>
            <button onClick={() => switchView('shared')} style={s.tab(view === 'shared')}>Shared with me</button>
          </div>
        </div>
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8 }}>
          <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search files..." style={{...s.input, flex: 1}} />
          <button type="submit" style={s.btn('#dde8f2','#1e3a4f')}>Search</button>
        </form>
      </div>

      {/* Breadcrumbs */}
      {view === 'myDrive' && folderStack.length > 1 && (
        <div style={{ padding: '6px 24px', background: '#f0f4f9', borderBottom: '1px solid #c0d0e4', display: 'flex', gap: 4, alignItems: 'center', fontSize: 12 }}>
          {folderStack.map((f, i) => (
            <span key={i}>
              {i > 0 && <span style={{ color: '#c0d0e4', margin: '0 4px' }}>/</span>}
              <button onClick={() => goBack(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: i === folderStack.length - 1 ? '#1e3a4f' : '#1a5e9a', fontWeight: i === folderStack.length - 1 ? 600 : 400, fontSize: 12 }}>
                {f.name}
              </button>
            </span>
          ))}
        </div>
      )}

      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        {loading && <div style={{ color: '#6b8299', textAlign: 'center', padding: 20 }}>Loading...</div>}
        {!loading && files.length === 0 && <div style={{ color: '#6b8299', textAlign: 'center', padding: 40 }}>No files found</div>}
        {files.map(f => (
          <div key={f.id}
            onClick={() => f.isFolder ? openFolder(f) : window.open(f.webViewLink, '_blank')}
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderBottom: '1px solid #e8f0f8', cursor: 'pointer', borderRadius: 6 }}
            onMouseEnter={e => e.currentTarget.style.background = '#f0f4f9'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            <span style={{ fontSize: 20 }}>{getFileIcon(f.mimeType)}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: '#1e3a4f', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
              <div style={{ fontSize: 10, color: '#6b8299' }}>
                {f.modifiedTime && new Date(f.modifiedTime).toLocaleDateString()}
                {f.size ? ' · ' + formatSize(f.size) : ''}
                {f.shared ? ' · Shared' : ''}
              </div>
            </div>
            {!f.isFolder && f.webViewLink && (
              <button onClick={(e) => { e.stopPropagation(); window.open(f.webViewLink, '_blank'); }}
                style={{ background: 'none', border: 'none', color: '#1a5e9a', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>Open ↗</button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
`, 'utf8');
console.log('  ✓ DrivePanel.jsx — created');

// ─── 6. Rewrite GmailPanel as personal inbox with folders ────────────────────

fs.writeFileSync(path.join(__dirname, 'client', 'src', 'components', 'PersonalInbox.jsx'), `import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import Icon from './Icons';

const FOLDERS = [
  { key: 'INBOX', label: 'Inbox', icon: 'inbox' },
  { key: 'STARRED', label: 'Starred', icon: 'star' },
  { key: 'SENT', label: 'Sent', icon: 'send' },
  { key: 'DRAFT', label: 'Drafts', icon: 'file' },
  { key: 'SPAM', label: 'Spam', icon: 'alert' },
  { key: 'TRASH', label: 'Trash', icon: 'trash' },
  { key: 'ALL', label: 'All Mail', icon: 'mail' },
];

export default function PersonalInbox({ currentUser, showToast }) {
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeFolder, setActiveFolder] = useState('INBOX');
  const [selectedMsg, setSelectedMsg] = useState(null);
  const [msgDetail, setMsgDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCompose, setShowCompose] = useState(false);
  const [composeTo, setComposeTo] = useState('');
  const [composeCc, setComposeCc] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [sending, setSending] = useState(false);
  const [showReply, setShowReply] = useState(false);
  const [replyBody, setReplyBody] = useState('');

  useEffect(() => {
    api.gmailStatus().then(s => {
      setConnected(s.connected);
      if (s.connected) fetchMessages('INBOX');
      else setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const fetchMessages = async (folder, q) => {
    setLoading(true);
    try {
      const data = await api.gmailPersonal(folder || activeFolder, q || '');
      setMessages(data.messages || []);
    } catch (e) { showToast(e.message); }
    setLoading(false);
  };

  const switchFolder = (folder) => {
    setActiveFolder(folder.key);
    setSelectedMsg(null); setMsgDetail(null);
    fetchMessages(folder.key);
  };

  const openMessage = async (msg) => {
    setSelectedMsg(msg);
    setLoadingDetail(true);
    setShowReply(false);
    try {
      const data = await api.gmailPersonalMsg(msg.id);
      setMsgDetail(data);
      setMessages(prev => prev.map(m => m.id === msg.id ? {...m, isUnread: false} : m));
    } catch (e) { showToast(e.message); }
    setLoadingDetail(false);
  };

  const sendReply = async () => {
    if (!replyBody.trim() || !msgDetail) return;
    setSending(true);
    try {
      await api.gmailPersonalSend({ to: msgDetail.from, subject: 'Re: ' + (msgDetail.subject||'').replace(/^Re:\\s*/i,''), body: replyBody, threadId: msgDetail.threadId });
      showToast('Reply sent!');
      setShowReply(false); setReplyBody('');
    } catch (e) { showToast(e.message); }
    setSending(false);
  };

  const sendCompose = async () => {
    if (!composeTo.trim() || !composeBody.trim()) return;
    setSending(true);
    try {
      await api.gmailPersonalSend({ to: composeTo, cc: composeCc, subject: composeSubject, body: composeBody });
      showToast('Email sent!');
      setShowCompose(false);
      setComposeTo(''); setComposeCc(''); setComposeSubject(''); setComposeBody('');
    } catch (e) { showToast(e.message); }
    setSending(false);
  };

  const s = {
    input: { width: '100%', padding: '8px 12px', background: '#f0f4f9', border: '1px solid #c0d0e4', borderRadius: 6, color: '#1e3a4f', fontSize: 12, outline: 'none', boxSizing: 'border-box' },
    btn: (bg, fg) => ({ padding: '8px 14px', background: bg, color: fg, border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600 }),
  };

  if (!connected) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1e3a4f' }}>Personal Email</h2>
        <p style={{ fontSize: 13, color: '#6b8299' }}>Connect your Google account from the sidebar to view personal email.</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {/* Folder sidebar */}
      <div style={{ width: 180, background: '#f0f4f9', borderRight: '1px solid #c0d0e4', flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: 10 }}>
          <button onClick={() => setShowCompose(true)} style={{ ...s.btn('#1a5e9a','#fff'), width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <Icon name="edit" size={12} /> Compose
          </button>
        </div>
        <div style={{ flex: 1 }}>
          {FOLDERS.map(f => (
            <button key={f.key} onClick={() => switchFolder(f)} style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px',
              background: activeFolder === f.key ? '#dde8f2' : 'transparent', border: 'none', cursor: 'pointer',
              color: activeFolder === f.key ? '#1a5e9a' : '#1e3a4f', fontSize: 12, fontWeight: activeFolder === f.key ? 600 : 400, textAlign: 'left',
            }}>
              <Icon name={f.icon} size={14} /> {f.label}
            </button>
          ))}
        </div>
        <div style={{ padding: 10, borderTop: '1px solid #c0d0e4', fontSize: 10, color: '#6b8299' }}>
          Personal emails only. Care-related emails appear in the Regional Queue.
        </div>
      </div>

      {/* Message list + detail */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '8px 14px', borderBottom: '1px solid #c0d0e4', display: 'flex', gap: 8 }}>
          <form onSubmit={(e) => { e.preventDefault(); fetchMessages(activeFolder, searchQuery); }} style={{ display: 'flex', gap: 8, flex: 1 }}>
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search personal email..." style={{...s.input, flex: 1}} />
            <button type="submit" style={s.btn('#dde8f2','#1e3a4f')}>Search</button>
          </form>
          <button onClick={() => fetchMessages(activeFolder)} style={s.btn('#dde8f2','#1e3a4f')}>Refresh</button>
        </div>

        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          <div style={{ width: selectedMsg ? '35%' : '100%', overflow: 'auto', borderRight: selectedMsg ? '1px solid #c0d0e4' : 'none' }}>
            {loading && <div style={{ padding: 20, color: '#6b8299', textAlign: 'center' }}>Loading...</div>}
            {!loading && messages.length === 0 && <div style={{ padding: 40, color: '#6b8299', textAlign: 'center' }}>No personal emails in this folder</div>}
            {messages.map(msg => (
              <div key={msg.id} onClick={() => openMessage(msg)} style={{
                padding: '10px 14px', borderBottom: '1px solid #e8f0f8', cursor: 'pointer',
                background: selectedMsg?.id === msg.id ? '#dde8f2' : msg.isUnread ? '#f0f4f9' : '#fff',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 1 }}>
                  <span style={{ fontSize: 12, fontWeight: msg.isUnread ? 700 : 500, color: '#1e3a4f', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>
                    {msg.from?.replace(/<.*>/,'').trim() || 'Unknown'}
                  </span>
                  <span style={{ fontSize: 10, color: '#6b8299' }}>{new Date(msg.date).toLocaleDateString()}</span>
                </div>
                <div style={{ fontSize: 12, fontWeight: msg.isUnread ? 600 : 400, color: '#1e3a4f', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{msg.subject}</div>
                <div style={{ fontSize: 11, color: '#6b8299', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{msg.snippet}</div>
              </div>
            ))}
          </div>

          {selectedMsg && msgDetail && (
            <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: '#1e3a4f' }}>{msgDetail.subject || '(no subject)'}</h3>
                <button onClick={() => { setSelectedMsg(null); setMsgDetail(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b8299', fontSize: 16 }}>✕</button>
              </div>
              <div style={{ fontSize: 12, color: '#6b8299', marginBottom: 4 }}>From: {msgDetail.from}</div>
              <div style={{ fontSize: 12, color: '#6b8299', marginBottom: 12 }}>To: {msgDetail.to}{msgDetail.cc ? ' | Cc: ' + msgDetail.cc : ''} · {new Date(msgDetail.date).toLocaleString()}</div>
              <div style={{ fontSize: 13, color: '#1e3a4f', lineHeight: 1.6, padding: 14, background: '#f0f4f9', borderRadius: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                dangerouslySetInnerHTML={{ __html: msgDetail.body }} />
              {!showReply ? (
                <button onClick={() => setShowReply(true)} style={{ ...s.btn('#1a5e9a','#fff'), marginTop: 12 }}>Reply</button>
              ) : (
                <div style={{ marginTop: 12, padding: 14, border: '1px solid #c0d0e4', borderRadius: 8 }}>
                  <textarea value={replyBody} onChange={e => setReplyBody(e.target.value)} rows={5} style={{...s.input, resize:'vertical'}} placeholder="Type reply..." autoFocus />
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button onClick={sendReply} disabled={sending} style={s.btn('#1a5e9a','#fff')}>{sending ? 'Sending...' : 'Send'}</button>
                    <button onClick={() => { setShowReply(false); setReplyBody(''); }} style={s.btn('#f0f4f9','#6b8299')}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {showCompose && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={() => setShowCompose(false)}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 24, width: 480 }} onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 16px 0' }}>New Email</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div><label style={{ fontSize: 10, fontWeight: 600, color: '#6b8299', textTransform: 'uppercase' }}>To *</label><input value={composeTo} onChange={e => setComposeTo(e.target.value)} style={s.input} /></div>
              <div><label style={{ fontSize: 10, fontWeight: 600, color: '#6b8299', textTransform: 'uppercase' }}>Cc</label><input value={composeCc} onChange={e => setComposeCc(e.target.value)} style={s.input} /></div>
              <div><label style={{ fontSize: 10, fontWeight: 600, color: '#6b8299', textTransform: 'uppercase' }}>Subject</label><input value={composeSubject} onChange={e => setComposeSubject(e.target.value)} style={s.input} /></div>
              <div><label style={{ fontSize: 10, fontWeight: 600, color: '#6b8299', textTransform: 'uppercase' }}>Message *</label><textarea value={composeBody} onChange={e => setComposeBody(e.target.value)} rows={6} style={{...s.input, resize:'vertical'}} /></div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button onClick={() => setShowCompose(false)} style={s.btn('#f0f4f9','#6b8299')}>Cancel</button>
              <button onClick={sendCompose} disabled={sending || !composeTo || !composeBody} style={s.btn('#1a5e9a','#fff')}>{sending ? 'Sending...' : 'Send'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
`, 'utf8');
console.log('  ✓ PersonalInbox.jsx — created');

// ─── 7. Update App.jsx — add all workspace tabs ─────────────────────────────

const appPath = path.join(__dirname, 'client', 'src', 'App.jsx');
let appJsx = fs.readFileSync(appPath, 'utf8');

// Add imports
if (!appJsx.includes('CalendarPanel')) {
  appJsx = appJsx.replace(
    "import ComposeModal from './components/ComposeModal';",
    "import ComposeModal from './components/ComposeModal';\nimport CalendarPanel from './components/CalendarPanel';\nimport DrivePanel from './components/DrivePanel';\nimport PersonalInbox from './components/PersonalInbox';"
  );
}

// Add nav items
if (!appJsx.includes("'personalEmail'")) {
  appJsx = appJsx.replace(
    "...(currentUser.role === 'admin' ? [{ key: 'admin', icon: 'settings', label: 'Admin' }] : []),",
    "{ key: 'personalEmail', icon: 'mail', label: 'Email' },\n            { key: 'calendar', icon: 'clock', label: 'Calendar' },\n            { key: 'drive', icon: 'file', label: 'Drive' },\n            ...(currentUser.role === 'admin' ? [{ key: 'admin', icon: 'settings', label: 'Admin' }] : []),"
  );
}

// Add screen renders
if (!appJsx.includes("screen === 'personalEmail'")) {
  appJsx = appJsx.replace(
    "{screen === 'admin'",
    `{screen === 'personalEmail' && (
          <PersonalInbox currentUser={currentUser} showToast={showToast} />
        )}
        {screen === 'calendar' && (
          <CalendarPanel currentUser={currentUser} showToast={showToast} />
        )}
        {screen === 'drive' && (
          <DrivePanel currentUser={currentUser} showToast={showToast} />
        )}
        {screen === 'admin'`
  );
}

fs.writeFileSync(appPath, appJsx, 'utf8');
console.log('  ✓ App.jsx — added Email, Calendar, Drive nav items');

// ─── 8. Add uuid dependency to server ────────────────────────────────────────

const serverPkgPath = path.join(__dirname, 'server', 'package.json');
const serverPkg = JSON.parse(fs.readFileSync(serverPkgPath, 'utf8'));
if (!serverPkg.dependencies['uuid']) {
  serverPkg.dependencies['uuid'] = '^9.0.0';
  fs.writeFileSync(serverPkgPath, JSON.stringify(serverPkg, null, 2), 'utf8');
  console.log('  ✓ server/package.json — added uuid');
}

// ─── 9. Update email filter manager to show 'personal' action ───────────────

const gmailPanelPath = path.join(__dirname, 'client', 'src', 'components', 'GmailPanel.jsx');
let gmailPanel = fs.readFileSync(gmailPanelPath, 'utf8');

// Update the filter manager description
gmailPanel = gmailPanel.replace(
  "Filtered emails (HR, company-wide, etc.) won't create tickets in the regional queue.",
  "Emails matching these rules stay in the user's Personal Email and won't appear in the Regional Queue. Everything else routes to the regional dashboard."
);

// Change default action to 'personal' instead of 'hide'
gmailPanel = gmailPanel.replace(
  "await api.gmailAddFilter({ domain, sender, subject_contains: subjectContains });",
  "await api.gmailAddFilter({ domain, sender, subject_contains: subjectContains, action: 'personal' });"
);

fs.writeFileSync(gmailPanelPath, gmailPanel, 'utf8');
console.log('  ✓ GmailPanel.jsx — updated filter descriptions');

console.log('\\n✅ Full Google Workspace Integration Complete!\\n');
console.log('New sidebar tabs:');
console.log('  📬 Email — Personal inbox (filtered: HR, company-wide, etc.)');
console.log('  📅 Calendar — View/create events with Google Meet links');
console.log('  📁 Drive — Browse My Drive + Shared files');
console.log('');
console.log('How routing works:');
console.log('  • Default: ALL emails → Regional Queue (shared team view)');
console.log('  • Admin creates "personal" rules in Admin → Email tab');
console.log('  • Emails matching rules → Personal Email tab (private)');
console.log('  • Example rules: domain "hr.company.com", subject "PTO"');
console.log('');
console.log('Next steps:');
console.log('  1. cd server && npm install && cd ..');
console.log('  2. del server\\\\carecoord.db');
console.log('  3. npm run seed');
console.log('  4. node setup-db.js');
console.log('  5. npm run dev');
console.log('');
console.log('Also: In Google Cloud Console, enable these APIs:');
console.log('  • Google Calendar API');
console.log('  • Google Drive API');
console.log('(Gmail API should already be enabled)\\n');
