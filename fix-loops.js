// fix-loops.js
const fs = require('fs');
const path = require('path');

// 1. Fix GmailConnectButton — only check status ONCE, never re-check
const panelPath = path.join(__dirname, 'client', 'src', 'components', 'GmailPanel.jsx');
let panel = fs.readFileSync(panelPath, 'utf8');

// Rewrite the whole file cleanly
fs.writeFileSync(panelPath, `import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api';
import Icon from './Icons';

export function GmailConnectButton({ showToast }) {
  const [status, setStatus] = useState({ connected: false, email: null });
  const [loading, setLoading] = useState(true);
  const checkedRef = useRef(false);

  useEffect(() => {
    if (checkedRef.current) return;
    checkedRef.current = true;
    api.gmailStatus().then(s => { setStatus(s); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const connect = async () => {
    try {
      const data = await api.gmailAuth();
      window.open(data.authUrl, '_blank', 'width=500,height=600');
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        if (attempts > 60) { clearInterval(poll); return; }
        try {
          const s = await api.gmailStatus();
          if (s.connected) {
            clearInterval(poll);
            setStatus(s);
            if (showToast) showToast('Google Workspace connected!');
          }
        } catch (e) {}
      }, 2000);
    } catch (e) { if (showToast) showToast(e.message); }
  };

  const disconnect = async () => {
    if (!confirm('Disconnect Google Workspace?')) return;
    await api.gmailDisconnect();
    setStatus({ connected: false, email: null });
    if (showToast) showToast('Google Workspace disconnected');
  };

  if (loading) return null;

  if (status.connected) {
    return (
      <div style={{ padding: '8px 12px', background: '#102f54', borderRadius: 6, marginBottom: 8 }}>
        <div style={{ fontSize: 10, color: '#a8c8e8', marginBottom: 2 }}>Google Workspace</div>
        <div style={{ fontSize: 11, color: '#ffffff', fontWeight: 500, marginBottom: 4 }}>{status.email}</div>
        <button onClick={disconnect} style={{ fontSize: 10, color: '#a8c8e8', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <button onClick={connect} style={{
      width: '100%', padding: '8px 12px', background: '#1a5e9a', color: '#fff', border: 'none',
      borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600, marginBottom: 8,
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    }}>
      <Icon name="mail" size={12} /> Connect Google Workspace
    </button>
  );
}

export function EmailFilterManager({ showToast }) {
  const [filters, setFilters] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddFilter, setShowAddFilter] = useState(false);
  const [domain, setDomain] = useState('');
  const [sender, setSender] = useState('');
  const [subjectContains, setSubjectContains] = useState('');
  const [syncing, setSyncing] = useState(false);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    Promise.all([api.gmailFilters(), api.gmailAccounts()])
      .then(([f, a]) => { setFilters(f.filters || []); setAccounts(a.accounts || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const syncNow = async () => {
    setSyncing(true);
    try {
      const result = await api.gmailSync();
      showToast('Synced ' + result.synced + ' new emails');
      loadedRef.current = false;
    } catch (e) { showToast(e.message); }
    setSyncing(false);
  };

  const addFilter = async () => {
    if (!domain && !sender && !subjectContains) return;
    try {
      await api.gmailAddFilter({ domain, sender, subject_contains: subjectContains, action: 'personal' });
      setDomain(''); setSender(''); setSubjectContains('');
      setShowAddFilter(false);
      const f = await api.gmailFilters();
      setFilters(f.filters || []);
      showToast('Rule added');
    } catch (e) { showToast(e.message); }
  };

  const deleteFilter = async (id) => {
    await api.gmailDeleteFilter(id);
    const f = await api.gmailFilters();
    setFilters(f.filters || []);
    showToast('Rule removed');
  };

  const s = {
    card: { background: '#f0f4f9', border: '1px solid #c0d0e4', borderRadius: 10, padding: 14, marginBottom: 8 },
    input: { width: '100%', padding: '8px 12px', background: '#ffffff', border: '1px solid #c0d0e4', borderRadius: 6, color: '#1e3a4f', fontSize: 12, outline: 'none', boxSizing: 'border-box' },
    label: { fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: '#6b8299', display: 'block', marginBottom: 4 },
    btn: (bg, fg) => ({ padding: '6px 14px', background: bg, color: fg, border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600 }),
  };

  if (loading) return <div style={{ padding: 20, color: '#6b8299' }}>Loading...</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0, color: '#1e3a4f' }}>Connected Accounts</h3>
        <button onClick={syncNow} disabled={syncing} style={s.btn('#1a5e9a', '#fff')}>
          {syncing ? 'Syncing...' : 'Sync Now'}
        </button>
      </div>
      {accounts.length === 0 && <div style={{ ...s.card, color: '#6b8299', fontSize: 12 }}>No accounts connected.</div>}
      {accounts.map(a => (
        <div key={a.userId} style={{ ...s.card, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#1e3a4f' }}>{a.name}</div>
            <div style={{ fontSize: 11, color: '#6b8299' }}>{a.email}</div>
          </div>
          <div style={{ fontSize: 10, color: '#6b8299' }}>{a.lastSync ? 'Last sync: ' + new Date(a.lastSync).toLocaleString() : 'Never synced'}</div>
        </div>
      ))}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 24, marginBottom: 12 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0, color: '#1e3a4f' }}>Email Routing Rules</h3>
        <button onClick={() => setShowAddFilter(!showAddFilter)} style={s.btn('#1a5e9a', '#fff')}>+ Add Rule</button>
      </div>
      <div style={{ fontSize: 11, color: '#6b8299', marginBottom: 12 }}>
        Emails matching these rules stay in Personal Email. Everything else routes to the Regional Queue.
      </div>
      {showAddFilter && (
        <div style={{ ...s.card, marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <div style={{ flex: 1 }}><label style={s.label}>Domain</label><input value={domain} onChange={e => setDomain(e.target.value)} style={s.input} placeholder="e.g. hr.company.com" /></div>
            <div style={{ flex: 1 }}><label style={s.label}>Sender</label><input value={sender} onChange={e => setSender(e.target.value)} style={s.input} placeholder="e.g. noreply@" /></div>
            <div style={{ flex: 1 }}><label style={s.label}>Subject Contains</label><input value={subjectContains} onChange={e => setSubjectContains(e.target.value)} style={s.input} placeholder="e.g. All Hands" /></div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => setShowAddFilter(false)} style={s.btn('#f0f4f9', '#6b8299')}>Cancel</button>
            <button onClick={addFilter} style={s.btn('#1a5e9a', '#fff')}>Add Rule</button>
          </div>
        </div>
      )}
      {filters.length === 0 && !showAddFilter && <div style={{ ...s.card, color: '#6b8299', fontSize: 12 }}>No rules set. All emails route to Regional Queue.</div>}
      {filters.map(f => (
        <div key={f.id} style={{ ...s.card, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 12, color: '#1e3a4f' }}>
            {f.domain && <span>Domain: <strong>{f.domain}</strong> </span>}
            {f.sender && <span>Sender: <strong>{f.sender}</strong> </span>}
            {f.subject_contains && <span>Subject: <strong>{f.subject_contains}</strong> </span>}
          </div>
          <button onClick={() => deleteFilter(f.id)} style={s.btn('#f0f4f9', '#d94040')}>Remove</button>
        </div>
      ))}
    </div>
  );
}

export default function GmailPanel() { return null; }
`, 'utf8');
console.log('  ✓ GmailPanel.jsx — stable, no re-render loops');

