const fs = require('fs');

const newInbox = `import React, { useState, useEffect, useRef, useMemo } from 'react';
import { api } from '../api';
import Icon from './Icons';

const FOLDERS = [
  { key:'INBOX', label:'Inbox', icon:'inbox' },
  { key:'STARRED', label:'Starred', icon:'star' },
  { key:'IMPORTANT', label:'Important', icon:'alertCircle' },
  { key:'SENT', label:'Sent', icon:'send' },
  { key:'DRAFT', label:'Drafts', icon:'file' },
  { key:'ALL', label:'All Mail', icon:'mail' },
  { key:'SPAM', label:'Spam', icon:'x' },
  { key:'TRASH', label:'Trash', icon:'trash' },
];
const CATEGORIES = [
  { key:'CATEGORY_SOCIAL', label:'Social', icon:'users' },
  { key:'CATEGORY_UPDATES', label:'Updates', icon:'barChart' },
  { key:'CATEGORY_FORUMS', label:'Forums', icon:'log' },
  { key:'CATEGORY_PROMOTIONS', label:'Promotions', icon:'tag' },
];

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const isThisYear = d.getFullYear() === now.getFullYear();
  if (isToday) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (isThisYear) return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function extractName(from) {
  if (!from) return '';
  const match = from.match(/^([^<]+)/);
  return match ? match[1].trim().replace(/"/g, '') : from.split('@')[0];
}

function extractEmail(from) {
  if (!from) return '';
  const match = from.match(/<([^>]+)>/);
  return match ? match[1] : from;
}

function Checkbox({ checked, onChange }) {
  return (
    <div onClick={e => { e.stopPropagation(); onChange(!checked); }}
      style={{ width: 18, height: 18, border: checked ? 'none' : '2px solid #c4c7c5', borderRadius: 2,
        background: checked ? '#1a73e8' : 'transparent', display: 'flex', alignItems: 'center',
        justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
      {checked && <span style={{ color: '#fff', fontSize: 12, fontWeight: 700 }}>✓</span>}
    </div>
  );
}

function StarButton({ starred, onClick }) {
  return (
    <button onClick={e => { e.stopPropagation(); onClick(); }}
      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: starred ? '#f4b400' : '#c4c7c5', fontSize: 16 }}>
      {starred ? '★' : '☆'}
    </button>
  );
}

function Avatar({ name, size = 32 }) {
  const colors = ['#1a73e8','#ea4335','#34a853','#fbbc04','#ff6d01','#46bdc6','#7baaf7','#e37400'];
  const idx = name ? name.charCodeAt(0) % colors.length : 0;
  const initial = name ? name.charAt(0).toUpperCase() : '?';
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: colors[idx],
      display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
      fontSize: size * 0.45, fontWeight: 500, flexShrink: 0, fontFamily: "'Google Sans', Roboto, sans-serif" }}>
      {initial}
    </div>
  );
}

export default function PersonalInbox({ showToast }) {
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [folder, setFolder] = useState('INBOX');
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [compose, setCompose] = useState({ to: '', cc: '', bcc: '', subject: '', body: '' });
  const [showCc, setShowCc] = useState(false);
  const [sending, setSending] = useState(false);
  const [showReply, setShowReply] = useState(false);
  const [replyBody, setReplyBody] = useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; ran.current = true;
    api.gmailStatus().then(s => { setConnected(s.connected); if (s.connected) fetchMsgs('INBOX'); else setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const fetchMsgs = (f, q) => {
    setLoading(true);
    api.gmailPersonal(f || folder, q || '', 50).then(d => setMessages(d.messages || []))
      .catch(e => showToast && showToast(e.message)).finally(() => setLoading(false));
  };

  const switchFolder = f => { setFolder(f.key); setSelected(null); setDetail(null); setSelectedIds(new Set()); fetchMsgs(f.key); };

  const openMsg = async m => {
    setSelected(m); setShowReply(false); setDetailLoading(true);
    try { const d = await api.gmailPersonalMsg(m.id); setDetail(d); setMessages(prev => prev.map(x => x.id === m.id ? { ...x, isUnread: false } : x)); }
    catch (e) { showToast && showToast(e.message); }
    finally { setDetailLoading(false); }
  };

  const sendReply = async () => {
    if (!replyBody.trim() || !detail) return; setSending(true);
    try { await api.gmailPersonalSend({ to: detail.from, subject: 'Re: ' + (detail.subject || ''), body: replyBody, threadId: detail.threadId }); showToast && showToast('Message sent'); setShowReply(false); setReplyBody(''); fetchMsgs(folder); }
    catch (e) { showToast && showToast(e.message); } setSending(false);
  };

  const sendCompose = async () => {
    if (!compose.to || !compose.body) return; setSending(true);
    try { await api.gmailPersonalSend(compose); showToast && showToast('Message sent'); setShowCompose(false); setCompose({ to: '', cc: '', bcc: '', subject: '', body: '' }); fetchMsgs(folder); }
    catch (e) { showToast && showToast(e.message); } setSending(false);
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const selectAll = () => {
    if (selectedIds.size === messages.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(messages.map(m => m.id)));
  };

  const unreadCount = useMemo(() => messages.filter(m => m.isUnread).length, [messages]);

  if (!connected) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 16, background: '#fff' }}>
      <div style={{ width: 48, height: 48, background: '#e8eaed', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="mail" size={24} />
      </div>
      <h2 style={{ fontSize: 22, fontWeight: 400, color: '#202124', fontFamily: "'Google Sans', Roboto, sans-serif", margin: 0 }}>Personal Email</h2>
      <p style={{ fontSize: 14, color: '#5f6368', margin: 0 }}>Connect Google Workspace to view your email.</p>
    </div>
  );

  // Gmail-style layout
  return (
    <div style={{ display: 'flex', height: '100%', background: '#f6f8fc', fontFamily: "'Google Sans', Roboto, -apple-system, sans-serif" }}>

      {/* Sidebar */}
      <div style={{ width: sidebarCollapsed ? 72 : 256, background: '#f6f8fc', flexShrink: 0, display: 'flex', flexDirection: 'column', transition: 'width 0.15s ease', overflow: 'hidden', paddingTop: 4 }}>
        {/* Compose button */}
        <div style={{ padding: sidebarCollapsed ? '8px 12px' : '8px 12px 8px 16px' }}>
          <button onClick={() => setShowCompose(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: sidebarCollapsed ? '12px' : '14px 24px 14px 16px',
              background: '#c2e7ff', border: 'none', borderRadius: 16, cursor: 'pointer', fontSize: 14, fontWeight: 500,
              color: '#001d35', boxShadow: '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)',
              justifyContent: sidebarCollapsed ? 'center' : 'flex-start', width: sidebarCollapsed ? 48 : 'auto',
              height: sidebarCollapsed ? 48 : 'auto', transition: 'all 0.15s ease' }}
            onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.15)'}
            onMouseLeave={e => e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.08)'}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="#001d35" strokeWidth="2" strokeLinecap="round"/></svg>
            {!sidebarCollapsed && <span>Compose</span>}
          </button>
        </div>

        {/* Folder list */}
        <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
          {FOLDERS.map(f => {
            const isActive = folder === f.key;
            const showBadge = f.key === 'INBOX' && unreadCount > 0;
            return (
              <button key={f.key} onClick={() => switchFolder(f)}
                style={{ width: sidebarCollapsed ? 48 : 'calc(100% - 16px)', marginLeft: sidebarCollapsed ? 12 : 8,
                  display: 'flex', alignItems: 'center', gap: 12, padding: sidebarCollapsed ? '8px' : '0 12px 0 24px',
                  height: 32, background: isActive ? '#d3e3fd' : 'transparent', border: 'none', cursor: 'pointer',
                  color: isActive ? '#001d35' : '#444746', fontSize: 14, fontWeight: isActive ? 600 : 400,
                  textAlign: 'left', borderRadius: sidebarCollapsed ? 12 : '0 16px 16px 0',
                  justifyContent: sidebarCollapsed ? 'center' : 'flex-start', transition: 'background 0.1s' }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = '#e8eaed'; }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}>
                <Icon name={f.icon} size={20} />
                {!sidebarCollapsed && <span style={{ flex: 1 }}>{f.label}</span>}
                {!sidebarCollapsed && showBadge && <span style={{ fontSize: 12, fontWeight: 700, color: '#001d35' }}>{unreadCount}</span>}
              </button>
            );
          })}

          {!sidebarCollapsed && <div style={{ padding: '12px 24px 4px', fontSize: 12, fontWeight: 500, color: '#444746', letterSpacing: 0.2 }}>Categories</div>}
          {CATEGORIES.map(f => {
            const isActive = folder === f.key;
            return (
              <button key={f.key} onClick={() => switchFolder(f)}
                style={{ width: sidebarCollapsed ? 48 : 'calc(100% - 16px)', marginLeft: sidebarCollapsed ? 12 : 8,
                  display: 'flex', alignItems: 'center', gap: 12, padding: sidebarCollapsed ? '8px' : '0 12px 0 24px',
                  height: 32, background: isActive ? '#d3e3fd' : 'transparent', border: 'none', cursor: 'pointer',
                  color: isActive ? '#001d35' : '#444746', fontSize: 14, fontWeight: isActive ? 600 : 400,
                  textAlign: 'left', borderRadius: sidebarCollapsed ? 12 : '0 16px 16px 0',
                  justifyContent: sidebarCollapsed ? 'center' : 'flex-start', transition: 'background 0.1s' }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = '#e8eaed'; }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}>
                <Icon name={f.icon} size={20} />
                {!sidebarCollapsed && <span>{f.label}</span>}
              </button>
            );
          })}
        </div>

        <div style={{ padding: '8px 12px', borderTop: '1px solid #e0e0e0', fontSize: 11, color: '#5f6368', textAlign: 'center' }}>
          {!sidebarCollapsed && '✉️ New emails auto-route to Queue'}
        </div>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: '16px 0 0 16px', overflow: 'hidden', boxShadow: '-1px 0 3px rgba(0,0,0,0.04)' }}>

        {/* Search bar */}
        <div style={{ padding: '8px 16px 4px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#5f6368', padding: 8, borderRadius: '50%' }}
            onMouseEnter={e => e.currentTarget.style.background = '#f1f3f4'}
            onMouseLeave={e => e.currentTarget.style.background = 'none'}>
            <Icon name="arrowLeft" size={20} />
          </button>
          <form onSubmit={e => { e.preventDefault(); fetchMsgs(folder, search); }}
            style={{ flex: 1, display: 'flex', alignItems: 'center', background: searchFocused ? '#fff' : '#eaf1fb',
              borderRadius: 28, padding: '6px 16px', transition: 'all 0.2s',
              boxShadow: searchFocused ? '0 1px 3px rgba(0,0,0,0.2)' : 'none',
              border: searchFocused ? '1px solid transparent' : '1px solid transparent' }}>
            <Icon name="inbox" size={20} />
            <input value={search} onChange={e => setSearch(e.target.value)}
              onFocus={() => setSearchFocused(true)} onBlur={() => setSearchFocused(false)}
              placeholder="Search mail" style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none',
                fontSize: 16, padding: '6px 12px', color: '#202124', fontFamily: "'Google Sans', Roboto, sans-serif" }} />
            {search && <button type="button" onClick={() => { setSearch(''); fetchMsgs(folder); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#5f6368', padding: 4 }}>✕</button>}
          </form>
        </div>

        {/* Toolbar */}
        <div style={{ padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 4, borderBottom: '1px solid #f1f3f4', minHeight: 40 }}>
          <Checkbox checked={selectedIds.size > 0 && selectedIds.size === messages.length} onChange={selectAll} />
          <button onClick={() => fetchMsgs(folder)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#5f6368', padding: 8, borderRadius: '50%', display: 'flex', alignItems: 'center' }}
            onMouseEnter={e => e.currentTarget.style.background = '#f1f3f4'}
            onMouseLeave={e => e.currentTarget.style.background = 'none'}
            title="Refresh">
            <Icon name="clock" size={18} />
          </button>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 12, color: '#5f6368' }}>
            {messages.length > 0 ? \`1-\${messages.length}\` : '0'} of {messages.length}
          </span>
        </div>

        {/* Message list / Detail view */}
        {!selected ? (
          <div style={{ flex: 1, overflow: 'auto' }}>
            {loading && (
              <div style={{ padding: 40, textAlign: 'center' }}>
                <div style={{ width: 40, height: 40, border: '3px solid #e8eaed', borderTopColor: '#1a73e8', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
                <style>{\`@keyframes spin { to { transform: rotate(360deg) } }\`}</style>
              </div>
            )}
            {!loading && messages.length === 0 && (
              <div style={{ padding: 60, textAlign: 'center', color: '#5f6368' }}>
                <div style={{ width: 120, height: 120, margin: '0 auto 16px', background: '#f1f3f4', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="mail" size={48} />
                </div>
                <div style={{ fontSize: 16 }}>No messages</div>
              </div>
            )}
            {!loading && messages.map(m => (
              <div key={m.id} onClick={() => openMsg(m)}
                style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 16px 4px 8px', cursor: 'pointer',
                  background: selectedIds.has(m.id) ? '#c2dbff' : m.isUnread ? '#f2f6fc' : '#fff',
                  borderBottom: '1px solid #f1f3f4', height: 40, transition: 'background 0.1s' }}
                onMouseEnter={e => { if (!selectedIds.has(m.id)) e.currentTarget.style.background = m.isUnread ? '#edf2fa' : '#f5f5f5'; }}
                onMouseLeave={e => { if (!selectedIds.has(m.id)) e.currentTarget.style.background = m.isUnread ? '#f2f6fc' : '#fff'; }}>
                <Checkbox checked={selectedIds.has(m.id)} onChange={() => toggleSelect(m.id)} />
                <StarButton starred={m.labels?.includes('STARRED')} onClick={() => {}} />
                <span style={{ width: 180, fontSize: 14, fontWeight: m.isUnread ? 700 : 400, color: '#202124',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>
                  {extractName(m.from)}
                </span>
                <div style={{ flex: 1, display: 'flex', alignItems: 'baseline', gap: 4, overflow: 'hidden', minWidth: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: m.isUnread ? 700 : 400, color: '#202124',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0, maxWidth: '40%' }}>
                    {m.subject || '(no subject)'}
                  </span>
                  <span style={{ fontSize: 14, color: '#5f6368', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    — {m.snippet}
                  </span>
                </div>
                <span style={{ fontSize: 12, color: m.isUnread ? '#202124' : '#5f6368', fontWeight: m.isUnread ? 700 : 400,
                  flexShrink: 0, marginLeft: 8 }}>
                  {formatDate(m.date)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          /* Detail view */
          <div style={{ flex: 1, overflow: 'auto' }}>
            {/* Back bar */}
            <div style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid #f1f3f4' }}>
              <button onClick={() => { setSelected(null); setDetail(null); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#5f6368', padding: 8, borderRadius: '50%', display: 'flex' }}
                onMouseEnter={e => e.currentTarget.style.background = '#f1f3f4'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                <Icon name="arrowLeft" size={20} />
              </button>
              <span style={{ fontSize: 14, color: '#5f6368' }}>Back to {FOLDERS.find(f => f.key === folder)?.label || 'Inbox'}</span>
            </div>

            {detailLoading ? (
              <div style={{ padding: 40, textAlign: 'center' }}>
                <div style={{ width: 40, height: 40, border: '3px solid #e8eaed', borderTopColor: '#1a73e8', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto' }} />
              </div>
            ) : detail && (
              <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 24px' }}>
                {/* Subject */}
                <h1 style={{ fontSize: 22, fontWeight: 400, color: '#202124', margin: '20px 0 16px', lineHeight: 1.3,
                  fontFamily: "'Google Sans', Roboto, sans-serif" }}>
                  {detail.subject || '(no subject)'}
                </h1>

                {/* Sender info */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 20 }}>
                  <Avatar name={extractName(detail.from)} size={40} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <span style={{ fontSize: 14, fontWeight: 500, color: '#202124' }}>{extractName(detail.from)}</span>
                      <span style={{ fontSize: 12, color: '#5f6368' }}>&lt;{extractEmail(detail.from)}&gt;</span>
                    </div>
                    <div style={{ fontSize: 12, color: '#5f6368', marginTop: 2 }}>to {detail.to ? extractName(detail.to) : 'me'}</div>
                  </div>
                  <span style={{ fontSize: 12, color: '#5f6368', flexShrink: 0 }}>{new Date(detail.date).toLocaleString()}</span>
                </div>

                {/* Body */}
                <div style={{ fontSize: 14, lineHeight: 1.6, color: '#202124', padding: '0 0 24px 52px', wordBreak: 'break-word' }}
                  dangerouslySetInnerHTML={{ __html: detail.body }} />

                {/* Reply area */}
                {!showReply ? (
                  <div style={{ padding: '16px 0 32px 52px', display: 'flex', gap: 8 }}>
                    <button onClick={() => setShowReply(true)}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 24px', background: '#fff',
                        border: '1px solid #dadce0', borderRadius: 18, cursor: 'pointer', fontSize: 14, color: '#202124',
                        fontFamily: "'Google Sans', Roboto, sans-serif" }}
                      onMouseEnter={e => e.currentTarget.style.background = '#f6f8fc'}
                      onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
                      <Icon name="send" size={16} /> Reply
                    </button>
                  </div>
                ) : (
                  <div style={{ margin: '0 0 32px 52px', border: '1px solid #dadce0', borderRadius: 8, overflow: 'hidden' }}>
                    <div style={{ padding: '12px 16px', borderBottom: '1px solid #f1f3f4', fontSize: 12, color: '#5f6368' }}>
                      To: {detail.from}
                    </div>
                    <textarea value={replyBody} onChange={e => setReplyBody(e.target.value)} rows={6} autoFocus
                      style={{ width: '100%', border: 'none', outline: 'none', padding: '12px 16px', fontSize: 14,
                        lineHeight: 1.5, resize: 'vertical', boxSizing: 'border-box', fontFamily: "'Google Sans', Roboto, sans-serif" }}
                      placeholder="Type your reply..." />
                    <div style={{ padding: '8px 16px', background: '#f6f8fc', display: 'flex', gap: 8, alignItems: 'center' }}>
                      <button onClick={sendReply} disabled={sending}
                        style={{ padding: '8px 24px', background: '#0b57d0', color: '#fff', border: 'none', borderRadius: 18,
                          cursor: sending ? 'default' : 'pointer', fontSize: 14, fontWeight: 500, opacity: sending ? 0.7 : 1,
                          fontFamily: "'Google Sans', Roboto, sans-serif" }}>
                        {sending ? 'Sending...' : 'Send'}
                      </button>
                      <button onClick={() => { setShowReply(false); setReplyBody(''); }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#5f6368', padding: 8, borderRadius: '50%', display: 'flex' }}>
                        <Icon name="trash" size={18} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Compose modal */}
      {showCompose && (
        <div style={{ position: 'fixed', bottom: 0, right: 24, width: 480, background: '#fff', borderRadius: '8px 8px 0 0',
          boxShadow: '0 8px 40px rgba(0,0,0,0.2)', zIndex: 200, display: 'flex', flexDirection: 'column', maxHeight: '80vh',
          fontFamily: "'Google Sans', Roboto, sans-serif" }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 8px 8px 16px',
            background: '#404040', borderRadius: '8px 8px 0 0', color: '#fff' }}>
            <span style={{ fontSize: 14, fontWeight: 500 }}>New Message</span>
            <div style={{ display: 'flex', gap: 2 }}>
              <button onClick={() => setShowCompose(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#fff', padding: 6, borderRadius: '50%', display: 'flex' }}>
                ✕
              </button>
            </div>
          </div>
          {/* Fields */}
          <div style={{ flex: 1, overflow: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', padding: '4px 16px', borderBottom: '1px solid #f1f3f4' }}>
              <span style={{ fontSize: 14, color: '#5f6368', width: 40 }}>To</span>
              <input value={compose.to} onChange={e => setCompose({ ...compose, to: e.target.value })}
                style={{ flex: 1, border: 'none', outline: 'none', padding: '8px 0', fontSize: 14 }} />
              <button onClick={() => setShowCc(!showCc)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#5f6368', fontSize: 12 }}>
                Cc/Bcc
              </button>
            </div>
            {showCc && <>
              <div style={{ display: 'flex', alignItems: 'center', padding: '4px 16px', borderBottom: '1px solid #f1f3f4' }}>
                <span style={{ fontSize: 14, color: '#5f6368', width: 40 }}>Cc</span>
                <input value={compose.cc} onChange={e => setCompose({ ...compose, cc: e.target.value })}
                  style={{ flex: 1, border: 'none', outline: 'none', padding: '8px 0', fontSize: 14 }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', padding: '4px 16px', borderBottom: '1px solid #f1f3f4' }}>
                <span style={{ fontSize: 14, color: '#5f6368', width: 40 }}>Bcc</span>
                <input value={compose.bcc} onChange={e => setCompose({ ...compose, bcc: e.target.value })}
                  style={{ flex: 1, border: 'none', outline: 'none', padding: '8px 0', fontSize: 14 }} />
              </div>
            </>}
            <div style={{ padding: '4px 16px', borderBottom: '1px solid #f1f3f4' }}>
              <input value={compose.subject} onChange={e => setCompose({ ...compose, subject: e.target.value })}
                placeholder="Subject" style={{ width: '100%', border: 'none', outline: 'none', padding: '8px 0', fontSize: 14 }} />
            </div>
            <textarea value={compose.body} onChange={e => setCompose({ ...compose, body: e.target.value })}
              style={{ width: '100%', border: 'none', outline: 'none', padding: '16px', fontSize: 14, lineHeight: 1.5,
                resize: 'none', minHeight: 200, boxSizing: 'border-box' }} />
          </div>
          {/* Footer */}
          <div style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={sendCompose} disabled={sending}
              style={{ padding: '8px 24px', background: '#0b57d0', color: '#fff', border: 'none', borderRadius: 18,
                cursor: sending ? 'default' : 'pointer', fontSize: 14, fontWeight: 500, opacity: sending ? 0.7 : 1 }}>
              {sending ? 'Sending...' : 'Send'}
            </button>
            <div style={{ flex: 1 }} />
            <button onClick={() => setShowCompose(false)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#5f6368', padding: 8, borderRadius: '50%', display: 'flex' }}>
              <Icon name="trash" size={18} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
`;

fs.writeFileSync('client/src/components/PersonalInbox.jsx', newInbox, 'utf8');
console.log('✓ PersonalInbox.jsx — Gmail-style UI rewrite complete');
console.log('Refresh browser.');
