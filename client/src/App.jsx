import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from './api';
import Icon from './components/Icons';
import { Avatar } from './components/ui';
import LoginScreen from './components/LoginScreen';
import QueueScreen from './components/QueueScreen';
import TicketDetail from './components/TicketDetail';
import Dashboard from './components/Dashboard';
import AuditLog from './components/AuditLog';
import AdminPanel from './components/AdminPanel';
import ComposeModal from './components/ComposeModal';
import PersonalInbox from './components/PersonalInbox';
import ChatScreen from './components/ChatScreen';
import { GmailConnectButton } from './components/GmailPanel';
import AiPanel from './components/AiPanel';
import SetupAccount from './components/SetupAccount';
import io from 'socket.io-client';

export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [screen, setScreen] = useState('login');
  const [selectedTicketId, setSelectedTicketId] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [toast, setToast] = useState(null);
  const [showCompose, setShowCompose] = useState(false);
  const [showWorkspace, setShowWorkspace] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [workStatus, setWorkStatus] = useState('active');
  const [aiOpen, setAiOpen] = useState(false);
  const [chatWidth, setChatWidth] = useState(380);
  const [aiWidth, setAiWidth] = useState(380);

  // Reference data (loaded once after login)
  const [regions, setRegions] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [allTags, setAllTags] = useState([]);
  const [closeReasons, setCloseReasons] = useState([]);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  // Check existing session on mount
  useEffect(() => {
    const checkAuth = (retries = 3) => {
      api.me()
        .then(data => {
          setCurrentUser(data.user);
          setWorkStatus(data.user.workStatus || 'active');
          setScreen('regionQueue');
          setAuthChecked(true);
        })
        .catch(() => {
          if (retries > 0) setTimeout(() => checkAuth(retries - 1), 1000);
          else setAuthChecked(true);
        });
    };
    checkAuth();
  }, []);

  // Load reference data after login
  useEffect(() => {
    if (currentUser) {
      Promise.all([
        api.getRegions(),
        api.getUsers(),
        api.getTags(),
        api.getCloseReasons(),
      ]).then(([r, u, t, c]) => {
        setRegions(r.regions);
        setAllUsers(u.users);
        setAllTags(t.tags);
        setCloseReasons(c.reasons || c.closeReasons || []);
      }).catch(e => showToast('Error loading reference data'));
    }
  }, [currentUser?.id]);

  const handleLogin = (user) => {
    setCurrentUser(user);
    setWorkStatus(user.workStatus || 'active');
    setScreen('regionQueue');
  };

  const handleLogout = async () => {
    try { await api.logout(); } catch (e) {}
    setCurrentUser(null);
    setScreen('login');
  };

  const toggleWorkStatus = async () => {
    const newStatus = workStatus === 'active' ? 'inactive' : 'active';
    try {
      await api.setWorkStatus(newStatus);
      setWorkStatus(newStatus);
      if (newStatus === 'inactive') {
        showToast('Status: Inactive — your tickets have been returned to the queue');
      } else {
        showToast('Status: Active — you can now receive tickets');
      }
      refreshCounts();
    } catch (e) { showToast(e.message); }
  };

  const openTicket = (id) => {
    setSelectedTicketId(id);
    setScreen('ticketDetail');
  };

  const goBack = () => {
    setSelectedTicketId(null);
    setScreen('regionQueue');
  };

  const isSupervisor = currentUser?.role === 'supervisor' || currentUser?.role === 'admin';

  const refreshCounts = () => {
    if (!currentUser) return;
    api.getTickets({ queue: 'region', status: 'unassigned' })
      .then(d => setUnassignedCount(d.tickets?.length || 0)).catch(() => {});
    api.getTickets({ queue: 'personal', status: 'all' })
      .then(d => setPersonalCount((d.tickets || []).filter(t => t.status !== 'CLOSED' && t.has_unread).length)).catch(() => {});
  };

  // Unassigned count for sidebar badge
  const [unassignedCount, setUnassignedCount] = useState(0);
  const [chatUnread, setChatUnread] = useState(0);
  const [chatOpen, setChatOpen] = useState(false);
  const appSocketRef = React.useRef(null);
  const [personalCount, setPersonalCount] = useState(0);

  useEffect(() => {
    if (!currentUser) return;
    const fetchCounts = () => {
      api.getTickets({ queue: 'region', status: 'unassigned' })
        .then(d => setUnassignedCount(d.tickets.length))
        .catch(() => {});
      api.getTickets({ queue: 'personal', status: 'all' })
        .then(d => setPersonalCount(d.tickets.filter(t => t.status !== 'CLOSED' && t.has_unread).length))
        .catch(() => {});
      api.chatUnread().then(d => setChatUnread(d.unread || 0)).catch(() => {});
    };
    fetchCounts();
    const interval = setInterval(fetchCounts, 5000);
    return () => clearInterval(interval);
  }, [currentUser]);

  // Socket.io for real-time chat notifications
  useEffect(() => {
    if (!currentUser) return;
    const sock = io(window.location.origin, { transports: ['websocket', 'polling'] });
    appSocketRef.current = sock;
    sock.on('chat:message', (msg) => {
      if (msg.userId !== currentUser.id) {
        setChatUnread(prev => prev + 1);
      }
    });
    return () => { sock.disconnect(); };
  }, [currentUser?.id]);

  // Handle /setup route for new user account setup
  if (window.location.search.includes('token=') && window.location.pathname === '/setup') {
    return <SetupAccount />;
  }

  const handleResize = (setter, minW, maxW) => (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = e.target.parentElement.offsetWidth;
    const onMove = (ev) => {
      const delta = startX - ev.clientX;
      setter(Math.min(maxW, Math.max(minW, startW + delta)));
    };
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); document.body.style.cursor = ''; document.body.style.userSelect = ''; };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const chatBadgeStyle = `@keyframes chatPulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.15)} }`;

  if (!authChecked) {
    return <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f4f7f8', color: '#8a9fb0' }}>Loading...</div>;
  }

  if (!currentUser) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#f4f7f8', color: '#1e3a4f', fontFamily: "'IBM Plex Sans', -apple-system, sans-serif", overflow: 'hidden' }}>
      <style>{chatBadgeStyle}</style>
      {/* Sidebar */}
      <aside style={{ width: sidebarCollapsed ? 64 : 240, background: '#f0f4f9', borderRight: '1px solid #dde8f2', display: 'flex', flexDirection: 'column', transition: 'width 0.2s ease', overflow: 'hidden', flexShrink: 0 }}>
        <div style={{ padding: sidebarCollapsed ? '12px 8px' : '12px 16px', borderBottom: '1px solid #102f54', background: '#143d6b', display: 'flex', alignItems: 'center', gap: 10, minHeight: 64 }}>
          {!sidebarCollapsed && (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, lineHeight: 1.2 }}>
              <span style={{ fontWeight: 700, fontSize: 14, color: '#ffffff', whiteSpace: 'nowrap' }}>Seniority Healthcare</span>
              <span style={{ fontSize: 10, color: '#a8c8e8', fontWeight: 400, letterSpacing: 1, textTransform: 'uppercase' }}>Workspace</span>
            </div>
          )}
          {sidebarCollapsed && (
            <span style={{ fontWeight: 700, fontSize: 16, color: '#ffffff', margin: '0 auto' }}>SH</span>
          )}
          <button onClick={() => setSidebarCollapsed(!sidebarCollapsed)} style={{ background: 'none', border: 'none', color: '#a8c8e8', cursor: 'pointer', padding: 4, flexShrink: 0 }}>
            <Icon name={sidebarCollapsed ? 'chevronRight' : 'arrowLeft'} size={16} />
          </button>
        </div>

        <div style={{ padding: sidebarCollapsed ? '12px 8px' : '12px 12px' }}>
          {(currentUser.role === 'admin' || currentUser.role === 'supervisor') && (
          <button onClick={() => setShowCompose(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%',
              padding: sidebarCollapsed ? '10px 14px' : '10px 14px',
              borderRadius: 8, border: 'none',
              background: 'linear-gradient(135deg, #2080c0, #1a5e9a)',
              color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600,
              justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
              boxShadow: '0 2px 8px rgba(14,122,107,0.4)',
            }} title="New Message">
            <Icon name="send" size={16} />
            {!sidebarCollapsed && <span>New Message</span>}
          </button>
          )}
        </div>

        <nav style={{ flex: 1, padding: '4px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {[
            { key: 'regionQueue', icon: 'inbox', label: 'Region Queue', badge: unassignedCount, badgeColor: '#d94040' },
            { key: 'personalQueue', icon: 'user', label: 'My Queue', badge: personalCount, badgeColor: '#d94040' },
            ...(isSupervisor ? [{ key: 'dashboard', icon: 'barChart', label: 'Dashboard' }] : []),
            ...(isSupervisor ? [{ key: 'auditLog', icon: 'log', label: 'Audit Log' }] : []),
            { key: 'personalEmail', icon: 'mail', label: 'Email' },
            { key: '_chat_toggle' },
            { key: '_ai_toggle' },
            ...((currentUser.role === 'admin' || currentUser.role === 'supervisor') ? [{ key: 'admin', icon: 'settings', label: 'Admin' }] : []),
            { key: '_workspace_toggle' },
            { key: '_workspace_apps' },
            { key: '_practice_fusion' },
            { key: '_updox' },
            { key: '_carelink' },
            { key: '_prompted' },
          ].map(item => {
            if (item.key === '_divider') return !sidebarCollapsed ? <div key="_div" style={{ height: 1, background: '#102f54', margin: '8px 12px' }} /> : <div key="_div" style={{ height: 1, background: '#102f54', margin: '8px 4px' }} />;
            if (item.key === '_chat_toggle') return (
              <button key="_chat_toggle" onClick={() => setChatOpen(c => { if (!c) { api.chatUnread().then(d => setChatUnread(d.unread || 0)).catch(() => {}); } return !c; })}
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
                  <span style={{ marginLeft: 'auto', background: '#d94040', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 99, animation: 'chatPulse 2s ease infinite' }}>{chatUnread}</span>
                )}
                {sidebarCollapsed && chatUnread > 0 && (
                  <span style={{ position: 'absolute', top: 2, right: 2, background: '#d94040', color: '#fff', fontSize: 9, fontWeight: 700, padding: '0 5px', borderRadius: 99, animation: 'chatPulse 2s ease infinite' }}>{chatUnread}</span>
                )}
              </button>
            );
            if (item.key === '_ai_toggle') return (
              <button key="_ai_toggle" onClick={() => setAiOpen(a => !a)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: sidebarCollapsed ? '10px 14px' : '10px 12px',
                  borderRadius: 8, border: 'none', background: aiOpen ? '#102f54' : 'transparent',
                  color: aiOpen ? '#ffffff' : '#143d6b', cursor: 'pointer', fontSize: 13, fontWeight: 500,
                  width: '100%', textAlign: 'left', justifyContent: sidebarCollapsed ? 'center' : 'flex-start' }}
                onMouseEnter={e => { if (!aiOpen) { e.currentTarget.style.background = '#102f54'; e.currentTarget.style.color = '#ffffff'; } }}
                onMouseLeave={e => { if (!aiOpen) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#143d6b'; } }}
                title="Seniority AI">
                <img src="/ai-logo.jpg" alt="" style={{ width: 18, height: 18, borderRadius: '50%' }} />
                {!sidebarCollapsed && <span>Seniority AI</span>}
              </button>
            );
            if (item.key === '_workspace_toggle') return (
              <React.Fragment key="_wst">
                {!sidebarCollapsed ? <div style={{ height: 1, background: '#102f54', margin: '8px 12px' }} /> : <div style={{ height: 1, background: '#102f54', margin: '8px 4px' }} />}
                <button onClick={() => setShowWorkspace(w => !w)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: sidebarCollapsed ? '10px 14px' : '10px 12px',
                    borderRadius: 8, border: 'none', background: showWorkspace ? '#102f54' : 'transparent',
                    color: showWorkspace ? '#ffffff' : '#143d6b', cursor: 'pointer', fontSize: 13, fontWeight: 500,
                    width: '100%', textAlign: 'left', justifyContent: sidebarCollapsed ? 'center' : 'flex-start' }}
                  onMouseEnter={e => { if (!showWorkspace) { e.currentTarget.style.background = '#102f54'; e.currentTarget.style.color = '#ffffff'; } }}
                  onMouseLeave={e => { if (!showWorkspace) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#143d6b'; } }}
                  title="Google Workspace">
                  <svg width="18" height="18" viewBox="0 0 24 24"><circle cx="5" cy="5" r="2" fill={showWorkspace ? '#fff' : '#4285f4'}/><circle cx="12" cy="5" r="2" fill={showWorkspace ? '#fff' : '#ea4335'}/><circle cx="19" cy="5" r="2" fill={showWorkspace ? '#fff' : '#fbbc04'}/><circle cx="5" cy="12" r="2" fill={showWorkspace ? '#fff' : '#34a853'}/><circle cx="12" cy="12" r="2" fill={showWorkspace ? '#fff' : '#4285f4'}/><circle cx="19" cy="12" r="2" fill={showWorkspace ? '#fff' : '#ea4335'}/><circle cx="5" cy="19" r="2" fill={showWorkspace ? '#fff' : '#fbbc04'}/><circle cx="12" cy="19" r="2" fill={showWorkspace ? '#fff' : '#34a853'}/><circle cx="19" cy="19" r="2" fill={showWorkspace ? '#fff' : '#4285f4'}/></svg>
                  {!sidebarCollapsed && <span>Google Workspace</span>}
                  {!sidebarCollapsed && <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: 'auto', transform: showWorkspace ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s' }}><path d="M7 10l5 5 5-5z"/></svg>}
                </button>
              </React.Fragment>
            );
            if (item.key === '_workspace_apps') {
              if (!showWorkspace) return null;
              const apps = [
                { label: 'Calendar', url: 'https://calendar.google.com', icon: <svg width="16" height="16" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" fill="#fff" stroke="#4285f4" strokeWidth="1.5"/><rect x="3" y="4" width="18" height="5" rx="2" fill="#4285f4"/><text x="12" y="18" textAnchor="middle" fontSize="9" fontWeight="700" fill="#4285f4" fontFamily="sans-serif">{new Date().getDate()}</text></svg> },
                { label: 'Drive', url: 'https://drive.google.com', icon: <svg width="16" height="16" viewBox="0 0 24 24"><path d="M8 2l-6 10.5h6L14 2z" fill="#0f9d58"/><path d="M14 2l6 10.5h-6L8 2z" fill="#ffcd40"/><path d="M2 12.5l3 5.5h14l3-5.5z" fill="#4285f4"/></svg> },
                { label: 'Docs', url: 'https://docs.google.com', icon: <svg width="16" height="16" viewBox="0 0 24 24"><rect x="4" y="2" width="16" height="20" rx="2" fill="#4285f4"/><path d="M8 8h8M8 11h8M8 14h5" stroke="#fff" strokeWidth="1.2" strokeLinecap="round"/></svg> },
                { label: 'Sheets', url: 'https://sheets.google.com', icon: <svg width="16" height="16" viewBox="0 0 24 24"><rect x="4" y="2" width="16" height="20" rx="2" fill="#0f9d58"/><rect x="7" y="7" width="4" height="3" fill="#fff"/><rect x="13" y="7" width="4" height="3" fill="#fff"/><rect x="7" y="12" width="4" height="3" fill="#fff"/><rect x="13" y="12" width="4" height="3" fill="#fff"/></svg> },
                { label: 'Meet', url: 'https://meet.google.com', icon: <svg width="16" height="16" viewBox="0 0 24 24"><rect x="2" y="6" width="14" height="12" rx="2" fill="#00897b"/><path d="M16 10l6-4v12l-6-4z" fill="#00897b"/><rect x="5" y="9" width="3" height="2" rx="1" fill="#fff"/><rect x="10" y="9" width="3" height="2" rx="1" fill="#fff"/></svg> },
                { label: 'Chat', url: 'https://chat.google.com', icon: <svg width="16" height="16" viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" fill="#1a73e8"/><path d="M7 8h10M7 12h7" stroke="#fff" strokeWidth="1.2" strokeLinecap="round"/></svg> },
                { label: 'Voice', url: 'https://voice.google.com', icon: <svg width="16" height="16" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" fill="#0f9d58"/><path d="M15.5 17.5c-3.6 0-6.5-2.9-6.5-6.5 0-.6.4-1 1-1h1.5c.5 0 .9.4 1 .9l.4 1.7c0 .4-.1.7-.3.9l-1.1 1.1c.8 1.5 2 2.7 3.5 3.5l1.1-1.1c.2-.2.6-.3.9-.3l1.7.4c.5.1.9.5.9 1V16c0 .6-.4 1-1 1h-.6z" fill="#fff"/></svg> },
              ];
              return (
                <div key="_wsa" style={{ display: 'flex', flexDirection: 'column', gap: 1, paddingLeft: sidebarCollapsed ? 0 : 12 }}>
                  {apps.map(a => (
                    <a key={a.label} href={a.url} target="_blank" rel="noopener noreferrer"
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: sidebarCollapsed ? '8px 14px' : '8px 12px',
                        borderRadius: 8, textDecoration: 'none', background: 'transparent', color: '#143d6b',
                        cursor: 'pointer', fontSize: 12, fontWeight: 400, justifyContent: sidebarCollapsed ? 'center' : 'flex-start' }}
                      onMouseEnter={e => { e.currentTarget.style.background = '#102f54'; e.currentTarget.style.color = '#ffffff'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#143d6b'; }}
                      title={a.label}>
                      {a.icon}
                      {!sidebarCollapsed && <span>{a.label}</span>}
                    </a>
                  ))}
                </div>
              );
            }
            if (item.key === '_prompted') return (
              <a key="_prompted" href="https://seniority.thinkprompted.ai/signin" target="_blank" rel="noopener noreferrer"
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: sidebarCollapsed ? '10px 14px' : '10px 12px',
                  borderRadius: 8, textDecoration: 'none', background: 'transparent', color: '#143d6b',
                  cursor: 'pointer', fontSize: 13, fontWeight: 500, width: '100%', textAlign: 'left',
                  justifyContent: sidebarCollapsed ? 'center' : 'flex-start', marginTop: 2 }}
                onMouseEnter={e => { e.currentTarget.style.background = '#102f54'; e.currentTarget.style.color = '#ffffff'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#143d6b'; }}
                title="Prompted">
                <img src="data:image/jpeg;base64,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" alt="P" style={{width:18,height:18,borderRadius:3,objectFit:'contain'}} />
                {!sidebarCollapsed && <span>Prompted</span>}
              </a>
            );
            if (item.key === '_carelink') return (
              <a key="_carelink" href="https://seniority.xcelerait.ai/sign-in" target="_blank" rel="noopener noreferrer"
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: sidebarCollapsed ? '10px 14px' : '10px 12px',
                  borderRadius: 8, textDecoration: 'none', background: 'transparent', color: '#143d6b',
                  cursor: 'pointer', fontSize: 13, fontWeight: 500, width: '100%', textAlign: 'left',
                  justifyContent: sidebarCollapsed ? 'center' : 'flex-start', marginTop: 2 }}
                onMouseEnter={e => { e.currentTarget.style.background = '#102f54'; e.currentTarget.style.color = '#ffffff'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#143d6b'; }}
                title="CareLink">
                <svg width="18" height="18" viewBox="0 0 24 24"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z" fill="#1a73e8"/></svg>
                {!sidebarCollapsed && <span>CareLink</span>}
              </a>
            );
            if (item.key === '_updox') return (
              <a key="_updox" href="https://myupdox.com/ui/html/oauth2/practicefusion.html" target="_blank" rel="noopener noreferrer"
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: sidebarCollapsed ? '10px 14px' : '10px 12px',
                  borderRadius: 8, textDecoration: 'none', background: 'transparent', color: '#143d6b',
                  cursor: 'pointer', fontSize: 13, fontWeight: 500, width: '100%', textAlign: 'left',
                  justifyContent: sidebarCollapsed ? 'center' : 'flex-start', marginTop: 2 }}
                onMouseEnter={e => { e.currentTarget.style.background = '#102f54'; e.currentTarget.style.color = '#ffffff'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#143d6b'; }}
                title="Updox">
                <svg width="18" height="18" viewBox="0 0 24 24"><rect width="24" height="24" rx="4" fill="#1a3a5c"/><text x="12" y="16.5" textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff" fontFamily="sans-serif">u</text></svg>
                {!sidebarCollapsed && <span>Updox</span>}
              </a>
            );
            if (item.key === '_practice_fusion') return (
              <a key="_pf" href="https://www.practicefusion.com/login" target="_blank" rel="noopener noreferrer"
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: sidebarCollapsed ? '10px 14px' : '10px 12px',
                  borderRadius: 8, textDecoration: 'none', background: 'transparent', color: '#143d6b',
                  cursor: 'pointer', fontSize: 13, fontWeight: 500, width: '100%', textAlign: 'left',
                  justifyContent: sidebarCollapsed ? 'center' : 'flex-start', marginTop: 2 }}
                onMouseEnter={e => { e.currentTarget.style.background = '#102f54'; e.currentTarget.style.color = '#ffffff'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#143d6b'; }}
                title="Practice Fusion">
                <svg width="18" height="18" viewBox="0 0 24 24"><path d="M12 2L2 8l0 0 10 6 10-6z" fill="#5bb7db"/><path d="M2 8v8l10 6V16z" fill="#2b6a94"/><path d="M22 8v8l-10 6V16z" fill="#3a8fc5"/></svg>
                {!sidebarCollapsed && <span>Practice Fusion</span>}
              </a>
            );
            if (item.url) return (
              <a key={item.key} href={item.url} target="_blank" rel="noopener noreferrer"
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: sidebarCollapsed ? '10px 14px' : '10px 12px',
                  borderRadius: 8, border: 'none', textDecoration: 'none',
                  background: 'transparent',
                  color: '#143d6b',
                  cursor: 'pointer', fontSize: 13, fontWeight: 500, width: '100%', textAlign: 'left',
                  justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = '#102f54'; e.currentTarget.style.color = '#ffffff'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#143d6b'; }}
                title={item.label}>
                {item.gIcon || <Icon name={item.icon} size={18} />}
                {!sidebarCollapsed && <span>{item.label}</span>}
              </a>
            );
            return (
            <button key={item.key} onClick={() => {  setScreen(item.key); setSelectedTicketId(null); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: sidebarCollapsed ? '10px 14px' : '10px 12px',
                borderRadius: 8, border: 'none',
                background: (screen === item.key || (screen === 'ticketDetail' && item.key === 'regionQueue')) ? '#102f54' : 'transparent',
                color: screen === item.key ? '#ffffff' : '#143d6b',
                cursor: 'pointer', fontSize: 13, fontWeight: 500, width: '100%', textAlign: 'left',
                justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
              }} title={item.label}>
              {item.gIcon || <Icon name={item.icon} size={18} />}
              {!sidebarCollapsed && <span>{item.label}</span>}
              {!sidebarCollapsed && item.badge > 0 && (
                <span style={{ marginLeft: 'auto', background: '#d94040', color: '#fff', fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 99 }}>{item.badge}</span>
              )}
            </button>
            );
          })}
        </nav>

        <div style={{ padding: sidebarCollapsed ? '12px 8px' : '12px 16px', borderTop: '1px solid #102f54', background: '#143d6b' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: sidebarCollapsed ? 'center' : 'flex-start', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: sidebarCollapsed ? 'center' : 'flex-start' }}>
              <Avatar user={currentUser} size={28} />
              {!sidebarCollapsed && (
                <div style={{ minWidth: 0, flex: 1 }}>
                  {!sidebarCollapsed && <GmailConnectButton showToast={showToast} currentUser={currentUser} />}
                <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#ffffff' }}>{currentUser.name}</div>
                  <div style={{ fontSize: 10, color: '#ffffff', textTransform: 'capitalize' }}>{currentUser.role}</div>
                </div>
              )}
            </div>
            {!sidebarCollapsed && currentUser.role === 'coordinator' && (
              <button onClick={toggleWorkStatus}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: workStatus === 'active' ? '#0d3b1e' : '#3b1a0d', border: '1px solid', borderColor: workStatus === 'active' ? '#2e7d32' : '#d94040', borderRadius: 6, color: workStatus === 'active' ? '#4ade80' : '#f87171', cursor: 'pointer', fontSize: 11, fontWeight: 600, width: '100%', justifyContent: 'center' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: workStatus === 'active' ? '#4ade80' : '#f87171' }} />
                {workStatus === 'active' ? 'Active' : 'Inactive'}
              </button>
            )}
            {!sidebarCollapsed && (
              <button onClick={handleLogout}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: '#102f54', border: '1px solid #143d6b', borderRadius: 6, color: '#a8c8e8', cursor: 'pointer', fontSize: 11, fontWeight: 500, width: '100%', justifyContent: 'center' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#1a5e9a'; e.currentTarget.style.color = '#ffffff'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#102f54'; e.currentTarget.style.color = '#a8c8e8'; }}>
                Log out
              </button>
            )}
            {sidebarCollapsed && (
              <button onClick={handleLogout} style={{ background: 'none', border: 'none', color: '#ffffff', cursor: 'pointer', padding: 4 }} title="Log out">
                <Icon name="x" size={14} />
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Main content + Chat panel */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
        {screen === 'regionQueue' && (
          <QueueScreen title="Region Queue" mode="region" currentUser={currentUser} regions={regions} onOpenTicket={openTicket} showToast={showToast} refreshCounts={refreshCounts} />
        )}
        {screen === 'personalQueue' && (
          <QueueScreen title="My Queue" mode="personal" currentUser={currentUser} regions={regions} onOpenTicket={openTicket} showToast={showToast} refreshCounts={refreshCounts} />
        )}
        {screen === 'ticketDetail' && selectedTicketId && (
          <TicketDetail
            ticketId={selectedTicketId}
            currentUser={currentUser}
            isSupervisor={isSupervisor}
            regions={regions}
            allTags={allTags}
            closeReasons={closeReasons}
            allUsers={allUsers}
            onBack={goBack}
            showToast={showToast}
          />
        )}
        {screen === 'dashboard' && isSupervisor && (
          <Dashboard currentUser={currentUser} allUsers={allUsers} onOpenTicket={openTicket} showToast={showToast} />
        )}
        {screen === 'personalEmail' && (
          <PersonalInbox currentUser={currentUser} showToast={showToast} refreshCounts={refreshCounts} />
        )}
        
        
        {screen === 'admin' && (currentUser.role === 'admin' || currentUser.role === 'supervisor') && (
          <AdminPanel currentUser={currentUser} showToast={showToast} regions={regions} />
        )}
        {screen === 'auditLog' && isSupervisor && (
          <AuditLog showToast={showToast} />
        )}

        {/* Compose Modal */}
        {showCompose && (
          <ComposeModal
            currentUser={currentUser}
            regions={regions}
            allTags={allTags}
            onClose={() => setShowCompose(false)}
            onCreated={(ticketId) => { setShowCompose(false); openTicket(ticketId); }}
            showToast={showToast}
          />
        )}

        {/* Toast */}
        {toast && (
          <div style={{ position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: '#1e293b', color: '#1e3a4f', padding: '10px 24px', borderRadius: 10, fontSize: 13, fontWeight: 500, boxShadow: '0 8px 32px rgba(0,0,0,0.4)', border: '1px solid #c0d0e4', zIndex: 999, animation: 'fadeIn 0.2s ease' }}>
            <Icon name="check" size={14} /> {toast}
          </div>
        )}
      </main>

      {/* Chat Slide Panel */}
      {chatOpen && (
        <div style={{ width: chatWidth, flexShrink: 0, display: 'flex', background: '#fff', overflow: 'hidden', position: 'relative' }}>
          <div onMouseDown={handleResize(setChatWidth, 280, 700)}
            style={{ width: 4, cursor: 'col-resize', background: 'transparent', flexShrink: 0, position: 'relative', zIndex: 2 }}
            onMouseEnter={e => e.currentTarget.style.background = '#c0d0e4'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderLeft: '1px solid #dde8f2', overflow: 'hidden' }}>
            <ChatScreen currentUser={currentUser} allUsers={allUsers} showToast={showToast} isPanel={true} onClose={() => setChatOpen(false)} onRead={() => api.chatUnread().then(d => setChatUnread(d.unread || 0)).catch(() => {})} />
          </div>
        </div>
      )}

      {/* AI Assistant Panel */}
      {aiOpen && (
        <div style={{ width: aiWidth, flexShrink: 0, display: 'flex', background: '#fff', overflow: 'hidden', position: 'relative' }}>
          <div onMouseDown={handleResize(setAiWidth, 280, 700)}
            style={{ width: 4, cursor: 'col-resize', background: 'transparent', flexShrink: 0, position: 'relative', zIndex: 2 }}
            onMouseEnter={e => e.currentTarget.style.background = '#c0d0e4'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderLeft: '1px solid #dde8f2', overflow: 'hidden' }}>
            <AiPanel currentUser={currentUser} onClose={() => setAiOpen(false)} showToast={showToast} activeTicketId={selectedTicketId} />
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
