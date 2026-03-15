import React, { useState, useRef, useEffect } from 'react';
import { api } from '../api';
import Icon from './Icons';

const TEAL = '#52a8c7';
const TEAL_DARK = '#3d8ba8';
const TEAL_LIGHT = '#e8f6fa';
const TEAL_BG = '#f0f9fc';

const aiCss = `
@keyframes aiPulse {
  0% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.08); opacity: 0.85; }
  100% { transform: scale(1); opacity: 1; }
}
@keyframes aiSpin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
@keyframes aiBreathe {
  0%, 100% { box-shadow: 0 0 0 0 rgba(82,168,199,0.4); }
  50% { box-shadow: 0 0 16px 4px rgba(82,168,199,0.25); }
}
`;

function AiLogo({ size = 28, animate = false }) {
  return (
    <img src="/ai-logo.jpg" alt="AI"
      style={{
        width: size, height: size, borderRadius: 4, objectFit: 'contain', flexShrink: 0,
        animation: animate ? 'aiPulse 1.5s ease-in-out infinite, aiBreathe 1.5s ease-in-out infinite' : 'none',
      }} />
  );
}

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

  const hasTicket = !!contextTicketId;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#fff' }}>
      <style>{aiCss}</style>

      {/* Header */}
      <div style={{ padding: '12px 16px', background: '#143d6b', color: '#fff', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <AiLogo size={30} animate={loading} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Seniority AI</div>
          <div style={{ fontSize: 10, opacity: 0.9, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}>
            {contextLabel ? contextTicketId?.toUpperCase() + ' — ' + contextLabel : 'General — ask me anything'}
          </div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 4 }}>
          <Icon name="x" size={16} />
        </button>
      </div>

      {/* Quick Actions */}
      {hasTicket && (
        <div style={{ padding: '10px 12px', borderBottom: '1px solid ' + TEAL_LIGHT, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {[
            { key: 'summarize', label: 'Summarize' },
            { key: 'extract', label: 'Patient Info' },
            { key: 'draft', label: 'Draft Reply' },
            { key: 'tags', label: 'Suggest Tags' },
          ].map(a => (
            <button key={a.key} onClick={() => quickAction(a.key)} disabled={loading}
              style={{ padding: '4px 10px', background: TEAL_BG, border: '1px solid ' + TEAL_LIGHT, borderRadius: 6, fontSize: 10, fontWeight: 600, color: TEAL_DARK, cursor: loading ? 'default' : 'pointer', whiteSpace: 'nowrap' }}>
              {a.label}
            </button>
          ))}
        </div>
      )}

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px' }}>
        {messages.length === 0 && !loading && (
          <div style={{ padding: '16px 4px' }}>
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <AiLogo size={48} animate={suggestionsLoading} />
              <div style={{ marginTop: 8, fontSize: 12, color: '#5a7a8a' }}>
                {hasTicket
                  ? 'Ask anything about this ticket, or use a quick action above.'
                  : 'Hi ' + (currentUser.name?.split(' ')[0] || '') + '! Here are some things I\'d suggest:'}
              </div>
            </div>
            {suggestionsLoading && (
              <div style={{ textAlign: 'center', fontSize: 11, color: '#8a9fb0', fontStyle: 'italic', padding: 8 }}>Loading suggestions...</div>
            )}
            {!suggestionsLoading && suggestions.length > 0 && !hasTicket && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {suggestions.map((s, i) => (
                  <button key={i} onClick={() => sendMessage(s)}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: TEAL_BG, border: '1px solid ' + TEAL_LIGHT, borderRadius: 8, cursor: 'pointer', fontSize: 12, color: TEAL_DARK, textAlign: 'left', fontWeight: 500, lineHeight: 1.4 }}
                    onMouseEnter={e => { e.currentTarget.style.background = TEAL_LIGHT; e.currentTarget.style.borderColor = TEAL; }}
                    onMouseLeave={e => { e.currentTarget.style.background = TEAL_BG; e.currentTarget.style.borderColor = TEAL_LIGHT; }}>
                    <span style={{ color: TEAL, fontSize: 14, flexShrink: 0 }}>→</span>
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, padding: '8px 0', alignItems: 'flex-start' }}>
            {m.role === 'user' ? (
              <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#1a5e9a', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                {currentUser.name?.[0] || 'U'}
              </div>
            ) : (
              <AiLogo size={26} />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: m.role === 'user' ? '#1e3a4f' : TEAL_DARK, marginBottom: 2 }}>
                {m.role === 'user' ? currentUser.name : 'Seniority AI'}
              </div>
              <div style={{ fontSize: 12, color: '#334155', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {m.content}
              </div>
              {m.role === 'assistant' && (
                <button onClick={() => { navigator.clipboard.writeText(m.content); showToast('Copied'); }}
                  style={{ marginTop: 4, padding: '2px 8px', background: TEAL_BG, border: '1px solid ' + TEAL_LIGHT, borderRadius: 4, fontSize: 9, color: TEAL_DARK, cursor: 'pointer' }}>
                  Copy
                </button>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ display: 'flex', gap: 8, padding: '8px 0', alignItems: 'center' }}>
            <AiLogo size={26} animate={true} />
            <span style={{ fontSize: 12, color: TEAL_DARK, fontStyle: 'italic' }}>Thinking...</span>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <div style={{ padding: '8px 12px', borderTop: '1px solid ' + TEAL_LIGHT, display: 'flex', gap: 6, alignItems: 'center' }}>
        <input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
          placeholder={hasTicket ? 'Ask about this ticket...' : 'Ask anything...'}
          disabled={loading}
          style={{ flex: 1, padding: '8px 12px', background: TEAL_BG, border: '1px solid ' + TEAL_LIGHT, borderRadius: 20, color: '#1e3a4f', fontSize: 12, outline: 'none' }} />
        <button onClick={() => sendMessage()} disabled={!input.trim() || loading}
          style={{ padding: '8px 14px', background: input.trim() && !loading ? TEAL : '#dde8f2', color: input.trim() && !loading ? '#fff' : '#8a9fb0', border: 'none', borderRadius: 20, cursor: input.trim() && !loading ? 'pointer' : 'default', fontWeight: 600, fontSize: 11 }}>
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