// 2. Fix CalendarPanel — use ref to prevent double-load
const calPath = path.join(__dirname, 'client', 'src', 'components', 'CalendarPanel.jsx');
let cal = fs.readFileSync(calPath, 'utf8');

// Replace the problematic useEffect
cal = cal.replace(
  /useEffect\(\(\) => \{[\s\S]*?\}, \[weekOffset\]\);/,
  `useEffect(() => {
    let cancelled = false;
    api.gmailStatus().then(s => {
      if (cancelled) return;
      setConnected(s.connected);
      if (!s.connected) { setLoading(false); return; }
      setLoading(true);
      const start = new Date();
      start.setDate(start.getDate() + weekOffset * 7);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      api.calendarEvents(start.toISOString(), end.toISOString())
        .then(data => { if (!cancelled) setEvents(data.events || []); })
        .catch(() => {})
        .finally(() => { if (!cancelled) setLoading(false); });
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [weekOffset]);`
);

fs.writeFileSync(calPath, cal, 'utf8');
console.log('  ✓ CalendarPanel.jsx — stable');

// 3. Fix DrivePanel
const drivePath = path.join(__dirname, 'client', 'src', 'components', 'DrivePanel.jsx');
let drive = fs.readFileSync(drivePath, 'utf8');

drive = drive.replace(
  /useEffect\(\(\) => \{[\s\S]*?\}, \[\]\);/,
  `useEffect(() => {
    let cancelled = false;
    api.gmailStatus().then(s => {
      if (cancelled) return;
      setConnected(s.connected);
      if (!s.connected) { setLoading(false); return; }
      setLoading(true);
      api.driveFiles('', null)
        .then(data => { if (!cancelled) setFiles(data.files || []); })
        .catch(() => {})
        .finally(() => { if (!cancelled) setLoading(false); });
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);`
);

fs.writeFileSync(drivePath, drive, 'utf8');
console.log('  ✓ DrivePanel.jsx — stable');

// 4. Fix PersonalInbox
const inboxPath = path.join(__dirname, 'client', 'src', 'components', 'PersonalInbox.jsx');
let inbox = fs.readFileSync(inboxPath, 'utf8');

inbox = inbox.replace(
  /useEffect\(\(\) => \{[\s\S]*?\}, \[\]\);/,
  `useEffect(() => {
    let cancelled = false;
    api.gmailStatus().then(s => {
      if (cancelled) return;
      setConnected(s.connected);
      if (!s.connected) { setLoading(false); return; }
      setLoading(true);
      api.gmailPersonal('INBOX', '')
        .then(data => { if (!cancelled) setMessages(data.messages || []); })
        .catch(() => {})
        .finally(() => { if (!cancelled) setLoading(false); });
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);`
);

fs.writeFileSync(inboxPath, inbox, 'utf8');
console.log('  ✓ PersonalInbox.jsx — stable');

// 5. Remove any useEmailSync from App.jsx if it was added
const appPath = path.join(__dirname, 'client', 'src', 'App.jsx');
let app = fs.readFileSync(appPath, 'utf8');
app = app.replace(/\n\/\/ Background email sync\nfunction useEmailSync[\s\S]*?\n\}/, '');
app = app.replace('useEmailSync(!!currentUser);\n  ', '');
fs.writeFileSync(appPath, app, 'utf8');
console.log('  ✓ App.jsx — removed background sync (was causing loops)');

console.log('\n✅ All loops fixed. Refresh browser.');
