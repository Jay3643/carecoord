import React, { useState, useRef, useEffect } from 'react';
import { api } from '../api';
import Icon from './Icons';

export default function AiPanel({ currentUser, onClose, showToast, activeTicketId }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [contextTicketId, setContextTicketId] = useState(activeTicketId || null);
  const [contextLabel, setContextLabel] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const endRef = useRef(null);

  useEffect(() => {
    if (activeTicketId !== contextTicketId) {
      setContextTicketId(activeTicketId || null);
    }
  }, [activeTicketId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Fetch suggestions on mount
  useEffect(() => {
    setSuggestionsLoading(true);
    api.aiSuggestions().then(d => {
      setSuggestions(d.suggestions || []);
    }).catch(() => {}).finally(() => setSuggestionsLoading(false));
  }, []);

  useEffect(() => {
    if (contextTicketId) {
      api.getTicket(contextTicketId).then(d => {
        setContextLabel(d.ticket?.subject || contextTicketId);
      }).catch(() => setContextLabel(contextTicketId));
    } else {
      setContextLabel('');
    }
  }, [contextTicketId]);

  const sendMessage = async (text) => {
    const msg = text || input;
    if (!msg.trim() || loading) return;
    const userMsg = { role: 'user', content: msg };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    try {
      const history = messages.length > 0 ? messages : undefined;
      let d;
      if (contextTicketId) {
        d = await api.aiChat(contextTicketId, msg, history);
      } else {
        d = await api.aiGeneralChat(msg, history);
      }
      setMessages(prev => [...prev, { role: 'assistant', content: d.reply }]);
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Error: ' + (e.message || 'AI request failed') }]);
    }
    setLoading(false);
  };

  const quickAction = async (action) => {
    if (!contextTicketId) { showToast('Open a ticket to use ticket actions'); return; }
    setLoading(true);
    let label, fn;
    if (action === 'summarize') { label = 'Summarize this ticket'; fn = () => api.aiSummarize(contextTicketId); }
    else if (action === 'extract') { label = 'Extract patient information'; fn = () => api.aiExtractPatient(contextTicketId); }
    else if (action === 'draft') { label = 'Draft a reply'; fn = () => api.aiDraftReply(contextTicketId); }
    else if (action === 'tags') { label = 'Suggest tags'; fn = () => api.aiSuggestTags(contextTicketId); }
    setMessages(prev => [...prev, { role: 'user', content: label }]);
    try {
      const d = await fn();
      setMessages(prev => [...prev, { role: 'assistant', content: d.result }]);
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Error: ' + (e.message || 'Failed') }]);
    }
    setLoading(false);
  };

  const gradient = 'linear-gradient(135deg, #7c3aed, #4f46e5)';
  const hasTicket = !!contextTicketId;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#fff' }}>
      {/* Header */}
      <div style={{ padding: '12px 16px', backgroundImage: gradient, color: '#fff', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <Icon name="sparkle" size={18} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>AI Assistant</div>
          <div style={{ fontSize: 10, opacity: 0.85, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}>
            {contextLabel ? contextTicketId?.toUpperCase() + ' — ' + contextLabel : 'General — no ticket selected'}
          </div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 4 }}>
          <Icon name="x" size={16} />
        </button>
      </div>

      {/* Quick Actions — only when ticket is active */}
      {hasTicket && (
        <div style={{ padding: '10px 12px', borderBottom: '1px solid #f0f4f9', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {[
            { key: 'summarize', label: 'Summarize' },
            { key: 'extract', label: 'Patient Info' },
            { key: 'draft', label: 'Draft Reply' },
            { key: 'tags', label: 'Suggest Tags' },
          ].map(a => (
            <button key={a.key} onClick={() => quickAction(a.key)} disabled={loading}
              style={{ padding: '4px 10px', background: '#f0f4f9', border: '1px solid #dde8f2', borderRadius: 6, fontSize: 10, fontWeight: 600, color: '#4f46e5', cursor: loading ? 'default' : 'pointer', whiteSpace: 'nowrap' }}>
              {a.label}
            </button>
          ))}
        </div>
      )}

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px' }}>
        {messages.length === 0 && !loading && (
          <div style={{ padding: '16px 4px' }}>
            <div style={{ textAlign: 'center', color: '#8a9fb0', marginBottom: 16 }}>
              <Icon name="sparkle" size={28} />
              <div style={{ marginTop: 6, fontSize: 12 }}>
                {hasTicket
                  ? 'Ask anything about this ticket, or use a quick action above.'
                  : 'Hi ' + (currentUser.name?.split(' ')[0] || '') + '! Here are some things I\'d suggest:'}
              </div>
            </div>
            {/* Suggestions */}
            {suggestionsLoading && (
              <div style={{ textAlign: 'center', fontSize: 11, color: '#8a9fb0', fontStyle: 'italic', padding: 8 }}>Loading suggestions...</div>
            )}
            {!suggestionsLoading && suggestions.length > 0 && !hasTicket && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {suggestions.map((s, i) => (
                  <button key={i} onClick={() => sendMessage(s)}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#f8f6ff', border: '1px solid #e8e0ff', borderRadius: 8, cursor: 'pointer', fontSize: 12, color: '#4f46e5', textAlign: 'left', fontWeight: 500, lineHeight: 1.4 }}
                    onMouseEnter={e => { e.currentTarget.style.background = '#ede9ff'; e.currentTarget.style.borderColor = '#c4b5fd'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = '#f8f6ff'; e.currentTarget.style.borderColor = '#e8e0ff'; }}>
                    <span style={{ color: '#7c3aed', fontSize: 14, flexShrink: 0 }}>→</span>
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, padding: '8px 0', alignItems: 'flex-start' }}>
            <div style={{
              width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
              background: m.role === 'user' ? '#1a5e9a' : undefined,
              backgroundImage: m.role === 'assistant' ? gradient : 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 700
            }}>
              {m.role === 'user' ? (currentUser.name?.[0] || 'U') : <Icon name="sparkle" size={13} />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: m.role === 'user' ? '#1e3a4f' : '#4f46e5', marginBottom: 2 }}>
                {m.role === 'user' ? currentUser.name : 'AI Assistant'}
              </div>
              <div style={{ fontSize: 12, color: '#334155', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {m.content}
              </div>
              {m.role === 'assistant' && (
                <button onClick={() => { navigator.clipboard.writeText(m.content); showToast('Copied'); }}
                  style={{ marginTop: 4, padding: '2px 8px', background: '#f0f4f9', border: '1px solid #dde8f2', borderRadius: 4, fontSize: 9, color: '#6b8299', cursor: 'pointer' }}>
                  Copy
                </button>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ display: 'flex', gap: 8, padding: '8px 0', alignItems: 'center' }}>
            <div style={{ width: 26, height: 26, borderRadius: '50%', backgroundImage: gradient, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', flexShrink: 0 }}>
              <Icon name="sparkle" size={13} />
            </div>
            <span style={{ fontSize: 12, color: '#8a9fb0', fontStyle: 'italic' }}>Thinking...</span>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <div style={{ padding: '8px 12px', borderTop: '1px solid #f0f4f9', display: 'flex', gap: 6, alignItems: 'center' }}>
        <input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
          placeholder={hasTicket ? 'Ask about this ticket...' : 'Ask anything...'}
          disabled={loading}
          style={{ flex: 1, padding: '8px 12px', background: '#f0f4f9', border: '1px solid #dde8f2', borderRadius: 20, color: '#1e3a4f', fontSize: 12, outline: 'none' }} />
        <button onClick={() => sendMessage()} disabled={!input.trim() || loading}
          style={{ padding: '8px 14px', backgroundImage: input.trim() && !loading ? gradient : 'none', background: input.trim() && !loading ? undefined : '#dde8f2', color: input.trim() && !loading ? '#fff' : '#8a9fb0', border: 'none', borderRadius: 20, cursor: input.trim() && !loading ? 'pointer' : 'default', fontWeight: 600, fontSize: 11 }}>
          Ask
        </button>
        {messages.length > 0 && (
          <button onClick={() => setMessages([])}
            style={{ padding: '8px 10px', background: '#dde8f2', color: '#5a7a8a', border: 'none', borderRadius: 20, cursor: 'pointer', fontSize: 10, fontWeight: 600 }}>
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
