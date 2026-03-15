import React, { useState, useRef } from 'react';
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
  const [attachments, setAttachments] = useState([]);
  const fileInputRef = useRef(null);

  const userRegions = regions.filter(r => currentUser.regionIds.includes(r.id));
  const canSend = toEmail.trim() && subject.trim() && body.trim() && regionId;

  const handleSend = async () => {
    if (!canSend || sending) return;
    setSending(true);
    try {
      const data = await api.createTicket({ toEmail, subject, body, regionId, tagIds: selectedTags, attachments: attachments.length > 0 ? attachments : undefined });
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

  const handleAttachFile = (e) => {
    const files = Array.from(e.target.files || []);
    for (const file of files) {
      if (file.size > 10 * 1024 * 1024) { showToast('File too large (max 10MB)'); continue; }
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result.split(',')[1];
        setAttachments(prev => [...prev, { name: file.name, data: base64, mimeType: file.type || 'application/octet-stream', size: file.size }]);
      };
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={onClose}>
      <div style={{ background: '#f0f4f9', borderRadius: 16, border: '1px solid #c0d0e4', width: 580, maxHeight: '90vh', overflow: 'auto', animation: 'fadeIn 0.2s ease' }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', borderBottom: '1px solid #dde8f2' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: '#1a5e9a20', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="send" size={16} />
            </div>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>New Message</h2>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6b8299', cursor: 'pointer', padding: 4 }}>
            <Icon name="x" size={18} />
          </button>
        </div>

        {/* Form */}
        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* To */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: '#6b8299', display: 'block', marginBottom: 6 }}>To (email) *</label>
            <input type="email" value={toEmail} onChange={e => setToEmail(e.target.value)}
              placeholder="provider@hospital.org"
              style={{ width: '100%', padding: '10px 14px', background: '#dde8f2', border: '1px solid #c0d0e4', borderRadius: 8, color: '#1e3a4f', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
          </div>

          {/* Subject */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: '#6b8299', display: 'block', marginBottom: 6 }}>Subject *</label>
            <input type="text" value={subject} onChange={e => setSubject(e.target.value)}
              placeholder="Patient Name — Topic"
              style={{ width: '100%', padding: '10px 14px', background: '#dde8f2', border: '1px solid #c0d0e4', borderRadius: 8, color: '#1e3a4f', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
          </div>

          {/* Region */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: '#6b8299', display: 'block', marginBottom: 6 }}>Send from Region *</label>
            <select value={regionId} onChange={e => setRegionId(e.target.value)}
              style={{ width: '100%', padding: '10px 14px', background: '#dde8f2', border: '1px solid #c0d0e4', borderRadius: 8, color: '#1e3a4f', fontSize: 13, cursor: 'pointer', boxSizing: 'border-box' }}>
              <option value="">Select region...</option>
              {(currentUser.role === 'supervisor' || currentUser.role === 'admin' ? regions : userRegions)
                .filter(r => r.id !== 'r4')
                .map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>

          {/* Tags */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: '#6b8299', display: 'block', marginBottom: 6 }}>Tags (optional)</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              {selectedTags.map(tagId => {
                const tag = allTags.find(t => t.id === tagId);
                return tag ? <TagPill key={tag.id} tag={tag} onRemove={() => toggleTag(tag.id)} /> : null;
              })}
              <div style={{ position: 'relative' }}>
                <button onClick={() => setShowTagPicker(!showTagPicker)}
                  style={{ padding: '4px 10px', background: '#dde8f2', border: '1px dashed #c0d0e4', borderRadius: 6, color: '#6b8299', fontSize: 11, cursor: 'pointer' }}>
                  + Add tag
                </button>
                {showTagPicker && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, background: '#dde8f2', border: '1px solid #c0d0e4', borderRadius: 8, marginTop: 4, zIndex: 10, overflow: 'hidden', minWidth: 160 }}>
                    {allTags.filter(t => !selectedTags.includes(t.id)).map(tag => (
                      <button key={tag.id} onClick={() => { toggleTag(tag.id); setShowTagPicker(false); }}
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
          </div>

          {/* Body */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: '#6b8299', display: 'block', marginBottom: 6 }}>Message *</label>
            <textarea value={body} onChange={e => setBody(e.target.value)}
              placeholder="Type your message..."
              rows={8}
              style={{ width: '100%', padding: '12px 14px', background: '#dde8f2', border: '1px solid #c0d0e4', borderRadius: 8, color: '#1e3a4f', fontSize: 13, resize: 'vertical', outline: 'none', lineHeight: 1.6, boxSizing: 'border-box' }} />
            <div style={{ fontSize: 11, color: '#8a9fb0', marginTop: 4 }}>
              Your signature ({currentUser.name} — {regions.find(r => r.id === regionId)?.name || 'Region'}) will be appended automatically.
            </div>
          </div>

          {/* Attachments */}
          <div>
            {attachments.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                {attachments.map((a, i) => (
                  <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', background: '#c8d8ec', borderRadius: 6, fontSize: 11, color: '#1a5e9a' }}>
                    <Icon name="file" size={10} />
                    {a.name} ({a.size > 1048576 ? (a.size/1048576).toFixed(1)+'MB' : Math.round(a.size/1024)+'KB'})
                    <button onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))}
                      style={{ background: 'none', border: 'none', color: '#d94040', cursor: 'pointer', padding: 0, fontSize: 14, lineHeight: 1, marginLeft: 2 }}>×</button>
                  </span>
                ))}
              </div>
            )}
            <input type="file" ref={fileInputRef} onChange={handleAttachFile} multiple style={{ display: 'none' }} />
            <button onClick={() => fileInputRef.current?.click()}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', background: '#dde8f2', border: '1px solid #c0d0e4', borderRadius: 6, cursor: 'pointer', fontSize: 11, color: '#6b8299' }}>
              <Icon name="paperclip" size={12} /> Attach Files
            </button>
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', borderTop: '1px solid #dde8f2' }}>
          <div style={{ fontSize: 11, color: '#8a9fb0' }}>
            This creates a new ticket assigned to you.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose}
              style={{ padding: '8px 18px', background: '#dde8f2', color: '#5a7a8a', border: '1px solid #c0d0e4', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
              Cancel
            </button>
            <button onClick={handleSend} disabled={!canSend || sending}
              style={{ padding: '8px 22px', background: canSend && !sending ? '#1a5e9a' : '#dde8f2', color: canSend && !sending ? '#fff' : '#8a9fb0', border: 'none', borderRadius: 8, cursor: canSend && !sending ? 'pointer' : 'default', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="send" size={12} />
              {sending ? 'Sending...' : 'Send Message'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
