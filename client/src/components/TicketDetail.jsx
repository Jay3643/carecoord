import React, { useState, useEffect, useMemo, useRef } from 'react';
import { api } from '../api';
import { fmt } from '../utils';
import Icon from './Icons';
import { StatusBadge, TagPill, Avatar } from './ui';
import io from 'socket.io-client';

function MessageBody({ text }) {
  if (!text) return null;
  if (text.includes('<div') || text.includes('<p') || text.includes('<br')) {
    return <div dangerouslySetInnerHTML={{ __html: text }} style={{ fontSize: 13, lineHeight: 1.6, color: '#1e3a4f', wordBreak: 'break-word', overflow: 'hidden' }} />;
  }
  return <div style={{ fontSize: 13, lineHeight: 1.6, color: '#1e3a4f', whiteSpace: 'pre-wrap' }}>{text}</div>;
}

export default function TicketDetail({ ticketId, currentUser, isSupervisor, regions, allTags, closeReasons, allUsers, onBack, showToast }) {
  const [ticket, setTicket] = useState(null);
  const [messages, setMessages] = useState([]);
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [replyText, setReplyText] = useState('');
  const [noteText, setNoteText] = useState('');
  const [activeTab, setActiveTab] = useState('reply');
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [closeReasonId, setCloseReasonId] = useState('');
  const [closeComment, setCloseComment] = useState('');
  const [showAssignDropdown, setShowAssignDropdown] = useState(false);
  const [showRegionDropdown, setShowRegionDropdown] = useState(false);
  const [showTagDropdown, setShowTagDropdown] = useState(false);
  const [regionCoordinators, setRegionCoordinators] = useState([]);
  const [sending, setSending] = useState(false);
  const [replyAttachments, setReplyAttachments] = useState([]);
  const fileInputRef = useRef(null);
  const timelineRef = useRef(null);
  const [discussionMsgs, setDiscussionMsgs] = useState([]);
  const [discussionText, setDiscussionText] = useState('');
  const [discussionChannelId, setDiscussionChannelId] = useState(null);
  const [discussionLoading, setDiscussionLoading] = useState(false);
  const [discussionMembers, setDiscussionMembers] = useState([]);
  const [showMemberPicker, setShowMemberPicker] = useState(false);
  const [selectedMemberIds, setSelectedMemberIds] = useState(new Set());
  const discussionEndRef = useRef(null);
  const socketRef = useRef(null);
  const [aiMessages, setAiMessages] = useState([]);
  const [pullMenuOpen, setPullMenuOpen] = useState(false);
  const [aiInput, setAiInput] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const aiEndRef = useRef(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [ticketData, msgData, noteData] = await Promise.all([
        api.getTicket(ticketId),
        api.getMessages(ticketId),
        api.getNotes(ticketId),
      ]);
      setTicket(ticketData.ticket);
      setMessages(msgData.messages);
      setNotes(noteData.notes);
    } catch (e) {
      showToast('Error loading ticket');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [ticketId]);

  useEffect(() => {
    if (ticket?.region_id) {
      api.getCoordinatorsForRegion(ticket.region_id).then(d => setRegionCoordinators(d.users)).catch(() => {});
    }
  }, [ticket?.region_id]);

  // Chat channel — auto-create or join when tab is opened
  useEffect(() => {
    if (activeTab !== 'discussion') return;
    setDiscussionLoading(true);
    (async () => {
      try {
        // Auto-create/join the ticket channel (adds user as member if channel exists)
        const tc = await api.chatTicketChannel(ticketId);
        setDiscussionChannelId(tc.channelId);
        setShowMemberPicker(false);
        const md = await api.chatMessages(tc.channelId);
        setDiscussionMsgs(md.messages || []);
        setDiscussionMembers((allUsers || []).filter(u => u.id !== currentUser.id));
        // If brand new channel, send ticket info as the first system-style message
        if (!tc.existing && md.messages?.length === 0) {
          const ticketInfo = 'Ticket: ' + ticketId + '\nSubject: ' + (ticket?.subject || '(no subject)') + '\nFrom: ' + (ticket?.external_participants?.[0] || ticket?.from_email || 'Unknown') + '\nStatus: ' + (ticket?.status || 'OPEN');
          await api.chatSend(tc.channelId, { body: ticketInfo, type: 'text' });
          const md2 = await api.chatMessages(tc.channelId);
          setDiscussionMsgs(md2.messages || []);
        }
      } catch(e) { showToast?.('Could not open chat'); }
      setDiscussionLoading(false);
    })();
  }, [activeTab, ticketId]);

  // Socket + polling for real-time discussion (Socket.IO may not work on Render)
  useEffect(() => {
    if (!discussionChannelId) return;
    const sock = io(window.location.origin, { transports: ['websocket', 'polling'] });
    socketRef.current = sock;
    sock.emit('join', discussionChannelId);
    sock.on('chat:message', (msg) => {
      if (msg.channelId === discussionChannelId) {
        setDiscussionMsgs(prev => {
          if (prev.find(m => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
      }
    });
    // Poll for new messages every 3 seconds as fallback
    const poll = setInterval(() => {
      api.chatMessages(discussionChannelId).then(md => {
        setDiscussionMsgs(md.messages || []);
      }).catch(() => {});
    }, 3000);
    return () => { clearInterval(poll); sock.emit('leave', discussionChannelId); sock.disconnect(); };
  }, [discussionChannelId]);

  useEffect(() => {
    if (activeTab === 'discussion') discussionEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [discussionMsgs, activeTab]);

  const startDiscussion = async () => {
    if (selectedMemberIds.size === 0) { showToast('Select at least one person to discuss with'); return; }
    setDiscussionLoading(true);
    try {
      const d = await api.chatCreateChannel({ name: ticket?.subject || 'Ticket Discussion', type: 'ticket', ticketId, memberIds: Array.from(selectedMemberIds) });
      setDiscussionChannelId(d.channelId);
      setShowMemberPicker(false);
      const md = await api.chatMessages(d.channelId);
      setDiscussionMsgs(md.messages || []);
    } catch(e) { showToast?.(e.message); }
    setDiscussionLoading(false);
  };

  const sendDiscussion = async () => {
    if (!discussionText.trim() || !discussionChannelId) return;
    const text = discussionText;
    setDiscussionText('');
    try {
      await api.chatSend(discussionChannelId, { body: text, type: 'text' });
      // Immediately fetch messages so the sent message appears
      const md = await api.chatMessages(discussionChannelId);
      setDiscussionMsgs(md.messages || []);
      api.chatMarkRead(discussionChannelId);
    } catch(e) { showToast?.(e.message); setDiscussionText(text); }
  };

  useEffect(() => {
    if (activeTab === 'ai') aiEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [aiMessages, activeTab]);

  const sendAiMessage = async (text) => {
    const msg = text || aiInput;
    if (!msg.trim() || aiLoading) return;
    const userMsg = { role: 'user', content: msg };
    setAiMessages(prev => [...prev, userMsg]);
    setAiInput('');
    setAiLoading(true);
    try {
      const history = aiMessages.length > 0 ? aiMessages : undefined;
      const d = await api.aiChat(ticketId, msg, history);
      setAiMessages(prev => [...prev, { role: 'assistant', content: d.reply }]);
    } catch (e) {
      setAiMessages(prev => [...prev, { role: 'assistant', content: 'Error: ' + (e.message || 'AI request failed') }]);
    }
    setAiLoading(false);
  };

  const aiQuickAction = async (action) => {
    setAiLoading(true);
    let label, fn;
    if (action === 'summarize') { label = 'Summarize this ticket'; fn = () => api.aiSummarize(ticketId); }
    else if (action === 'extract') { label = 'Extract patient information'; fn = () => api.aiExtractPatient(ticketId); }
    else if (action === 'draft') { label = 'Draft a reply'; fn = () => api.aiDraftReply(ticketId); }
    else if (action === 'tags') { label = 'Suggest tags'; fn = () => api.aiSuggestTags(ticketId); }
    setAiMessages(prev => [...prev, { role: 'user', content: label }]);
    try {
      const d = await fn();
      setAiMessages(prev => [...prev, { role: 'assistant', content: d.result }]);
    } catch (e) {
      setAiMessages(prev => [...prev, { role: 'assistant', content: 'Error: ' + (e.message || 'Failed') }]);
    }
    setAiLoading(false);
  };

  useEffect(() => {
    if (timelineRef.current) {
      timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
    }
  }, [messages, notes]);

  const timeline = useMemo(() => {
    const items = [
      ...messages.map(m => ({ type: m.direction, ts: m.sent_at, data: m })),
      ...notes.map(n => ({ type: 'note', ts: n.created_at, data: n })),
    ];
    return items.sort((a, b) => a.ts - b.ts);
  }, [messages, notes]);

  if (loading || !ticket) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#8a9fb0' }}>
        <div>Loading ticket...</div>
      </div>
    );
  }

  const region = regions.find(r => r.id === ticket.region_id);
  const assignee = ticket.assignee;
  const tags = ticket.tags || [];

  const handleAssign = async (userId) => {
    try {
      const data = await api.assignTicket(ticketId, userId);
      setTicket(data.ticket);
      setShowAssignDropdown(false);
      showToast(userId ? `Assigned to ${data.ticket.assignee?.name}` : 'Returned to region queue');
    } catch (e) {
      showToast(e.message);
    }
  };

  const handleStatusChange = async (status, reasonId) => {
    try {
      const data = await api.changeStatus(ticketId, status, reasonId, closeComment);
      setTicket(data.ticket);
      setShowCloseModal(false);
      setCloseReasonId('');
      setCloseComment('');
      showToast(`Status changed to ${status.replace(/_/g, ' ')}`);
    } catch (e) {
      showToast(e.message);
    }
  };

  const handleSendReply = async () => {
    if (!replyText.trim() || sending) return;
    setSending(true);
    try {
      await api.sendReply(ticketId, replyText, replyAttachments.length > 0 ? replyAttachments : undefined);
      setReplyText('');
      setReplyAttachments([]);
      await fetchData();
      showToast('Reply sent');
    } catch (e) {
      showToast(e.message);
    } finally {
      setSending(false);
    }
  };

  const handleAttachFile = (e) => {
    const files = Array.from(e.target.files || []);
    for (const file of files) {
      if (file.size > 10 * 1024 * 1024) { showToast('File too large (max 10MB)'); continue; }
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result.split(',')[1];
        setReplyAttachments(prev => [...prev, { name: file.name, data: base64, mimeType: file.type || 'application/octet-stream', size: file.size }]);
      };
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  };

  const handleAddNote = async () => {
    if (!noteText.trim() || sending) return;
    setSending(true);
    try {
      await api.addNote(ticketId, noteText);
      setNoteText('');
      setActiveTab('reply');
      await fetchData();
      showToast('Note added');
    } catch (e) {
      showToast(e.message);
    } finally {
      setSending(false);
    }
  };

  const handleAddTag = async (tagId) => {
    try {
      const data = await api.addTag(ticketId, tagId);
      setTicket(data.ticket);
      setShowTagDropdown(false);
    } catch (e) { showToast(e.message); }
  };

  const handleRemoveTag = async (tagId) => {
    try {
      const data = await api.removeTag(ticketId, tagId);
      setTicket(data.ticket);
    } catch (e) { showToast(e.message); }
  };

  const handleChangeRegion = async (regionId) => {
    try {
      const data = await api.changeRegion(ticketId, regionId);
      setTicket(data.ticket);
      setShowRegionDropdown(false);
      showToast(`Moved to ${regions.find(r => r.id === regionId)?.name}`);
    } catch (e) { showToast(e.message); }
  };

  return (
    <div style={{ display: 'flex', height: '100%', animation: 'slideIn 0.2s ease' }}>
      {/* Main thread area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Header */}
        <div style={{ padding: '12px 24px', borderBottom: '1px solid #dde8f2', background: '#ffffff', display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#6b8299', cursor: 'pointer', padding: 4 }}>
            <Icon name="arrowLeft" size={18} />
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", color: '#6b8299' }}>{ticket.id.toUpperCase()}</span>
              <StatusBadge status={ticket.status} />
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ticket.subject}</div>
          </div>
        </div>

        {/* Timeline */}
        <div ref={timelineRef} style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>
          {timeline.map((item, i) => {
            if (item.type === 'inbound') {
              const m = item.data;
              return (
                <div key={m.id} style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#c0d0e4', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="mail" size={13} />
                    </div>
                    <div>
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#1e3a4f' }}>{m.from_address}</span>
                      <span style={{ fontSize: 11, color: '#6b8299', marginLeft: 8 }}>{fmt.full(m.sent_at)}</span>
                    </div>
                    <span style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: '#1a5e9a', background: '#1a5e9a18', padding: '2px 6px', borderRadius: 4, marginLeft: 4 }}>Inbound</span>
                  </div>
                  <div style={{ marginLeft: 36, padding: '14px 18px', background: '#dde8f2', borderRadius: '4px 12px 12px 12px', border: '1px solid #c0d0e4', fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap', color: '#2d4a5e' }}>
                    <MessageBody text={m.body_text} />
                    {m.attachments && m.attachments.length > 0 && (
                      <div style={{ marginTop: 8, borderTop: '1px solid #c0d0e4', paddingTop: 8 }}>
                        {m.attachments.map(att => (
                          <a key={att.id} href={'/api/tickets/' + ticket.id + '/attachments/' + att.id + '/download'} target="_blank" rel="noopener"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: '#c8d8ec', borderRadius: 6, color: '#1a5e9a', fontSize: 11, fontWeight: 600, textDecoration: 'none', marginRight: 6, marginBottom: 4 }}>
                            <Icon name="file" size={12} />
                            {att.filename}
                            {att.size ? ' (' + (att.size > 1024*1024 ? (att.size/1024/1024).toFixed(1)+'MB' : (att.size/1024).toFixed(0)+'KB') + ')' : ''}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            }
            if (item.type === 'outbound') {
              const m = item.data;
              const toAddrs = m.to_addresses || [];
              return (
                <div key={m.id} style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, justifyContent: 'flex-end' }}>
                    <span style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: '#1a5e9a', background: '#1a5e9a18', padding: '2px 6px', borderRadius: 4 }}>Outbound</span>
                    <span style={{ fontSize: 11, color: '#6b8299' }}>{fmt.full(m.sent_at)}</span>
                    {m.sender && <Avatar user={m.sender} size={24} />}
                  </div>
                  {toAddrs.length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8, justifyContent: 'flex-end', fontSize: 11, color: '#6b8299' }}>
                      <span style={{ fontWeight: 600 }}>To:</span> {toAddrs.join(', ')}
                    </div>
                  )}
                  <div style={{ padding: '14px 18px', background: '#e8f0f8', borderRadius: '12px 4px 12px 12px', border: '1px solid #a8c0dc', fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap', color: '#2d4a5e' }}>
                    <MessageBody text={m.body_text} />
                    {m.attachments && m.attachments.length > 0 && (
                      <div style={{ marginTop: 8, borderTop: '1px solid #a8c0dc', paddingTop: 8 }}>
                        {m.attachments.map(att => (
                          <a key={att.id} href={'/api/tickets/' + ticket.id + '/attachments/' + att.id + '/download'} target="_blank" rel="noopener"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: '#d0e0f0', borderRadius: 6, color: '#1a5e9a', fontSize: 11, fontWeight: 600, textDecoration: 'none', marginRight: 6, marginBottom: 4 }}>
                            <Icon name="file" size={12} />
                            {att.filename}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            }
            if (item.type === 'note') {
              const n = item.data;
              return (
                <div key={n.id} style={{ marginBottom: 20, display: 'flex', justifyContent: 'center' }}>
                  <div style={{ maxWidth: '80%', padding: '10px 16px', background: '#fef8ec', borderRadius: 10, border: '1px solid #f0ddb0', fontSize: 12, lineHeight: 1.5 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <Icon name="note" size={12} />
                      <span style={{ fontWeight: 600, color: '#c9963b', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>Internal Note</span>
                      <span style={{ color: '#8a6d2e', fontSize: 10 }}>— {n.author_name} · {fmt.full(n.created_at)}</span>
                    </div>
                    <div style={{ color: '#7a5c10', whiteSpace: 'pre-wrap' }}>{n.body}</div>
                  </div>
                </div>
              );
            }
            return null;
          })}
        </div>

        {/* Compose */}
        {ticket.status !== 'CLOSED' && (
          <div style={{ padding: '16px 24px', borderTop: '1px solid #dde8f2', background: '#ffffff' }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <button onClick={() => setActiveTab('reply')} style={{ padding: '4px 14px', borderRadius: 6, border: 'none', background: activeTab === 'reply' ? '#1a5e9a' : '#dde8f2', color: activeTab === 'reply' ? '#fff' : '#5a7a8a', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                <Icon name="send" size={12} /> Reply
              </button>
              <button onClick={() => setActiveTab('note')} style={{ padding: '4px 14px', borderRadius: 6, border: 'none', background: activeTab === 'note' ? '#c9963b' : '#dde8f2', color: activeTab === 'note' ? '#000' : '#5a7a8a', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                <Icon name="note" size={12} /> Internal Note
              </button>
              <button onClick={() => setActiveTab('discussion')} style={{ padding: '4px 14px', borderRadius: 6, border: 'none', background: activeTab === 'discussion' ? '#1a5e9a' : '#dde8f2', color: activeTab === 'discussion' ? '#fff' : '#5a7a8a', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                <Icon name="send" size={12} /> Start a Chat
              </button>
              <button onClick={() => setActiveTab('ai')} style={{ padding: '4px 14px', borderRadius: 6, border: 'none', background: activeTab === 'ai' ? '#52a8c7' : '#dde8f2', color: activeTab === 'ai' ? '#fff' : '#5a7a8a', fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                <img src="/ai-logo.jpg" alt="" style={{ width: 14, height: 14, borderRadius: 2, objectFit: 'contain' }} /> Seniority AI
              </button>
            </div>
            {activeTab === 'ai' ? (
              <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 350 }}>
                {/* Quick action buttons */}
                {aiMessages.length === 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                    <button onClick={() => aiQuickAction('summarize')} disabled={aiLoading}
                      style={{ padding: '6px 14px', background: '#f0f9fc', border: '1px solid #e8f6fa', borderRadius: 8, fontSize: 11, fontWeight: 600, color: '#3d8ba8', cursor: 'pointer' }}>
                      Summarize Ticket
                    </button>
                    <button onClick={() => aiQuickAction('extract')} disabled={aiLoading}
                      style={{ padding: '6px 14px', background: '#f0f9fc', border: '1px solid #e8f6fa', borderRadius: 8, fontSize: 11, fontWeight: 600, color: '#3d8ba8', cursor: 'pointer' }}>
                      Extract Patient Info
                    </button>
                    <button onClick={() => aiQuickAction('draft')} disabled={aiLoading}
                      style={{ padding: '6px 14px', background: '#f0f9fc', border: '1px solid #e8f6fa', borderRadius: 8, fontSize: 11, fontWeight: 600, color: '#3d8ba8', cursor: 'pointer' }}>
                      Draft Reply
                    </button>
                    <button onClick={() => aiQuickAction('tags')} disabled={aiLoading}
                      style={{ padding: '6px 14px', background: '#f0f9fc', border: '1px solid #e8f6fa', borderRadius: 8, fontSize: 11, fontWeight: 600, color: '#3d8ba8', cursor: 'pointer' }}>
                      Suggest Tags
                    </button>
                  </div>
                )}
                {/* Chat messages */}
                <div style={{ flex: 1, overflowY: 'auto', minHeight: 100, maxHeight: 240, padding: '4px 0' }}>
                  {aiMessages.length === 0 && !aiLoading && (
                    <div style={{ textAlign: 'center', color: '#8a9fb0', fontSize: 12, padding: 16 }}>
                      Ask the AI assistant anything about this ticket, or use a quick action above.
                    </div>
                  )}
                  {aiMessages.map((m, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, padding: '6px 0', alignItems: 'flex-start' }}>
                      <div style={{ width: 24, height: 24, borderRadius: '50%', background: m.role === 'user' ? '#1a5e9a' : '#52a8c7', backgroundImage: m.role === 'assistant' ? '#52a8c7' : 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
                        {m.role === 'user' ? (currentUser.name?.[0] || 'U') : <Icon name="sparkle" size={12} />}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: m.role === 'user' ? '#1e3a4f' : '#3d8ba8', marginBottom: 2 }}>
                          {m.role === 'user' ? 'You' : 'AI Assistant'}
                        </div>
                        <div style={{ fontSize: 13, color: '#334155', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          {m.content}
                        </div>
                        {m.role === 'assistant' && (
                          <button onClick={() => { navigator.clipboard.writeText(m.content); showToast('Copied to clipboard'); }}
                            style={{ marginTop: 4, padding: '2px 8px', background: '#f0f4f9', border: '1px solid #c0d0e4', borderRadius: 4, fontSize: 10, color: '#6b8299', cursor: 'pointer' }}>
                            Copy
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  {aiLoading && (
                    <div style={{ display: 'flex', gap: 8, padding: '6px 0', alignItems: 'center' }}>
                      <div style={{ width: 24, height: 24, borderRadius: '50%', backgroundImage: '#52a8c7', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', flexShrink: 0 }}>
                        <Icon name="sparkle" size={12} />
                      </div>
                      <span style={{ fontSize: 12, color: '#8a9fb0', fontStyle: 'italic' }}>Thinking...</span>
                    </div>
                  )}
                  <div ref={aiEndRef} />
                </div>
                {/* Input */}
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <input value={aiInput} onChange={e => setAiInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAiMessage(); } }}
                    placeholder="Ask AI about this ticket..."
                    disabled={aiLoading}
                    style={{ flex: 1, padding: '10px 14px', background: '#f0f4f9', border: '1px solid #c0d0e4', borderRadius: 20, color: '#1e3a4f', fontSize: 13, outline: 'none' }} />
                  <button onClick={() => sendAiMessage()} disabled={!aiInput.trim() || aiLoading}
                    style={{ padding: '10px 20px', backgroundImage: aiInput.trim() && !aiLoading ? '#52a8c7' : 'none', background: aiInput.trim() && !aiLoading ? undefined : '#dde8f2', color: aiInput.trim() && !aiLoading ? '#fff' : '#8a9fb0', border: 'none', borderRadius: 20, cursor: aiInput.trim() && !aiLoading ? 'pointer' : 'default', fontWeight: 600, fontSize: 13 }}>
                    Ask
                  </button>
                  {aiMessages.length > 0 && (
                    <button onClick={() => setAiMessages([])}
                      style={{ padding: '10px 14px', background: '#dde8f2', color: '#5a7a8a', border: 'none', borderRadius: 20, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
                      Clear
                    </button>
                  )}
                </div>
              </div>
            ) : activeTab === 'discussion' ? (
              <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 340 }}>
                {/* Add members bar */}
                {!discussionLoading && discussionChannelId && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                    <button onClick={() => setShowMemberPicker(!showMemberPicker)}
                      style={{ padding: '4px 10px', background: '#e8f0fe', color: '#1a5e9a', border: '1px solid #c5d7f2', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                      + Add Team Members
                    </button>
                  </div>
                )}
                {showMemberPicker && discussionChannelId && (
                  <div style={{ marginBottom: 8, padding: 8, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 100, overflowY: 'auto' }}>
                      {discussionMembers.map(u => (
                        <button key={u.id} onClick={() => setSelectedMemberIds(prev => { const n = new Set(prev); n.has(u.id) ? n.delete(u.id) : n.add(u.id); return n; })}
                          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', background: selectedMemberIds.has(u.id) ? '#1a5e9a20' : '#fff', border: '1px solid', borderColor: selectedMemberIds.has(u.id) ? '#1a5e9a' : '#c0d0e4', borderRadius: 6, fontSize: 10, color: selectedMemberIds.has(u.id) ? '#1a5e9a' : '#5a7a8a', cursor: 'pointer', fontWeight: selectedMemberIds.has(u.id) ? 600 : 400 }}>
                          <Avatar user={u} size={16} /> {u.name} {selectedMemberIds.has(u.id) && '✓'}
                        </button>
                      ))}
                    </div>
                    {selectedMemberIds.size > 0 && (
                      <button onClick={async () => {
                        try {
                          for (const uid of selectedMemberIds) {
                            await api.chatCreateChannel({ type: 'ticket', ticketId, memberIds: [uid] });
                          }
                          showToast?.(selectedMemberIds.size + ' member(s) added');
                          setSelectedMemberIds(new Set());
                          setShowMemberPicker(false);
                        } catch(e) { showToast?.(e.message); }
                      }}
                        style={{ marginTop: 6, padding: '4px 14px', background: '#1a5e9a', color: '#fff', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                        Add {selectedMemberIds.size} Member(s)
                      </button>
                    )}
                  </div>
                )}
                <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0', minHeight: 120, maxHeight: 220 }}>
                  {discussionLoading && <div style={{ textAlign: 'center', color: '#8a9fb0', fontSize: 12, padding: 16 }}>Opening chat...</div>}
                  {discussionMsgs.map(m => (
                    <div key={m.id} style={{ display: 'flex', gap: 8, padding: '4px 0', alignItems: 'flex-start' }}>
                      <div style={{ width: 24, height: 24, borderRadius: '50%', background: m.userId === currentUser.id ? '#1a5e9a' : '#c0d0e4', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
                        {(m.senderName || '?')[0].toUpperCase()}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: '#1e3a4f' }}>{m.senderName}</span>
                          <span style={{ fontSize: 10, color: '#8a9fb0' }}>{m.createdAt ? new Date(m.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''}</span>
                        </div>
                        <div style={{ fontSize: 13, color: '#334155', lineHeight: 1.4, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.body}</div>
                      </div>
                    </div>
                  ))}
                  <div ref={discussionEndRef} />
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <input value={discussionText} onChange={e => setDiscussionText(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendDiscussion(); } }}
                    placeholder="Type a message..."
                    style={{ flex: 1, padding: '10px 14px', background: '#f0f4f9', border: '1px solid #c0d0e4', borderRadius: 20, color: '#1e3a4f', fontSize: 13, outline: 'none' }} />
                  <button onClick={sendDiscussion} disabled={!discussionText.trim()}
                    style={{ padding: '10px 20px', background: discussionText.trim() ? '#1a5e9a' : '#dde8f2', color: discussionText.trim() ? '#fff' : '#8a9fb0', border: 'none', borderRadius: 20, cursor: discussionText.trim() ? 'pointer' : 'default', fontWeight: 600, fontSize: 13 }}>
                    Send
                  </button>
                </div>
              </div>
            ) : activeTab === 'reply' ? (
              <div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <textarea value={replyText} onChange={e => setReplyText(e.target.value)}
                      placeholder={`Reply to ${(ticket.external_participants || [])[0]}...`}
                      rows={3} style={{ width: '100%', padding: '10px 14px', background: '#dde8f2', border: '1px solid #c0d0e4', borderRadius: 10, color: '#1e3a4f', fontSize: 13, resize: 'vertical', outline: 'none', lineHeight: 1.5, boxSizing: 'border-box' }} />
                    {replyAttachments.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                        {replyAttachments.map((a, i) => (
                          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', background: '#c8d8ec', borderRadius: 6, fontSize: 11, color: '#1a5e9a' }}>
                            <Icon name="file" size={10} />
                            {a.name} ({a.size > 1048576 ? (a.size/1048576).toFixed(1)+'MB' : Math.round(a.size/1024)+'KB'})
                            <button onClick={() => setReplyAttachments(prev => prev.filter((_, j) => j !== i))}
                              style={{ background: 'none', border: 'none', color: '#d94040', cursor: 'pointer', padding: 0, fontSize: 14, lineHeight: 1, marginLeft: 2 }}>×</button>
                          </span>
                        ))}
                      </div>
                    )}
                    <div style={{ marginTop: 6 }}>
                      <input type="file" ref={fileInputRef} onChange={handleAttachFile} multiple style={{ display: 'none' }} />
                      <button onClick={() => fileInputRef.current?.click()}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', background: '#f0f4f9', border: '1px solid #c0d0e4', borderRadius: 6, cursor: 'pointer', fontSize: 11, color: '#6b8299' }}>
                        <Icon name="file" size={12} /> Attach File
                      </button>
                    </div>
                  </div>
                  <button onClick={handleSendReply} disabled={!replyText.trim() || sending}
                    style={{ padding: '10px 20px', background: replyText.trim() && !sending ? '#1a5e9a' : '#dde8f2', color: replyText.trim() && !sending ? '#fff' : '#8a9fb0', border: 'none', borderRadius: 10, cursor: replyText.trim() && !sending ? 'pointer' : 'default', fontWeight: 600, fontSize: 13, alignSelf: 'flex-end' }}>
                    {sending ? '...' : 'Send'}
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 10 }}>
                <textarea value={noteText} onChange={e => setNoteText(e.target.value)}
                  placeholder="Add an internal note (only visible to team)..."
                  rows={3} style={{ flex: 1, padding: '10px 14px', background: '#fef8ec', border: '1px solid #f0ddb0', borderRadius: 10, color: '#7a5c10', fontSize: 13, resize: 'vertical', outline: 'none', lineHeight: 1.5 }} />
                <button onClick={handleAddNote} disabled={!noteText.trim() || sending}
                  style={{ padding: '10px 20px', background: noteText.trim() && !sending ? '#c9963b' : '#dde8f2', color: noteText.trim() && !sending ? '#000' : '#8a9fb0', border: 'none', borderRadius: 10, cursor: noteText.trim() && !sending ? 'pointer' : 'default', fontWeight: 600, fontSize: 13, alignSelf: 'flex-end' }}>
                  Save Note
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right sidebar */}
      <div style={{ width: 280, borderLeft: '1px solid #dde8f2', background: '#ffffff', overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Assignment */}
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: '#6b8299', marginBottom: 8 }}>Assigned To</div>
          <div style={{ position: 'relative' }}>
            {assignee ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Avatar user={assignee} size={28} />
                <span style={{ fontSize: 13, fontWeight: 500, flex: 1 }}>{assignee.name}</span>
                {(assignee.id === currentUser.id || isSupervisor) && (
                  <button onClick={() => handleAssign(null)} style={{ background: 'none', border: 'none', color: '#d94040', cursor: 'pointer', fontSize: 10, fontWeight: 600 }}>Unassign</button>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => handleAssign(currentUser.id)} style={{ flex: 1, padding: '8px 12px', background: '#1a5e9a', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                  Assign to Me
                </button>
                {isSupervisor && (
                  <button onClick={() => setShowAssignDropdown(!showAssignDropdown)} style={{ padding: '8px', background: '#dde8f2', color: '#5a7a8a', border: '1px solid #c0d0e4', borderRadius: 8, cursor: 'pointer' }}>
                    <Icon name="users" size={14} />
                  </button>
                )}
              </div>
            )}
            {showAssignDropdown && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#dde8f2', border: '1px solid #c0d0e4', borderRadius: 8, marginTop: 4, zIndex: 10, overflow: 'hidden' }}>
                {regionCoordinators.map(u => (
                  <button key={u.id} onClick={() => handleAssign(u.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px', background: 'transparent', border: 'none', color: '#1e3a4f', cursor: 'pointer', fontSize: 12, textAlign: 'left' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#c8d8ec'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <Avatar user={u} size={22} />{u.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Status */}
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: '#6b8299', marginBottom: 8 }}>Status</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {ticket.status !== 'CLOSED' && (
              <>
                {ticket.status !== 'OPEN' && (
                  <button onClick={() => handleStatusChange('OPEN')} style={{ padding: '6px 12px', background: '#dde8f2', color: '#1a5e9a', border: '1px solid #c0d0e4', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>Set Open</button>
                )}
                {ticket.status !== 'WAITING_ON_EXTERNAL' && (
                  <button onClick={() => handleStatusChange('WAITING_ON_EXTERNAL')} style={{ padding: '6px 12px', background: '#dde8f2', color: '#c9963b', border: '1px solid #c0d0e4', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>Set Waiting</button>
                )}
                <button onClick={() => setShowCloseModal(true)} style={{ padding: '6px 12px', background: '#dde8f2', color: '#d94040', border: '1px solid #c0d0e4', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>Close</button>
                {isSupervisor && (
                  <button onClick={() => setPullMenuOpen(true)}
                    style={{ padding: '6px 12px', background: '#dde8f2', color: '#c96a1b', border: '1px solid #c0d0e4', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
                    Pull from Queue
                  </button>
                )}
              </>
            )}
            {ticket.status === 'CLOSED' && isSupervisor && (
              <button onClick={() => handleStatusChange('OPEN')} style={{ padding: '6px 12px', background: '#dde8f2', color: '#1a6aaa', border: '1px solid #c0d0e4', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>Reopen</button>
            )}
            {ticket.status === 'CLOSED' && !isSupervisor && (
              <div style={{ fontSize: 11, color: '#6b8299', fontStyle: 'italic' }}>Closed — supervisor override required</div>
            )}
          </div>
        </div>

        {/* Region */}
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: '#6b8299', marginBottom: 8 }}>Region</div>
          <div style={{ position: 'relative' }}>
            <button onClick={() => isSupervisor && setShowRegionDropdown(!showRegionDropdown)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: '#dde8f2', border: '1px solid #c0d0e4', borderRadius: 6, color: '#1e3a4f', fontSize: 12, cursor: isSupervisor ? 'pointer' : 'default', width: '100%', textAlign: 'left' }}>
              {region?.name}
              {isSupervisor && <Icon name="chevronDown" size={12} />}
            </button>
            {showRegionDropdown && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#dde8f2', border: '1px solid #c0d0e4', borderRadius: 8, marginTop: 4, zIndex: 10, overflow: 'hidden' }}>
                {regions.filter(r => r.is_active).map(r => (
                  <button key={r.id} onClick={() => handleChangeRegion(r.id)}
                    style={{ display: 'block', width: '100%', padding: '8px 12px', background: r.id === ticket.region_id ? '#c8d8ec' : 'transparent', border: 'none', color: '#1e3a4f', cursor: 'pointer', fontSize: 12, textAlign: 'left' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#c8d8ec'}
                    onMouseLeave={e => { if (r.id !== ticket.region_id) e.currentTarget.style.background = 'transparent'; }}>
                    {r.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Tags */}
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: '#6b8299', marginBottom: 8 }}>Tags</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
            {tags.map(tag => <TagPill key={tag.id} tag={tag} onRemove={() => handleRemoveTag(tag.id)} />)}
          </div>
          <div style={{ position: 'relative' }}>
            <button onClick={() => setShowTagDropdown(!showTagDropdown)} style={{ padding: '4px 10px', background: '#dde8f2', border: '1px dashed #c0d0e4', borderRadius: 6, color: '#6b8299', fontSize: 11, cursor: 'pointer' }}>+ Add tag</button>
            {showTagDropdown && (
              <div style={{ position: 'absolute', top: '100%', left: 0, background: '#dde8f2', border: '1px solid #c0d0e4', borderRadius: 8, marginTop: 4, zIndex: 10, overflow: 'hidden', minWidth: 160 }}>
                {allTags.filter(t => !ticket.tagIds.includes(t.id)).map(tag => (
                  <button key={tag.id} onClick={() => handleAddTag(tag.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '8px 12px', background: 'transparent', border: 'none', color: '#1e3a4f', cursor: 'pointer', fontSize: 12, textAlign: 'left' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#c8d8ec'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: tag.color }} />
                    {tag.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Details */}
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: '#6b8299', marginBottom: 8 }}>Details</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#6b8299' }}>Received</span><span>{fmt.full(ticket.created_at)}</span>
            </div>
            {ticket.assigned_at && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#6b8299' }}>Assigned</span><span>{fmt.full(ticket.assigned_at)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#6b8299' }}>Last activity</span><span>{fmt.time(ticket.last_activity_at)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#6b8299' }}>Participants</span>
              <span style={{ textAlign: 'right', fontSize: 11 }}>{(ticket.external_participants || []).join(', ')}</span>
            </div>
            {ticket.closed_at && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#6b8299' }}>Closed</span><span>{fmt.full(ticket.closed_at)}</span>
              </div>
            )}
            {ticket.close_reason_id && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#6b8299' }}>Reason</span>
                <span style={{ textAlign: 'right', fontSize: 11 }}>{closeReasons.find(r => r.id === ticket.close_reason_id)?.label}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Close modal */}
      {showCloseModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={() => setShowCloseModal(false)}>
          <div style={{ background: '#f0f4f9', borderRadius: 16, border: '1px solid #c0d0e4', padding: 24, width: 400 }} onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Close Ticket</h3>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#5a7a8a', display: 'block', marginBottom: 6 }}>Closure Reason *</label>
              <select value={closeReasonId} onChange={e => setCloseReasonId(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', background: '#dde8f2', border: '1px solid #c0d0e4', borderRadius: 8, color: '#1e3a4f', fontSize: 13 }}>
                <option value="">Select a reason...</option>
                {closeReasons.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </div>
            {closeReasonId && closeReasons.find(r => r.id === closeReasonId)?.requires_comment ? (
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#5a7a8a', display: 'block', marginBottom: 6 }}>Comment *</label>
                <textarea value={closeComment} onChange={e => setCloseComment(e.target.value)} rows={3}
                  style={{ width: '100%', padding: '8px 12px', background: '#dde8f2', border: '1px solid #c0d0e4', borderRadius: 8, color: '#1e3a4f', fontSize: 13, resize: 'none' }} />
              </div>
            ) : null}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowCloseModal(false)} style={{ padding: '8px 16px', background: '#dde8f2', color: '#5a7a8a', border: '1px solid #c0d0e4', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>Cancel</button>
              <button onClick={() => handleStatusChange('CLOSED', closeReasonId)} disabled={!closeReasonId}
                style={{ padding: '8px 16px', background: closeReasonId ? '#d94040' : '#dde8f2', color: closeReasonId ? '#fff' : '#8a9fb0', border: 'none', borderRadius: 8, cursor: closeReasonId ? 'pointer' : 'default', fontSize: 12, fontWeight: 600 }}>
                Close Ticket
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Pull from Queue modal */}
      {pullMenuOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={() => setPullMenuOpen(false)}>
          <div style={{ background: '#f0f4f9', borderRadius: 16, border: '1px solid #c0d0e4', padding: 28, width: 400 }} onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1e3a4f', marginBottom: 8 }}>Pull from Queue</h3>
            <p style={{ fontSize: 13, color: '#6b8299', marginBottom: 20 }}>Where should this email go?</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button onClick={async () => { setPullMenuOpen(false); try { await api.pullFromQueue(ticketId, 'original'); showToast('Returned to original inbox'); onBack(); } catch(e) { showToast(e.message); } }}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', background: '#fff', border: '1px solid #c0d0e4', borderRadius: 10, cursor: 'pointer', textAlign: 'left' }}
                onMouseEnter={e => { e.currentTarget.style.background='#e8f0fe'; e.currentTarget.style.borderColor='#1a5e9a'; }}
                onMouseLeave={e => { e.currentTarget.style.background='#fff'; e.currentTarget.style.borderColor='#c0d0e4'; }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#e8f0fe', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1a5e9a" strokeWidth="2"><path d="M12 22c5.52 0 10-4.48 10-10S17.52 2 12 2 2 6.48 2 12s4.48 10 10 10z"/><path d="M8 12l-4 0"/><path d="M16 12l4 0"/><path d="M12 8l0-4"/><path d="M12 16l0 4"/></svg>
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#1e3a4f' }}>Return to original recipient</div>
                  <div style={{ fontSize: 11, color: '#6b8299', marginTop: 2 }}>Send back to the coordinator who received it</div>
                </div>
              </button>
              <button onClick={async () => { setPullMenuOpen(false); try { await api.pullFromQueue(ticketId, 'me'); showToast('Pulled to your inbox'); onBack(); } catch(e) { showToast(e.message); } }}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', background: '#fff', border: '1px solid #c0d0e4', borderRadius: 10, cursor: 'pointer', textAlign: 'left' }}
                onMouseEnter={e => { e.currentTarget.style.background='#e8f0fe'; e.currentTarget.style.borderColor='#1a5e9a'; }}
                onMouseLeave={e => { e.currentTarget.style.background='#fff'; e.currentTarget.style.borderColor='#c0d0e4'; }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#e8f0fe', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1a5e9a" strokeWidth="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 4l-10 8L2 4"/></svg>
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#1e3a4f' }}>Pull to my inbox</div>
                  <div style={{ fontSize: 11, color: '#6b8299', marginTop: 2 }}>Forward the email to your own Gmail</div>
                </div>
              </button>
            </div>
            <div style={{ marginTop: 16, textAlign: 'right' }}>
              <button onClick={() => setPullMenuOpen(false)}
                style={{ padding: '8px 16px', background: '#dde8f2', color: '#5a7a8a', border: '1px solid #c0d0e4', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
