import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api';
import { Avatar } from './ui';

function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export default function ChatScreen({ currentUser, allUsers, showToast, isPanel, onClose, onRead, onOpenTicket }) {
  const [channels, setChannels] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [searchUser, setSearchUser] = useState('');
  const [selectedMembers, setSelectedMembers] = useState([]);
  const [newName, setNewName] = useState('');
  const endRef = useRef(null);
  const pollRef = useRef(null);
  const channelPollRef = useRef(null);

  // ── Load channels ──
  const loadChannels = useCallback(() => {
    api.chatChannels().then(d => {
      setChannels(d.channels || []);
      setLoading(false);
    }).catch(e => { console.error('[Chat] loadChannels error:', e); setLoading(false); });
  }, []);

  // ── Load messages for active channel ──
  const loadMessages = useCallback((chId) => {
    if (!chId) return;
    api.chatMessages(chId).then(d => {
      setMessages(prev => {
        const incoming = d.messages || [];
        // Only update if changed (avoid scroll jumps)
        if (incoming.length !== prev.length || (incoming.length > 0 && incoming[incoming.length - 1]?.id !== prev[prev.length - 1]?.id)) {
          return incoming;
        }
        return prev;
      });
    }).catch(() => {});
  }, []);

  // ── Initial load + channel polling ──
  useEffect(() => {
    loadChannels();
    channelPollRef.current = setInterval(loadChannels, 4000);
    return () => clearInterval(channelPollRef.current);
  }, [loadChannels]);

  // ── Message polling for active channel ──
  useEffect(() => {
    if (!activeId) { setMessages([]); return; }
    // Load immediately
    loadMessages(activeId);
    api.chatMarkRead(activeId).then(() => { if (onRead) onRead(); }).catch(() => {});
    // Poll every 2 seconds
    pollRef.current = setInterval(() => loadMessages(activeId), 2000);
    return () => clearInterval(pollRef.current);
  }, [activeId, loadMessages, onRead]);

  // ── Auto scroll ──
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Send ──
  const handleSend = async () => {
    if (!text.trim() || !activeId || sending) return;
    const msg = text;
    setText('');
    setSending(true);
    try {
      await api.chatSend(activeId, { body: msg, type: 'text' });
      loadMessages(activeId);
      api.chatMarkRead(activeId).catch(() => {});
      loadChannels();
    } catch (e) { console.error('[Chat] send error:', e); showToast?.(e.message); setText(msg); }
    setSending(false);
  };

  // ── File send ──
  const fileRef = useRef(null);
  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file || !activeId) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await api.chatSend(activeId, { body: file.name, type: 'file', fileName: file.name, fileData: reader.result.split(',')[1], fileMime: file.type });
        loadMessages(activeId);
        loadChannels();
      } catch (e) { showToast?.(e.message); }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // ── Create channel ──
  const createChannel = async () => {
    if (selectedMembers.length === 0) return;
    try {
      const d = await api.chatCreateChannel({
        type: selectedMembers.length === 1 ? 'direct' : 'group',
        name: selectedMembers.length > 1 ? (newName || null) : null,
        memberIds: selectedMembers,
      });
      setShowNew(false);
      setSelectedMembers([]);
      setNewName('');
      setSearchUser('');
      loadChannels();
      // Open the new channel
      setActiveId(d.channelId);
    } catch (e) { console.error('[Chat] createChannel error:', e); showToast?.(e.message || 'Failed to create chat'); }
  };

  // ── Delete channel (leave) ──
  const leaveChannel = async (chId, e) => {
    e.stopPropagation();
    if (!confirm('Remove this conversation from your list?')) return;
    try {
      await api.chatDeleteChannel(chId);
      if (activeId === chId) { setActiveId(null); setMessages([]); }
      loadChannels();
    } catch (e) { showToast?.(e.message); }
  };

  // ── Delete message ──
  const deleteMessage = async (msg) => {
    if (!confirm('Delete this message?')) return;
    try {
      await api.chatDeleteMessage(activeId, msg.id);
      setMessages(prev => prev.filter(m => m.id !== msg.id));
    } catch (e) { showToast?.(e.message); }
  };

  const activeChannel = channels.find(c => c.id === activeId);
  const otherUsers = (allUsers || []).filter(u => u.id !== currentUser.id);
  const filteredUsers = searchUser ? otherUsers.filter(u => u.name?.toLowerCase().includes(searchUser.toLowerCase()) || u.email?.toLowerCase().includes(searchUser.toLowerCase())) : otherUsers;

  const css = `.cc-msg:hover{background:#f5f7fa} .cc-ch:hover{background:#e8edf3} .cc-del{opacity:0;transition:opacity .15s} .cc-ch:hover .cc-del,.cc-msg:hover .cc-del{opacity:1}`;

  // ── RENDER ──
  return (
    <div style={{ display: 'flex', flexDirection: isPanel ? 'column' : 'row', height: '100%', background: '#fff', fontFamily: "'IBM Plex Sans', -apple-system, sans-serif" }}>
      <style>{css}</style>

      {/* ── Channel List ── */}
      <div style={{ width: isPanel ? '100%' : 300, borderRight: isPanel ? 'none' : '1px solid #e2e8f0', display: (isPanel && (activeId || showNew)) ? 'none' : 'flex', flexDirection: 'column', background: '#f8fafc' }}>
        <div style={{ padding: 14, borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {isPanel && onClose && <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: 18, padding: 4 }}>✕</button>}
          <span style={{ fontSize: 16, fontWeight: 700, color: '#1e3a4f' }}>Messages</span>
          <button onClick={() => { setShowNew(true); setSearchUser(''); setSelectedMembers([]); setNewName(''); }}
            style={{ background: '#1a5e9a', color: '#fff', border: 'none', borderRadius: 8, padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>+ New</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading && <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Loading...</div>}
          {!loading && channels.length === 0 && <div style={{ padding: 32, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>No conversations yet</div>}
          {channels.map(ch => (
            <div key={ch.id} className="cc-ch" onClick={() => { setActiveId(ch.id); setShowNew(false); }}
              style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid #f1f5f9', background: activeId === ch.id ? '#e0ecf7' : 'transparent' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {ch.type === 'direct' ? (
                  <Avatar user={ch.members.find(m => m.id !== currentUser.id) || ch.members[0]} size={34} />
                ) : ch.type === 'ticket' ? (
                  <div onClick={(e) => { if (ch.ticketId && onOpenTicket) { e.stopPropagation(); onOpenTicket(ch.ticketId, ch.name, true); } }}
                    style={{ width: 34, height: 34, borderRadius: '50%', background: '#e8f0fe', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: ch.ticketId ? 'pointer' : 'default' }}
                    title={ch.ticketId ? 'Open ticket' : ''}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="#1a73e8"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13z"/></svg>
                  </div>
                ) : (
                  <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#1a5e9a', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 13, fontWeight: 600 }}>
                    {ch.members.length}
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 13, fontWeight: ch.unread > 0 ? 700 : 500, color: '#1e3a4f', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ch.name}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                      <button className="cc-del" onClick={(e) => leaveChannel(ch.id, e)} title="Leave"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: '#94a3b8', fontSize: 12 }}
                        onMouseEnter={e => e.currentTarget.style.color='#d94040'} onMouseLeave={e => e.currentTarget.style.color='#94a3b8'}>✕</button>
                      {ch.unread > 0 && <span style={{ background: '#d94040', color: '#fff', fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 99 }}>{ch.unread}</span>}
                    </div>
                  </div>
                  {ch.type === 'ticket' && ch.ticketId && onOpenTicket && (
                    <a onClick={(e) => { e.stopPropagation(); onOpenTicket(ch.ticketId, ch.name, true); }}
                      style={{ fontSize: 10, color: '#1a73e8', cursor: 'pointer', fontWeight: 600 }}
                      onMouseEnter={e => e.currentTarget.style.textDecoration='underline'} onMouseLeave={e => e.currentTarget.style.textDecoration='none'}>
                      View Ticket
                    </a>
                  )}
                  {ch.lastMessage && (
                    <div style={{ fontSize: 11, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>
                      {ch.lastMessage.senderName}: {ch.lastMessage.type === 'file' ? '📎 ' : ''}{ch.lastMessage.body}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Chat Area ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {!activeId && !showNew ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>
            <div style={{ textAlign: 'center' }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="#cbd5e1"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>
              <p style={{ marginTop: 8, fontSize: 13 }}>Select a conversation or start a new one</p>
            </div>
          </div>
        ) : showNew ? (
          /* ── New Conversation ── */
          <div style={{ flex: 1, padding: 20, overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h2 style={{ fontSize: 17, fontWeight: 700, color: '#1e3a4f', margin: 0 }}>New Conversation</h2>
              <button onClick={() => setShowNew(false)} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#64748b' }}>✕</button>
            </div>
            {selectedMembers.length > 1 && (
              <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Group name (optional)"
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, marginBottom: 12, outline: 'none' }} />
            )}
            <input value={searchUser} onChange={e => setSearchUser(e.target.value)} placeholder="Search people..."
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, marginBottom: 10, outline: 'none' }} />
            {selectedMembers.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 10 }}>
                {selectedMembers.map(id => {
                  const u = (allUsers || []).find(u => u.id === id);
                  return u ? <span key={id} onClick={() => setSelectedMembers(prev => prev.filter(x => x !== id))}
                    style={{ background: '#e0ecf7', color: '#1e3a4f', padding: '3px 8px', borderRadius: 14, fontSize: 11, cursor: 'pointer' }}>{u.name} ✕</span> : null;
                })}
              </div>
            )}
            <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 8 }}>
              {filteredUsers.map(u => (
                <div key={u.id} onClick={() => setSelectedMembers(prev => prev.includes(u.id) ? prev.filter(x => x !== u.id) : [...prev, u.id])}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', cursor: 'pointer', background: selectedMembers.includes(u.id) ? '#e0ecf7' : '#fff', borderBottom: '1px solid #f1f5f9' }}>
                  <Avatar user={u} size={30} />
                  <div><div style={{ fontSize: 13, fontWeight: 500 }}>{u.name}</div><div style={{ fontSize: 11, color: '#64748b' }}>{u.email}</div></div>
                  {selectedMembers.includes(u.id) && <span style={{ marginLeft: 'auto', color: '#1a5e9a', fontWeight: 700 }}>✓</span>}
                </div>
              ))}
            </div>
            <button onClick={createChannel} disabled={selectedMembers.length === 0}
              style={{ marginTop: 14, padding: '8px 20px', background: selectedMembers.length ? '#1a5e9a' : '#cbd5e1', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: selectedMembers.length ? 'pointer' : 'default' }}>
              Start Conversation
            </button>
          </div>
        ) : (
          /* ── Active Chat ── */
          <>
            <div style={{ padding: '10px 16px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 8, background: '#fafbfc' }}>
              {isPanel && <button onClick={() => setActiveId(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: 16, padding: 2 }}>←</button>}
              <span style={{ fontSize: 15, fontWeight: 700, color: '#1e3a4f', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeChannel?.name || 'Chat'}</span>
              {activeChannel?.type === 'ticket' && activeChannel?.ticketId && onOpenTicket && (
                <button onClick={() => onOpenTicket(activeChannel.ticketId, activeChannel.name, true)}
                  style={{ background: '#e8f0fe', color: '#1a73e8', border: '1px solid #c5d7f2', borderRadius: 10, padding: '2px 8px', fontSize: 10, fontWeight: 600, cursor: 'pointer' }}>
                  View Ticket
                </button>
              )}
              <span style={{ fontSize: 11, color: '#94a3b8' }}>{activeChannel?.members.length || 0} members</span>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
              {messages.map((m, i) => {
                const isMe = m.userId === currentUser.id;
                const showName = i === 0 || messages[i - 1]?.userId !== m.userId;
                return (
                  <div key={m.id} className="cc-msg" style={{ display: 'flex', gap: 8, marginBottom: showName ? 10 : 2, padding: '2px 4px', borderRadius: 6 }}>
                    <div style={{ width: 28, flexShrink: 0 }}>
                      {showName && <Avatar user={{ name: m.senderName, avatar: m.senderAvatar }} size={28} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
                      {showName && (
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 1 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: isMe ? '#1a5e9a' : '#1e3a4f' }}>{m.senderName}</span>
                          <span style={{ fontSize: 10, color: '#94a3b8' }}>{fmtTime(m.createdAt)}</span>
                        </div>
                      )}
                      {(isMe || currentUser.role === 'admin' || currentUser.role === 'supervisor') && (
                        <button className="cc-del" onClick={() => deleteMessage(m)} title="Delete"
                          style={{ position: 'absolute', top: 0, right: 0, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 4, cursor: 'pointer', padding: '1px 3px', color: '#94a3b8', fontSize: 10 }}
                          onMouseEnter={e => e.currentTarget.style.color='#d94040'} onMouseLeave={e => e.currentTarget.style.color='#94a3b8'}>✕</button>
                      )}
                      {m.type === 'file' ? (
                        <a href={'data:' + (m.fileMime || 'application/octet-stream') + ';base64,' + (m.fileData || '')} download={m.fileName || m.body}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', background: '#f1f5f9', borderRadius: 6, fontSize: 12, color: '#1a5e9a', textDecoration: 'none' }}>
                          📎 {m.body || m.fileName}
                        </a>
                      ) : (
                        <div style={{ fontSize: 13, color: '#334155', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.body}</div>
                      )}
                    </div>
                  </div>
                );
              })}
              <div ref={endRef} />
            </div>

            <div style={{ padding: '10px 16px', borderTop: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 6, background: '#fafbfc' }}>
              <input type="file" ref={fileRef} onChange={handleFile} style={{ display: 'none' }} />
              <button onClick={() => fileRef.current?.click()} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, padding: 2, color: '#64748b' }} title="Attach file">📎</button>
              <input value={text} onChange={e => setText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                placeholder="Type a message..."
                style={{ flex: 1, padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: 20, fontSize: 13, outline: 'none', background: '#fff' }} />
              <button onClick={handleSend} disabled={sending || !text.trim()}
                style={{ background: text.trim() ? '#1a5e9a' : '#cbd5e1', color: '#fff', border: 'none', borderRadius: '50%', width: 32, height: 32, cursor: text.trim() ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
