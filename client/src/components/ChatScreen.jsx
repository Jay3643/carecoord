import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api';
import { Avatar } from './ui';
import io from 'socket.io-client';

const socket = io(window.location.origin, { transports: ['websocket', 'polling'] });

function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export default function ChatScreen({ currentUser, allUsers, showToast, isPanel, onClose, onRead, onOpenTicket }) {
  const [channels, setChannels] = useState([]);
  const [activeChannel, setActiveChannel] = useState(null);
  const [messages, setMessages] = useState([]);
  const [msgText, setMsgText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [newType, setNewType] = useState('direct');
  const [newName, setNewName] = useState('');
  const [selectedMembers, setSelectedMembers] = useState([]);
  const [typingUsers, setTypingUsers] = useState([]);
  const [searchUser, setSearchUser] = useState('');
  const messagesEndRef = useRef(null);
  const typingTimer = useRef(null);
  const fileRef = useRef(null);

  const loadChannels = useCallback(() => {
    api.chatChannels().then(d => { setChannels(d.channels || []); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  useEffect(() => { loadChannels(); }, []);

  useEffect(() => {
    if (!activeChannel) return;
    socket.emit('join', activeChannel.id);
    api.chatMessages(activeChannel.id).then(d => setMessages(d.messages || []));
    api.chatMarkRead(activeChannel.id).then(() => { if (onRead) onRead(); });

    const onMsg = (msg) => {
      if (msg.channelId === activeChannel.id) {
        setMessages(prev => [...prev, msg]);
        api.chatMarkRead(activeChannel.id);
      }
      loadChannels();
    };
    const onTyping = (data) => {
      if (data.userId !== currentUser.id) setTypingUsers(prev => prev.includes(data.name) ? prev : [...prev, data.name]);
    };
    const onStopTyping = (data) => {
      setTypingUsers(prev => prev.filter(n => n !== data.name));
    };

    socket.on('chat:message', onMsg);
    socket.on('chat:typing', onTyping);
    socket.on('chat:stop-typing', onStopTyping);

    return () => {
      socket.emit('leave', activeChannel.id);
      socket.off('chat:message', onMsg);
      socket.off('chat:typing', onTyping);
      socket.off('chat:stop-typing', onStopTyping);
    };
  }, [activeChannel?.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!msgText.trim() || !activeChannel) return;
    setSending(true);
    try {
      await api.chatSend(activeChannel.id, { body: msgText, type: 'text' });
      setMsgText('');
      socket.emit('stop-typing', { channelId: activeChannel.id, userId: currentUser.id });
    } catch(e) { showToast?.(e.message); }
    setSending(false);
  };

  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file || !activeChannel) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result.split(',')[1];
      try {
        await api.chatSend(activeChannel.id, { body: file.name, type: 'file', fileName: file.name, fileData: base64, fileMime: file.type });
      } catch(e) { showToast?.(e.message); }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleTyping = () => {
    socket.emit('typing', { channelId: activeChannel.id, userId: currentUser.id, name: currentUser.name });
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      socket.emit('stop-typing', { channelId: activeChannel.id, userId: currentUser.id });
    }, 2000);
  };

  const createChannel = async () => {
    if (selectedMembers.length === 0) return;
    try {
      const d = await api.chatCreateChannel({
        type: selectedMembers.length === 1 ? 'direct' : 'group',
        name: selectedMembers.length > 1 ? newName || selectedMembers.map(id => allUsers.find(u => u.id === id)?.name).join(', ') : null,
        memberIds: selectedMembers,
      });
      loadChannels();
      setShowNew(false);
      setSelectedMembers([]);
      setNewName('');
      // Open the new channel
      setTimeout(() => {
        api.chatChannels().then(data => {
          const ch = (data.channels || []).find(c => c.id === d.channelId);
          if (ch) setActiveChannel(ch);
        });
      }, 200);
    } catch(e) { showToast?.(e.message); }
  };

  const deleteChannel = async (ch, e) => {
    e.stopPropagation();
    if (!confirm('Remove this conversation from your list? Other participants will still have access.')) return;
    try {
      await api.chatDeleteChannel(ch.id);
      setChannels(prev => prev.filter(c => c.id !== ch.id));
      if (activeChannel?.id === ch.id) { setActiveChannel(null); setMessages([]); }
      showToast?.('Conversation removed');
    } catch(e) { showToast?.(e.message); }
  };

  const deleteMessage = async (msg) => {
    if (!confirm('Delete this message?')) return;
    try {
      await api.chatDeleteMessage(activeChannel.id, msg.id);
      setMessages(prev => prev.filter(m => m.id !== msg.id));
    } catch(e) { showToast?.(e.message); }
  };

  // Listen for real-time message delete events
  useEffect(() => {
    const onMsgDeleted = (data) => {
      setMessages(prev => prev.filter(m => m.id !== data.messageId));
    };
    socket.on('chat:msg-deleted', onMsgDeleted);
    return () => { socket.off('chat:msg-deleted', onMsgDeleted); };
  }, [activeChannel?.id]);

  const otherUsers = (allUsers || []).filter(u => u.id !== currentUser.id);
  const filteredUsers = searchUser ? otherUsers.filter(u => u.name.toLowerCase().includes(searchUser.toLowerCase()) || u.email.toLowerCase().includes(searchUser.toLowerCase())) : otherUsers;

  const canDeleteChannel = (ch) => currentUser.role === 'admin' || currentUser.role === 'supervisor' || ch.members.find(m => m.id === currentUser.id);

  const css = `.chat-msg:hover{background:#f5f7fa}.chat-ch:hover{background:#e8edf3}.chat-del{opacity:0;transition:opacity .15s}.chat-ch:hover .chat-del,.chat-msg:hover .chat-del{opacity:1}`;

  return (
    <div style={{ display: 'flex', flexDirection: isPanel ? 'column' : 'row', height: '100%', background: '#fff', fontFamily: "'IBM Plex Sans', -apple-system, sans-serif" }}>
      <style>{css}</style>

      {/* Channel List */}
      <div style={{ width: isPanel ? '100%' : 300, borderRight: isPanel ? 'none' : '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', background: '#f8fafc' }}>
        <div style={{ padding: '16px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {isPanel && onClose && <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: 18, padding: 4 }}>✕</button>}
          <span style={{ fontSize: 16, fontWeight: 700, color: '#1e3a4f' }}>Messages</span>
          <button onClick={() => { setShowNew(true); setSearchUser(''); setSelectedMembers([]); setNewName(''); }} style={{ background: '#1a5e9a', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>+ New</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {channels.map(ch => (
            <div key={ch.id} className="chat-ch" onClick={() => { setActiveChannel(ch); setTypingUsers([]); }}
              style={{ padding: '12px 16px', cursor: 'pointer', borderBottom: '1px solid #f1f5f9',
                background: activeChannel?.id === ch.id ? '#e0ecf7' : 'transparent' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {ch.type === 'direct' && ch.members.length > 0 && (
                  <Avatar user={ch.members.find(m => m.id !== currentUser.id) || ch.members[0]} size={36} />
                )}
                {ch.type === 'ticket' && (
                  <div onClick={(e) => { if (ch.ticketId && onOpenTicket) { e.stopPropagation(); onOpenTicket(ch.ticketId, ch.name, true); } }}
                    style={{ width: 36, height: 36, borderRadius: '50%', background: '#e8f0fe', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#1a73e8', fontSize: 16, cursor: ch.ticketId && onOpenTicket ? 'pointer' : 'default' }}
                    title={ch.ticketId ? 'Open ticket' : ''}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="#1a73e8"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13z"/></svg>
                  </div>
                )}
                {ch.type !== 'direct' && ch.type !== 'ticket' && (
                  <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#1a5e9a', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 14, fontWeight: 600 }}>
                    {ch.members.length}
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 14, fontWeight: ch.unread > 0 ? 700 : 500, color: '#1e3a4f', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ch.name}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                      {canDeleteChannel(ch) && (
                        <button className="chat-del" onClick={(e) => deleteChannel(ch, e)} title="Remove conversation"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center', color: '#94a3b8' }}
                          onMouseEnter={e => e.currentTarget.style.color='#d94040'} onMouseLeave={e => e.currentTarget.style.color='#94a3b8'}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                        </button>
                      )}
                      {ch.unread > 0 && <span style={{ background: '#d94040', color: '#fff', fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 99 }}>{ch.unread}</span>}
                    </div>
                  </div>
                  {ch.type === 'ticket' && ch.ticketId && onOpenTicket && (
                    <a onClick={(e) => { e.stopPropagation(); onOpenTicket(ch.ticketId, ch.name, true); }}
                      style={{ fontSize: 11, color: '#1a73e8', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3, marginTop: 2, fontWeight: 600 }}
                      onMouseEnter={e => e.currentTarget.style.textDecoration='underline'} onMouseLeave={e => e.currentTarget.style.textDecoration='none'}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="#1a73e8"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13z"/></svg>
                      View Ticket
                    </a>
                  )}
                  {ch.lastMessage && (
                    <div style={{ fontSize: 12, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
                      {ch.lastMessage.senderName}: {ch.lastMessage.type === 'file' ? '📎 ' + ch.lastMessage.body : ch.lastMessage.body}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
          {!loading && channels.length === 0 && (
            <div style={{ padding: 32, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>No conversations yet</div>
          )}
        </div>
      </div>

      {/* Chat Area */}
      <div style={{ flex: 1, display: isPanel && !activeChannel && !showNew ? 'none' : 'flex', flexDirection: 'column' }}>
        {!activeChannel && !showNew ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>
            <div style={{ textAlign: 'center' }}>
              <svg width="64" height="64" viewBox="0 0 24 24" fill="#cbd5e1"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>
              <p style={{ marginTop: 12, fontSize: 14 }}>Select a conversation or start a new one</p>
            </div>
          </div>
        ) : showNew ? (
          <div style={{ flex: 1, padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1e3a4f', margin: 0 }}>New Conversation</h2>
              <button onClick={() => { setShowNew(false); setSelectedMembers([]); setNewName(''); if (isPanel && !activeChannel) {} }} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#64748b' }}>✕</button>
            </div>

            {selectedMembers.length > 1 && (
              <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Group name (optional)"
                style={{ width: '100%', padding: '10px 14px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 14, marginBottom: 16, outline: 'none' }} />
            )}

            <input value={searchUser} onChange={e => setSearchUser(e.target.value)} placeholder="Search people..."
              style={{ width: '100%', padding: '10px 14px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 14, marginBottom: 12, outline: 'none' }} />

            {selectedMembers.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                {selectedMembers.map(id => {
                  const u = allUsers.find(u => u.id === id);
                  return u ? (
                    <span key={id} onClick={() => setSelectedMembers(prev => prev.filter(x => x !== id))}
                      style={{ background: '#e0ecf7', color: '#1e3a4f', padding: '4px 10px', borderRadius: 16, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                      {u.name} ✕
                    </span>
                  ) : null;
                })}
              </div>
            )}

            <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 8 }}>
              {filteredUsers.map(u => (
                <div key={u.id} onClick={() => setSelectedMembers(prev => prev.includes(u.id) ? prev.filter(x => x !== u.id) : [...prev, u.id])}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer', background: selectedMembers.includes(u.id) ? '#e0ecf7' : '#fff', borderBottom: '1px solid #f1f5f9' }}>
                  <Avatar user={u} size={32} />
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{u.name}</div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>{u.email}</div>
                  </div>
                  {selectedMembers.includes(u.id) && <span style={{ marginLeft: 'auto', color: '#1a5e9a', fontWeight: 700 }}>✓</span>}
                </div>
              ))}
            </div>

            <button onClick={createChannel} disabled={selectedMembers.length === 0}
              style={{ marginTop: 16, padding: '10px 24px', background: selectedMembers.length ? '#1a5e9a' : '#cbd5e1', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: selectedMembers.length ? 'pointer' : 'default' }}>
              Start Conversation
            </button>
          </div>
        ) : (
          <>
            {/* Header */}
            <div style={{ padding: '12px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 10, background: '#fafbfc' }}>
              <button onClick={() => setActiveChannel(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: 18, padding: 4, display: isPanel ? 'block' : 'none' }}>←</button>
              <span style={{ fontSize: 16, fontWeight: 700, color: '#1e3a4f' }}>{activeChannel.name}</span>
              {activeChannel.type === 'ticket' && activeChannel.ticketId && onOpenTicket && (
                <button onClick={() => onOpenTicket(activeChannel.ticketId, activeChannel.name, true)}
                  style={{ background: '#e8f0fe', color: '#1a73e8', border: '1px solid #c5d7f2', borderRadius: 12, padding: '2px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
                  onMouseEnter={e => e.currentTarget.style.background='#d2e3fc'} onMouseLeave={e => e.currentTarget.style.background='#e8f0fe'}>
                  View Ticket
                </button>
              )}
              <span style={{ fontSize: 12, color: '#94a3b8', marginLeft: 8 }}>{activeChannel.members.length} members</span>
            </div>

            {/* Messages */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
              {messages.map((m, i) => {
                const isMe = m.userId === currentUser.id;
                const showAvatar = i === 0 || messages[i-1]?.userId !== m.userId;
                return (
                  <div key={m.id} className="chat-msg" style={{ display: 'flex', gap: 10, marginBottom: showAvatar ? 12 : 2, padding: '2px 4px', borderRadius: 8 }}>
                    <div style={{ width: 32, flexShrink: 0 }}>
                      {showAvatar && <Avatar user={{ name: m.senderName, avatar: m.senderAvatar }} size={32} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
                      {showAvatar && (
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2 }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: isMe ? '#1a5e9a' : '#1e3a4f' }}>{m.senderName}</span>
                          <span style={{ fontSize: 11, color: '#94a3b8' }}>{fmtTime(m.createdAt)}</span>
                        </div>
                      )}
                      {(isMe || currentUser.role === 'admin' || currentUser.role === 'supervisor') && (
                        <button className="chat-del" onClick={() => deleteMessage(m)} title="Delete message"
                          style={{ position: 'absolute', top: 0, right: 0, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 4, cursor: 'pointer', padding: '2px 4px', display: 'flex', alignItems: 'center', color: '#94a3b8' }}
                          onMouseEnter={e => e.currentTarget.style.color='#d94040'} onMouseLeave={e => e.currentTarget.style.color='#94a3b8'}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                        </button>
                      )}
                      {m.type === 'file' ? (
                        <a href={'data:' + (m.fileMime || 'application/octet-stream') + ';base64,' + (m.fileData || '')} download={m.fileName || m.body}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: '#f1f5f9', borderRadius: 8, fontSize: 13, color: '#1a5e9a', textDecoration: 'none' }}>
                          📎 {m.body || m.fileName}
                        </a>
                      ) : (
                        <div style={{ fontSize: 14, color: '#334155', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.body}</div>
                      )}
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Typing indicator */}
            {typingUsers.length > 0 && (
              <div style={{ padding: '4px 20px', fontSize: 12, color: '#64748b', fontStyle: 'italic' }}>
                {typingUsers.join(', ')} {typingUsers.length === 1 ? 'is' : 'are'} typing...
              </div>
            )}

            {/* Input */}
            <div style={{ padding: '12px 20px', borderTop: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 8, background: '#fafbfc' }}>
              <input type="file" ref={fileRef} onChange={handleFile} style={{ display: 'none' }} />
              <button onClick={() => fileRef.current?.click()} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, padding: 4, color: '#64748b' }} title="Attach file">📎</button>
              <input value={msgText} onChange={e => { setMsgText(e.target.value); handleTyping(); }}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                placeholder="Type a message..."
                style={{ flex: 1, padding: '10px 14px', border: '1px solid #e2e8f0', borderRadius: 24, fontSize: 14, outline: 'none', background: '#fff' }} />
              <button onClick={handleSend} disabled={sending || !msgText.trim()}
                style={{ background: msgText.trim() ? '#1a5e9a' : '#cbd5e1', color: '#fff', border: 'none', borderRadius: '50%', width: 36, height: 36, cursor: msgText.trim() ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
