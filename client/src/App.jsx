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

export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [screen, setScreen] = useState('login');
  const [selectedTicketId, setSelectedTicketId] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [toast, setToast] = useState(null);
  const [showCompose, setShowCompose] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

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
    api.me()
      .then(data => {
        setCurrentUser(data.user);
        setScreen('regionQueue');
      })
      .catch(() => {})
      .finally(() => setAuthChecked(true));
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
        setCloseReasons(c.closeReasons);
      }).catch(e => showToast('Error loading reference data'));
    }
  }, [currentUser, showToast]);

  const handleLogin = (user) => {
    setCurrentUser(user);
    setScreen('regionQueue');
  };

  const handleLogout = async () => {
    try { await api.logout(); } catch (e) {}
    setCurrentUser(null);
    setScreen('login');
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

  // Unassigned count for sidebar badge
  const [unassignedCount, setUnassignedCount] = useState(0);
  const [personalCount, setPersonalCount] = useState(0);

  useEffect(() => {
    if (!currentUser) return;
    const fetchCounts = () => {
      api.getTickets({ queue: 'region', status: 'unassigned' })
        .then(d => setUnassignedCount(d.tickets.length))
        .catch(() => {});
      api.getTickets({ queue: 'personal', status: 'all' })
        .then(d => setPersonalCount(d.tickets.filter(t => t.status !== 'CLOSED').length))
        .catch(() => {});
    };
    fetchCounts();
    const interval = setInterval(fetchCounts, 15000);
    return () => clearInterval(interval);
  }, [currentUser]);

  if (!authChecked) {
    return <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f4f7f8', color: '#8a9fb0' }}>Loading...</div>;
  }

  if (!currentUser) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#f4f7f8', color: '#1e3a4f', fontFamily: "'IBM Plex Sans', -apple-system, sans-serif", overflow: 'hidden' }}>
      {/* Sidebar */}
      <aside style={{ width: sidebarCollapsed ? 64 : 240, background: '#f0f4f9', borderRight: '1px solid #dde8f2', display: 'flex', flexDirection: 'column', transition: 'width 0.2s ease', overflow: 'hidden', flexShrink: 0 }}>
        <div style={{ padding: sidebarCollapsed ? '16px 12px' : '16px 20px', borderBottom: '1px solid #dde8f2', display: 'flex', alignItems: 'center', gap: 10, minHeight: 64 }}>
          {!sidebarCollapsed && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
              <div style={{ width: 28, height: 28, borderRadius: 6, background: 'linear-gradient(135deg, #1a5e9a, #2878b8)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="shield" size={14} />
              </div>
              <span style={{ fontWeight: 700, fontSize: 14, letterSpacing: -0.3, whiteSpace: 'nowrap', color: '#ffffff' }}>Seniority</span>
            </div>
          )}
          <button onClick={() => setSidebarCollapsed(!sidebarCollapsed)} style={{ background: 'none', border: 'none', color: '#a8c8e8', cursor: 'pointer', padding: 4 }}>
            <Icon name={sidebarCollapsed ? 'chevronRight' : 'arrowLeft'} size={16} />
          </button>
        </div>

        <div style={{ padding: sidebarCollapsed ? '12px 8px' : '12px 12px' }}>
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
        </div>

        <nav style={{ flex: 1, padding: '4px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {[
            { key: 'regionQueue', icon: 'inbox', label: 'Region Queue', badge: unassignedCount, badgeColor: '#d94040' },
            { key: 'personalQueue', icon: 'user', label: 'My Queue', badge: personalCount, badgeColor: '#1a5e9a' },
            ...(isSupervisor ? [{ key: 'dashboard', icon: 'barChart', label: 'Dashboard' }] : []),
            ...(isSupervisor ? [{ key: 'auditLog', icon: 'log', label: 'Audit Log' }] : []),
            ...(currentUser.role === 'admin' ? [{ key: 'admin', icon: 'settings', label: 'Admin' }] : []),
          ].map(item => (
            <button key={item.key} onClick={() => { setScreen(item.key); setSelectedTicketId(null); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: sidebarCollapsed ? '10px 14px' : '10px 12px',
                borderRadius: 8, border: 'none',
                background: (screen === item.key || (screen === 'ticketDetail' && item.key === 'regionQueue')) ? '#102f54' : 'transparent',
                color: screen === item.key ? '#ffffff' : '#a8c8e8',
                cursor: 'pointer', fontSize: 13, fontWeight: 500, width: '100%', textAlign: 'left', color: 'inherit',
                justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
              }} title={item.label}>
              <Icon name={item.icon} size={18} />
              {!sidebarCollapsed && <span>{item.label}</span>}
              {!sidebarCollapsed && item.badge > 0 && (
                <span style={{ marginLeft: 'auto', background: '#d94040', color: '#fff', fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 99 }}>{item.badge}</span>
              )}
            </button>
          ))}
        </nav>

        <div style={{ padding: sidebarCollapsed ? '12px 8px' : '12px 16px', borderTop: '1px solid #dde8f2' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: sidebarCollapsed ? 'center' : 'flex-start', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: sidebarCollapsed ? 'center' : 'flex-start' }}>
              <Avatar user={currentUser} size={28} />
              {!sidebarCollapsed && (
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#ffffff' }}>{currentUser.name}</div>
                  <div style={{ fontSize: 10, color: '#a8c8e8', textTransform: 'capitalize' }}>{currentUser.role}</div>
                </div>
              )}
            </div>
            {!sidebarCollapsed && (
              <button onClick={handleLogout}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: '#102f54', border: '1px solid #143d6b', borderRadius: 6, color: '#a8c8e8', cursor: 'pointer', fontSize: 11, fontWeight: 500, width: '100%', justifyContent: 'center' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#1a5e9a'; e.currentTarget.style.color = '#ffffff'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#102f54'; e.currentTarget.style.color = '#a8c8e8'; }}>
                Log out
              </button>
            )}
            {sidebarCollapsed && (
              <button onClick={handleLogout} style={{ background: 'none', border: 'none', color: '#6b8299', cursor: 'pointer', padding: 4 }} title="Log out">
                <Icon name="x" size={14} />
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
        {screen === 'regionQueue' && (
          <QueueScreen title="Region Queue" mode="region" currentUser={currentUser} regions={regions} onOpenTicket={openTicket} />
        )}
        {screen === 'personalQueue' && (
          <QueueScreen title="My Queue" mode="personal" currentUser={currentUser} regions={regions} onOpenTicket={openTicket} />
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
        {screen === 'admin' && currentUser.role === 'admin' && (
          <AdminPanel currentUser={currentUser} showToast={showToast} />
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
    </div>
  );
}
