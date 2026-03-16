const fs = require('fs');
let td = fs.readFileSync('client/src/components/TicketDetail.jsx', 'utf8');

// 1. Add imports
td = td.replace(
  "import { StatusBadge, TagPill, Avatar } from './ui';",
  "import { StatusBadge, TagPill, Avatar } from './ui';\nimport io from 'socket.io-client';"
);

// 2. Add discussion state variables after the existing state
td = td.replace(
  "const timelineRef = useRef(null);",
  `const timelineRef = useRef(null);
  const [discussionMsgs, setDiscussionMsgs] = useState([]);
  const [discussionText, setDiscussionText] = useState('');
  const [discussionChannelId, setDiscussionChannelId] = useState(null);
  const [discussionLoading, setDiscussionLoading] = useState(false);
  const discussionEndRef = useRef(null);
  const socketRef = useRef(null);`
);

// 3. Add useEffect to load/create discussion channel when Discussion tab is selected
td = td.replace(
  "useEffect(() => {\n    if (timelineRef.current) {",
  `// Discussion channel
  useEffect(() => {
    if (activeTab !== 'discussion') return;
    setDiscussionLoading(true);
    api.chatTicketChannel(ticketId).then(d => {
      setDiscussionChannelId(d.channelId);
      return api.chatMessages(d.channelId);
    }).then(d => {
      setDiscussionMsgs(d.messages || []);
      setDiscussionLoading(false);
    }).catch(() => setDiscussionLoading(false));
  }, [activeTab, ticketId]);

  // Socket for real-time discussion
  useEffect(() => {
    if (!discussionChannelId) return;
    const sock = io(window.location.origin, { transports: ['websocket', 'polling'] });
    socketRef.current = sock;
    sock.emit('join', discussionChannelId);
    sock.on('chat:message', (msg) => {
      if (msg.channelId === discussionChannelId) {
        setDiscussionMsgs(prev => [...prev, msg]);
      }
    });
    return () => { sock.emit('leave', discussionChannelId); sock.disconnect(); };
  }, [discussionChannelId]);

  useEffect(() => {
    if (activeTab === 'discussion') discussionEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [discussionMsgs, activeTab]);

  const sendDiscussion = async () => {
    if (!discussionText.trim() || !discussionChannelId) return;
    try {
      await api.chatSend(discussionChannelId, { body: discussionText, type: 'text' });
      setDiscussionText('');
      if (discussionChannelId) api.chatMarkRead(discussionChannelId);
    } catch(e) { showToast?.(e.message); }
  };

  useEffect(() => {
    if (timelineRef.current) {`
);

// 4. Add Discussion tab button next to Reply and Internal Note
td = td.replace(
  `<button onClick={() => setActiveTab('note')} style={{ padding: '4px 14px', borderRadius: 6, border: 'none', background: activeTab === 'note' ? '#c9963b' : '#dde8f2', color: activeTab === 'note' ? '#000' : '#5a7a8a', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                <Icon name="note" size={12} /> Internal Note
              </button>`,
  `<button onClick={() => setActiveTab('note')} style={{ padding: '4px 14px', borderRadius: 6, border: 'none', background: activeTab === 'note' ? '#c9963b' : '#dde8f2', color: activeTab === 'note' ? '#000' : '#5a7a8a', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                <Icon name="note" size={12} /> Internal Note
              </button>
              <button onClick={() => setActiveTab('discussion')} style={{ padding: '4px 14px', borderRadius: 6, border: 'none', background: activeTab === 'discussion' ? '#1a5e9a' : '#dde8f2', color: activeTab === 'discussion' ? '#fff' : '#5a7a8a', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                <Icon name="send" size={12} /> Discussion
              </button>`
);

// 5. Add Discussion panel after the note panel
// Find the closing of the note section and add discussion after it
td = td.replace(
  `            {activeTab === 'reply' ? (`,
  `            {activeTab === 'discussion' ? (
              <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 300 }}>
                <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0', minHeight: 120, maxHeight: 200 }}>
                  {discussionLoading && <div style={{ textAlign: 'center', color: '#8a9fb0', fontSize: 12, padding: 16 }}>Loading discussion...</div>}
                  {!discussionLoading && discussionMsgs.length === 0 && (
                    <div style={{ textAlign: 'center', color: '#8a9fb0', fontSize: 12, padding: 16 }}>No discussion yet. Start the conversation about this ticket.</div>
                  )}
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
                    placeholder="Discuss this ticket with your team..."
                    style={{ flex: 1, padding: '10px 14px', background: '#f0f4f9', border: '1px solid #c0d0e4', borderRadius: 20, color: '#1e3a4f', fontSize: 13, outline: 'none' }} />
                  <button onClick={sendDiscussion} disabled={!discussionText.trim()}
                    style={{ padding: '10px 20px', background: discussionText.trim() ? '#1a5e9a' : '#dde8f2', color: discussionText.trim() ? '#fff' : '#8a9fb0', border: 'none', borderRadius: 20, cursor: discussionText.trim() ? 'pointer' : 'default', fontWeight: 600, fontSize: 13 }}>
                    Send
                  </button>
                </div>
              </div>
            ) : activeTab === 'reply' ? (`
);

fs.writeFileSync('client/src/components/TicketDetail.jsx', td, 'utf8');

const check = fs.readFileSync('client/src/components/TicketDetail.jsx', 'utf8');
console.log(check.includes('discussionChannelId') && check.includes("activeTab === 'discussion'") ? '✓ Discussion tab added to TicketDetail' : '✗ Failed');
console.log('');
console.log('Features:');
console.log('  • Discussion tab next to Reply and Internal Note');
console.log('  • Real-time chat via socket.io');
console.log('  • Auto-creates a channel per ticket');
console.log('  • All active users can see ticket discussions');
console.log('  • Messages appear instantly for all viewers');
