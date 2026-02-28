import React, { useState, useEffect, useMemo, useRef } from 'react';
import { api } from '../api';
import { fmt } from '../utils';
import Icon from './Icons';
import { StatusBadge, TagPill, Avatar } from './ui';

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
  const timelineRef = useRef(null);

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
      await api.sendReply(ticketId, replyText);
      setReplyText('');
      await fetchData();
      showToast('Reply sent');
    } catch (e) {
      showToast(e.message);
    } finally {
      setSending(false);
    }
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
                    {m.body_text}
                  </div>
                </div>
              );
            }
            if (item.type === 'outbound') {
              const m = item.data;
              return (
                <div key={m.id} style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, justifyContent: 'flex-end' }}>
                    <span style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: '#1a5e9a', background: '#1a5e9a18', padding: '2px 6px', borderRadius: 4 }}>Outbound</span>
                    <span style={{ fontSize: 11, color: '#6b8299' }}>{fmt.full(m.sent_at)}</span>
                    {m.sender && <Avatar user={m.sender} size={24} />}
                  </div>
                  <div style={{ padding: '14px 18px', background: '#e8f0f8', borderRadius: '12px 4px 12px 12px', border: '1px solid #a8c0dc', fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap', color: '#2d4a5e' }}>
                    {m.body_text}
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
            </div>
            {activeTab === 'reply' ? (
              <div style={{ display: 'flex', gap: 10 }}>
                <textarea value={replyText} onChange={e => setReplyText(e.target.value)}
                  placeholder={`Reply to ${(ticket.external_participants || [])[0]}...`}
                  rows={3} style={{ flex: 1, padding: '10px 14px', background: '#dde8f2', border: '1px solid #c0d0e4', borderRadius: 10, color: '#1e3a4f', fontSize: 13, resize: 'vertical', outline: 'none', lineHeight: 1.5 }} />
                <button onClick={handleSendReply} disabled={!replyText.trim() || sending}
                  style={{ padding: '10px 20px', background: replyText.trim() && !sending ? '#1a5e9a' : '#dde8f2', color: replyText.trim() && !sending ? '#fff' : '#8a9fb0', border: 'none', borderRadius: 10, cursor: replyText.trim() && !sending ? 'pointer' : 'default', fontWeight: 600, fontSize: 13, alignSelf: 'flex-end' }}>
                  {sending ? '...' : 'Send'}
                </button>
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
              <span style={{ color: '#6b8299' }}>Created</span><span>{fmt.full(ticket.created_at)}</span>
            </div>
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
    </div>
  );
}
