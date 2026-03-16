// fix-sidebar-and-gmail.js
const fs = require('fs');
const path = require('path');

console.log('\n🔧 Fixing sidebar colors + Gmail folders...\n');

// ─── 1. Fix sidebar unselected text color ────────────────────────────────────

const appPath = path.join(__dirname, 'client', 'src', 'App.jsx');
let app = fs.readFileSync(appPath, 'utf8');

// Make unselected items brighter/more readable
app = app.replace(
  "color: screen === item.key ? '#ffffff' : '#a8c8e8',",
  "color: screen === item.key ? '#ffffff' : '#d0e4f4',"
);

fs.writeFileSync(appPath, app, 'utf8');
console.log('  ✓ App.jsx — sidebar unselected text now lighter/more readable');

// ─── 2. Rewrite GmailPanel with folder sidebar ──────────────────────────────

fs.writeFileSync(path.join(__dirname, 'client', 'src', 'components', 'GmailPanel.jsx'), `import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import Icon from './Icons';

const FOLDERS = [
  { key: 'INBOX', label: 'Inbox', icon: 'inbox', query: 'in:inbox' },
  { key: 'STARRED', label: 'Starred', icon: 'star', query: 'is:starred' },
  { key: 'SENT', label: 'Sent', icon: 'send', query: 'in:sent' },
  { key: 'DRAFT', label: 'Drafts', icon: 'file', query: 'in:drafts' },
  { key: 'SPAM', label: 'Spam', icon: 'alert', query: 'in:spam' },
  { key: 'TRASH', label: 'Trash', icon: 'trash', query: 'in:trash' },
  { key: 'ALL', label: 'All Mail', icon: 'mail', query: '' },
];

export default function GmailPanel({ currentUser, showToast }) {
  const [connected, setConnected] = useState(false);
  const [gmailEmail, setGmailEmail] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeFolder, setActiveFolder] = useState('INBOX');
  const [selectedMsg, setSelectedMsg] = useState(null);
  const [msgDetail, setMsgDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showReply, setShowReply] = useState(false);
  const [replyBody, setReplyBody] = useState('');
  const [sending, setSending] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [composeTo, setComposeTo] = useState('');
  const [composeCc, setComposeCc] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');

  const checkStatus = useCallback(async () => {
    try {
      const data = await api.gmailStatus();
      setConnected(data.connected);
      setGmailEmail(data.email);
      if (data.connected) fetchMessages('in:inbox');
      else setLoading(false);
    } catch (e) { setLoading(false); }
  }, []);

  useEffect(() => { checkStatus(); }, [checkStatus]);

  const connectGmail = async () => {
    try {
      const data = await api.gmailAuth();
      window.open(data.authUrl, '_blank', 'width=500,height=600');
      const poll = setInterval(async () => {
        const status = await api.gmailStatus();
        if (status.connected) {
          clearInterval(poll);
          setConnected(true);
          setGmailEmail(status.email);
          fetchMessages('in:inbox');
        }
      }, 2000);
      setTimeout(() => clearInterval(poll), 120000);
    } catch (e) { showToast(e.message); }
  };

  const disconnectGmail = async () => {
    if (!confirm('Disconnect Gmail?')) return;
    await api.gmailDisconnect();
    setConnected(false);
    setGmailEmail(null);
    setMessages([]);
  };

  const fetchMessages = async (q) => {
    setLoading(true);
    try {
      const data = await api.gmailMessages(q || '');
      setMessages(data.messages || []);
    } catch (e) { showToast(e.message); }
    setLoading(false);
  };

  const switchFolder = (folder) => {
    setActiveFolder(folder.key);
    setSelectedMsg(null);
    setMsgDetail(null);
    setSearchQuery('');
    fetchMessages(folder.query);
  };

  const handleSearch = (e) => {
    e.preventDefault();
    setActiveFolder(null);
    setSelectedMsg(null);
    setMsgDetail(null);
    fetchMessages(searchQuery);
  };

  const openMessage = async (msg) => {
    setSelectedMsg(msg);
    setLoadingDetail(true);
    setShowReply(false);
    try {
      const data = await api.gmailThread(msg.threadId);
      setMsgDetail(data);
      if (msg.isUnread) {
        await api.gmailMarkRead(msg.id);
        setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, isUnread: false } : m));
      }
    } catch (e) { showToast(e.message); }
    setLoadingDetail(false);
  };

  const sendReply = async () => {
    if (!replyBody.trim() || !msgDetail) return;
    setSending(true);
    try {
      const lastMsg = msgDetail.messages[msgDetail.messages.length - 1];
      await api.gmailSend({
        to: lastMsg.from,
        subject: 'Re: ' + (lastMsg.subject || '').replace(/^Re:\\s*/i, ''),
        body: replyBody,
        threadId: msgDetail.threadId,
      });
      showToast('Reply sent!');
      setShowReply(false);
      setReplyBody('');
      openMessage(selectedMsg);
    } catch (e) { showToast(e.message); }
    setSending(false);
  };

  const sendCompose = async () => {
    if (!composeTo.trim() || !composeBody.trim()) return;
    setSending(true);
    try {
      await api.gmailSend({
        to: composeTo,
        cc: composeCc || undefined,
        subject: composeSubject,
        body: composeBody,
      });
      showToast('Email sent!');
      setShowCompose(false);
      setComposeTo(''); setComposeCc(''); setComposeSubject(''); setComposeBody('');
      const folder = FOLDERS.find(f => f.key === activeFolder);
      fetchMessages(folder ? folder.query : 'in:inbox');
    } catch (e) { showToast(e.message); }
    setSending(false);
  };

  const archiveMessage = async (msg) => {
    try {
      await api.gmailLabels(msg.id, [], ['INBOX']);
      showToast('Archived');
      setMessages(prev => prev.filter(m => m.id !== msg.id));
      if (selectedMsg?.id === msg.id) { setSelectedMsg(null); setMsgDetail(null); }
    } catch (e) { showToast(e.message); }
  };

  const trashMessage = async (msg) => {
    try {
      await api.gmailLabels(msg.id, ['TRASH'], ['INBOX']);
      showToast('Moved to trash');
      setMessages(prev => prev.filter(m => m.id !== msg.id));
      if (selectedMsg?.id === msg.id) { setSelectedMsg(null); setMsgDetail(null); }
    } catch (e) { showToast(e.message); }
  };

  const starMessage = async (msg) => {
    try {
      const isStarred = msg.labels?.includes('STARRED');
      if (isStarred) {
        await api.gmailLabels(msg.id, [], ['STARRED']);
      } else {
        await api.gmailLabels(msg.id, ['STARRED'], []);
      }
      setMessages(prev => prev.map(m => m.id === msg.id ? {
        ...m, labels: isStarred ? m.labels.filter(l => l !== 'STARRED') : [...(m.labels || []), 'STARRED']
      } : m));
    } catch (e) { showToast(e.message); }
  };

  const s = {
    input: { width: '100%', padding: '10px 14px', background: '#f0f4f9', border: '1px solid #c0d0e4', borderRadius: 8, color: '#1e3a4f', fontSize: 13, outline: 'none', boxSizing: 'border-box' },
    btn: (bg, fg) => ({ padding: '8px 16px', background: bg, color: fg, border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600 }),
    label: { fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: '#6b8299', display: 'block', marginBottom: 4 },
  };

  // ── Not connected ──────────────────────────────────────────────────────────

  if (!connected && !loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 16 }}>
        <div style={{ width: 64, height: 64, borderRadius: 16, background: '#e8f0f8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="mail" size={32} />
        </div>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1e3a4f' }}>Connect Gmail</h2>
        <p style={{ fontSize: 13, color: '#6b8299', maxWidth: 360, textAlign: 'center' }}>
          Connect your Gmail account to read and send emails directly from CareCoord.
        </p>
        <button onClick={connectGmail} style={s.btn('#1a5e9a', '#fff')}>
          Connect Gmail Account
        </button>
      </div>
    );
  }

  // ── Connected ──────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {/* ── Gmail Folder Sidebar ── */}
      <div style={{ width: 200, background: '#f0f4f9', borderRight: '1px solid #c0d0e4', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        {/* Compose button */}
        <div style={{ padding: 12 }}>
          <button onClick={() => setShowCompose(true)}
            style={{ width: '100%', padding: '10px 16px', background: '#1a5e9a', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <Icon name="edit" size={14} /> Compose
          </button>
        </div>

        {/* Folders */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {FOLDERS.map(folder => {
            const isActive = activeFolder === folder.key;
            const unreadCount = folder.key === 'INBOX' ? messages.filter(m => m.isUnread && activeFolder === 'INBOX').length : 0;
            return (
              <button key={folder.key} onClick={() => switchFolder(folder)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px',
                  background: isActive ? '#dde8f2' : 'transparent', border: 'none', cursor: 'pointer',
                  color: isActive ? '#1a5e9a' : '#1e3a4f', fontSize: 13, fontWeight: isActive ? 600 : 400,
                  textAlign: 'left', borderRadius: 0,
                }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = '#e8f0f8'; }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}>
                <Icon name={folder.icon} size={16} />
                <span style={{ flex: 1 }}>{folder.label}</span>
                {unreadCount > 0 && (
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#1a5e9a' }}>{unreadCount}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Account info */}
        <div style={{ padding: 12, borderTop: '1px solid #c0d0e4' }}>
          <div style={{ fontSize: 11, color: '#6b8299', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {gmailEmail}
          </div>
          <button onClick={disconnectGmail}
            style={{ width: '100%', padding: '6px', background: 'none', border: '1px solid #c0d0e4', borderRadius: 6, color: '#6b8299', cursor: 'pointer', fontSize: 11 }}
            onMouseEnter={e => { e.currentTarget.style.color = '#d94040'; e.currentTarget.style.borderColor = '#d94040'; }}
            onMouseLeave={e => { e.currentTarget.style.color = '#6b8299'; e.currentTarget.style.borderColor = '#c0d0e4'; }}>
            Disconnect
          </button>
        </div>
      </div>

      {/* ── Main content ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Search bar */}
        <div style={{ padding: '10px 16px', borderBottom: '1px solid #c0d0e4', background: '#ffffff', display: 'flex', gap: 8, alignItems: 'center' }}>
          <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8, flex: 1 }}>
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search emails..." style={{ ...s.input, flex: 1, padding: '8px 14px' }} />
            <button type="submit" style={s.btn('#dde8f2', '#1e3a4f')}>Search</button>
          </form>
          <button onClick={() => { const folder = FOLDERS.find(f => f.key === activeFolder); fetchMessages(folder ? folder.query : 'in:inbox'); }}
            style={s.btn('#dde8f2', '#1e3a4f')}>Refresh</button>
        </div>

        {/* Message list + detail */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* Message list */}
          <div style={{ width: selectedMsg ? '35%' : '100%', borderRight: selectedMsg ? '1px solid #c0d0e4' : 'none', overflow: 'auto', transition: 'width 0.2s' }}>
            {loading && <div style={{ padding: 24, color: '#6b8299', textAlign: 'center' }}>Loading...</div>}
            {!loading && messages.length === 0 && (
              <div style={{ padding: 40, color: '#6b8299', textAlign: 'center' }}>
                <div style={{ fontSize: 14 }}>No messages</div>
                <div style={{ fontSize: 12, marginTop: 4 }}>This folder is empty</div>
              </div>
            )}
            {messages.map(msg => (
              <div key={msg.id} onClick={() => openMessage(msg)}
                style={{
                  padding: '10px 16px', borderBottom: '1px solid #e8f0f8', cursor: 'pointer',
                  background: selectedMsg?.id === msg.id ? '#dde8f2' : msg.isUnread ? '#f0f4f9' : '#ffffff',
                  display: 'flex', alignItems: 'flex-start', gap: 8,
                }}>
                {/* Star */}
                <button onClick={(e) => { e.stopPropagation(); starMessage(msg); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, flexShrink: 0, marginTop: 2 }}>
                  <span style={{ color: msg.labels?.includes('STARRED') ? '#e87e22' : '#c0d0e4', fontSize: 16 }}>
                    {msg.labels?.includes('STARRED') ? '★' : '☆'}
                  </span>
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 1 }}>
                    <span style={{ fontSize: 12, fontWeight: msg.isUnread ? 700 : 500, color: '#1e3a4f', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>
                      {msg.from?.replace(/<.*>/, '').trim() || 'Unknown'}
                    </span>
                    <span style={{ fontSize: 10, color: '#6b8299', flexShrink: 0 }}>
                      {formatDate(msg.date)}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: msg.isUnread ? 600 : 400, color: '#1e3a4f', marginBottom: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {msg.subject || '(no subject)'}
                  </div>
                  <div style={{ fontSize: 11, color: '#6b8299', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {msg.snippet}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Message detail */}
          {selectedMsg && (
            <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
              {loadingDetail && <div style={{ padding: 24, color: '#6b8299' }}>Loading...</div>}
              {!loadingDetail && msgDetail && (
                <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
                  {/* Subject + actions bar */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                    <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1e3a4f', margin: 0, flex: 1 }}>
                      {msgDetail.messages[0]?.subject || '(no subject)'}
                    </h2>
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                      <button onClick={() => archiveMessage(selectedMsg)} style={s.btn('#f0f4f9', '#6b8299')} title="Archive">Archive</button>
                      <button onClick={() => trashMessage(selectedMsg)} style={s.btn('#f0f4f9', '#d94040')} title="Delete">Delete</button>
                      <button onClick={() => { setSelectedMsg(null); setMsgDetail(null); }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b8299', fontSize: 18, padding: '4px 8px' }}>✕</button>
                    </div>
                  </div>

                  {/* Thread messages */}
                  {msgDetail.messages.map((m, i) => (
                    <div key={m.id} style={{ marginBottom: 12, padding: 16, background: '#f0f4f9', borderRadius: 8, border: '1px solid #c0d0e4' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: '#1e3a4f' }}>{m.from}</div>
                          <div style={{ fontSize: 11, color: '#6b8299' }}>To: {m.to}{m.cc ? ' | Cc: ' + m.cc : ''}</div>
                        </div>
                        <div style={{ fontSize: 10, color: '#6b8299' }}>{new Date(m.date).toLocaleString()}</div>
                      </div>
                      <div style={{ fontSize: 13, color: '#1e3a4f', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                        dangerouslySetInnerHTML={{ __html: m.body }} />
                    </div>
                  ))}

                  {/* Reply */}
                  {!showReply ? (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => setShowReply(true)} style={s.btn('#1a5e9a', '#fff')}>Reply</button>
                      <button onClick={() => {
                        const lastMsg = msgDetail.messages[msgDetail.messages.length - 1];
                        setComposeTo('');
                        setComposeCc('');
                        setComposeSubject('Fwd: ' + (lastMsg.subject || '').replace(/^(Re|Fwd):\\s*/i, ''));
                        setComposeBody('\\n\\n---------- Forwarded message ----------\\nFrom: ' + lastMsg.from + '\\nDate: ' + lastMsg.date + '\\nSubject: ' + lastMsg.subject + '\\n\\n');
                        setShowCompose(true);
                      }} style={s.btn('#dde8f2', '#1e3a4f')}>Forward</button>
                    </div>
                  ) : (
                    <div style={{ padding: 16, background: '#ffffff', borderRadius: 8, border: '1px solid #c0d0e4' }}>
                      <textarea value={replyBody} onChange={e => setReplyBody(e.target.value)}
                        rows={6} placeholder="Type your reply..." style={{ ...s.input, resize: 'vertical' }} autoFocus />
                      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        <button onClick={sendReply} disabled={sending || !replyBody.trim()} style={s.btn('#1a5e9a', '#fff')}>
                          {sending ? 'Sending...' : 'Send Reply'}
                        </button>
                        <button onClick={() => { setShowReply(false); setReplyBody(''); }} style={s.btn('#f0f4f9', '#6b8299')}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Compose modal */}
      {showCompose && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
          onClick={() => setShowCompose(false)}>
          <div style={{ background: '#ffffff', borderRadius: 16, border: '1px solid #c0d0e4', padding: 24, width: 520, maxHeight: '85vh', overflow: 'auto' }}
            onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 20px 0' }}>New Email</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div><label style={s.label}>To *</label>
                <input value={composeTo} onChange={e => setComposeTo(e.target.value)} style={s.input} placeholder="recipient@example.com" /></div>
              <div><label style={s.label}>Cc</label>
                <input value={composeCc} onChange={e => setComposeCc(e.target.value)} style={s.input} placeholder="cc@example.com" /></div>
              <div><label style={s.label}>Subject</label>
                <input value={composeSubject} onChange={e => setComposeSubject(e.target.value)} style={s.input} placeholder="Subject line" /></div>
              <div><label style={s.label}>Message *</label>
                <textarea value={composeBody} onChange={e => setComposeBody(e.target.value)} rows={8} style={{ ...s.input, resize: 'vertical' }} placeholder="Type your message..." /></div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button onClick={() => setShowCompose(false)} style={s.btn('#f0f4f9', '#6b8299')}>Cancel</button>
              <button onClick={sendCompose} disabled={sending || !composeTo.trim() || !composeBody.trim()}
                style={s.btn(!composeTo.trim() || !composeBody.trim() ? '#c0d0e4' : '#1a5e9a', !composeTo.trim() || !composeBody.trim() ? '#6b8299' : '#fff')}>
                {sending ? 'Sending...' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatDate(dateStr) {
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now - d;
    if (diff < 86400000 && d.getDate() === now.getDate()) {
      return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }
    if (diff < 604800000) {
      return d.toLocaleDateString([], { weekday: 'short' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch (e) { return dateStr; }
}
`, 'utf8');
console.log('  ✓ GmailPanel.jsx — rewritten with folder sidebar');

console.log('\\n✅ Done! Refresh the browser to see changes.');
console.log('Gmail now has: Inbox, Starred, Sent, Drafts, Spam, Trash, All Mail');
console.log('Plus: star/unstar, archive, delete, forward, and smarter date formatting\\n');
