const fs = require('fs');
let app = fs.readFileSync('client/src/App.jsx', 'utf8');

// 1. Add chatOpen state
if (!app.includes('chatOpen')) {
  app = app.replace(
    "const [chatUnread, setChatUnread] = useState(0);",
    "const [chatUnread, setChatUnread] = useState(0);\n  const [chatOpen, setChatOpen] = useState(false);"
  );
}

// 2. Change chat nav item to toggle panel instead of switching screen
app = app.replace(
  "{ key: 'chat', icon: 'send', label: 'Chat', badge: chatUnread, badgeColor: '#1a5e9a' },",
  "{ key: '_chat_toggle' },"
);

// 3. Add the _chat_toggle handler in the nav render section, before _workspace_toggle
app = app.replace(
  "if (item.key === '_workspace_toggle') return (",
  `if (item.key === '_chat_toggle') return (
              <button key="_chat_toggle" onClick={() => setChatOpen(c => !c)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: sidebarCollapsed ? '10px 14px' : '10px 12px',
                  borderRadius: 8, border: 'none', background: chatOpen ? '#102f54' : 'transparent',
                  color: chatOpen ? '#ffffff' : '#143d6b', cursor: 'pointer', fontSize: 13, fontWeight: 500,
                  width: '100%', textAlign: 'left', justifyContent: sidebarCollapsed ? 'center' : 'flex-start' }}
                onMouseEnter={e => { if (!chatOpen) { e.currentTarget.style.background = '#102f54'; e.currentTarget.style.color = '#ffffff'; } }}
                onMouseLeave={e => { if (!chatOpen) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#143d6b'; } }}
                title="Chat">
                <Icon name="send" size={18} />
                {!sidebarCollapsed && <span>Chat</span>}
                {!sidebarCollapsed && chatUnread > 0 && (
                  <span style={{ marginLeft: 'auto', background: '#1a5e9a', color: '#fff', fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 99 }}>{chatUnread}</span>
                )}
                {sidebarCollapsed && chatUnread > 0 && (
                  <span style={{ position: 'absolute', top: 2, right: 2, background: '#1a5e9a', color: '#fff', fontSize: 9, fontWeight: 700, padding: '0 4px', borderRadius: 99 }}>{chatUnread}</span>
                )}
              </button>
            );
            if (item.key === '_workspace_toggle') return (`
);

// 4. Remove the full-screen chat render
app = app.replace(
  `{screen === 'chat' && (
          <ChatScreen currentUser={currentUser} allUsers={allUsers} showToast={showToast} />
        )}
        `,
  ''
);

// 5. Add chat as a right-side slide panel inside the main layout
// Wrap the main content area to include the chat panel
app = app.replace(
  `{/* Main content */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>`,
  `{/* Main content + Chat panel */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>`
);

// Close main and add chat panel before the outer div closes
app = app.replace(
  `{/* Toast */}
        {toast && (
          <div style={{ position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: '#1e293b', color: '#1e3a4f', padding: '10px 24px', borderRadius: 10, fontSize: 13, fontWeight: 500, boxShadow: '0 8px 32px rgba(0,0,0,0.4)', border: '1px solid #c0d0e4', zIndex: 999, animation: 'fadeIn 0.2s ease' }}>
            <Icon name="check" size={14} /> {toast}
          </div>
        )}
      </main>`,
  `{/* Toast */}
        {toast && (
          <div style={{ position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: '#1e293b', color: '#1e3a4f', padding: '10px 24px', borderRadius: 10, fontSize: 13, fontWeight: 500, boxShadow: '0 8px 32px rgba(0,0,0,0.4)', border: '1px solid #c0d0e4', zIndex: 999, animation: 'fadeIn 0.2s ease' }}>
            <Icon name="check" size={14} /> {toast}
          </div>
        )}
      </main>

      {/* Chat Slide Panel */}
      {chatOpen && (
        <div style={{ width: 380, flexShrink: 0, borderLeft: '1px solid #dde8f2', display: 'flex', flexDirection: 'column', background: '#fff', transition: 'width 0.2s ease', overflow: 'hidden' }}>
          <ChatScreen currentUser={currentUser} allUsers={allUsers} showToast={showToast} isPanel={true} onClose={() => setChatOpen(false)} />
        </div>
      )}
      </div>`
);

fs.writeFileSync('client/src/App.jsx', app, 'utf8');
console.log(app.includes('chatOpen') && app.includes('_chat_toggle') ? '✓ Chat converted to slide-out right panel' : '✗ Failed');

// 6. Update ChatScreen to support panel mode
let chat = fs.readFileSync('client/src/components/ChatScreen.jsx', 'utf8');

// Update the component signature to accept isPanel and onClose props
chat = chat.replace(
  'export default function ChatScreen({ currentUser, allUsers, showToast }) {',
  'export default function ChatScreen({ currentUser, allUsers, showToast, isPanel, onClose }) {'
);

// Make channel list narrower in panel mode
chat = chat.replace(
  "width: 300, borderRight: '1px solid #e2e8f0',",
  "width: isPanel ? '100%' : 300, borderRight: isPanel ? 'none' : '1px solid #e2e8f0',"
);

// In panel mode, show channel list OR chat area, not both side by side
// Replace the outer flex container
chat = chat.replace(
  "display: 'flex', height: '100%', background: '#fff',",
  "display: 'flex', flexDirection: isPanel ? 'column' : 'row', height: '100%', background: '#fff',"
);

// Hide channel list when a channel is active in panel mode
chat = chat.replace(
  `{/* Channel List */}
      <div style={{ width: 300`,
  `{/* Channel List */}
      <div style={{ display: isPanel && activeChannel ? 'none' : 'flex', width: isPanel ? '100%' : 300`
);

// Hide chat area when no channel is active in panel mode  
chat = chat.replace(
  `{/* Chat Area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>`,
  `{/* Chat Area */}
      <div style={{ flex: 1, display: isPanel && !activeChannel && !showNew ? 'none' : 'flex', flexDirection: 'column' }}>`
);

// Add close button and back button for panel mode in the header
chat = chat.replace(
  `<span style={{ fontSize: 16, fontWeight: 700, color: '#1e3a4f' }}>Messages</span>`,
  `{isPanel && onClose && <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: 18, padding: 4 }}>✕</button>}
          <span style={{ fontSize: 16, fontWeight: 700, color: '#1e3a4f' }}>Messages</span>`
);

// Show back button in panel header when viewing a channel
chat = chat.replace(
  "background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: 18, padding: 4, display: 'none'",
  "background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: 18, padding: 4, display: isPanel ? 'block' : 'none'"
);

// In new conversation view, add back button for panel mode
chat = chat.replace(
  `<button onClick={() => { setShowNew(false); setSelectedMembers([]); setNewName(''); }} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#64748b' }}>✕</button>`,
  `<button onClick={() => { setShowNew(false); setSelectedMembers([]); setNewName(''); if (isPanel && !activeChannel) {} }} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#64748b' }}>✕</button>`
);

fs.writeFileSync('client/src/components/ChatScreen.jsx', chat, 'utf8');
console.log('✓ ChatScreen updated for panel mode');
