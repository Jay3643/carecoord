import React, { useState } from 'react';
import { api } from '../api';

const pulseStyle = document.createElement('style');
pulseStyle.textContent = '@keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.4 } }';
if (!document.querySelector('[data-pulse]')) { pulseStyle.setAttribute('data-pulse', ''); document.head.appendChild(pulseStyle); }

export function GmailConnectButton({ showToast, currentUser }) {
  const [connecting, setConnecting] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [syncDate, setSyncDate] = useState('2026-03-01');
  const [connected, setConnected] = useState(null);
  const [connectedEmail, setConnectedEmail] = useState('');
  const [syncing, setSyncing] = useState(false);

  const isSupervisor = currentUser?.role === 'supervisor' || currentUser?.role === 'admin';

  React.useEffect(() => {
    api.gmailStatus().then(s => {
      setConnected(s.connected);
      setConnectedEmail(s.email || '');
    }).catch(() => {});
  }, []);

  const startConnect = () => {
    if (!isSupervisor) {
      showToast?.('Only supervisors can connect Google Workspace');
      return;
    }
    setShowSetup(true);
  };

  const doConnect = async () => {
    setConnecting(true);
    try {
      // Save the sync start date first
      await fetch('/api/gmail/set-sync-date', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ syncDate: syncDate.replace(/-/g, '/') })
      });
      
      // Then start OAuth
      const data = await api.gmailAuth();
      const w = window.open(data.authUrl, 'gmail-auth', 'width=500,height=600');
      const check = setInterval(() => {
        if (w?.closed) {
          clearInterval(check);
          setConnecting(false);
          setShowSetup(false);
          api.gmailStatus().then(s => {
            setConnected(s.connected);
            setConnectedEmail(s.email || '');
            if (s.connected) {
              showToast?.('Google Workspace connected! Syncing emails from ' + syncDate + '...');
              setSyncing(true);
              fetch('/api/gmail/sync', { method: 'POST', credentials: 'include' })
                .then(r => r.json())
                .then(d => { showToast?.(d.synced + ' emails synced to queue'); })
                .catch(() => {})
                .finally(() => setSyncing(false));
            }
          });
        }
      }, 500);
    } catch (e) {
      showToast?.(e.message);
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    if (!isSupervisor) { showToast?.('Only supervisors can disconnect'); return; }
    try { await api.gmailDisconnect(); setConnected(false); setConnectedEmail(''); showToast?.('Disconnected'); }
    catch (e) { showToast?.(e.message); }
  };

  const updateSyncDate = async () => {
    if (!isSupervisor) { showToast?.('Only supervisors can change sync date'); return; }
    setSyncing(true);
    try {
      await fetch('/api/gmail/set-sync-date', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ syncDate: syncDate.replace(/-/g, '/'), resetSync: true })
      });
      showToast?.('Sync started from ' + syncDate);
      const res = await fetch('/api/gmail/sync', { method: 'POST', credentials: 'include' });
      const data = await res.json();
      showToast?.(data.synced + ' emails synced to queue');
    } catch (e) { showToast?.(e.message); }
    finally { setSyncing(false); }
  };

  if (connected === null) return null;

  if (connected) {
    return (
      <div style={{ fontSize: 10, marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#a8c8e8' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ade80', flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{connectedEmail}</span>
          {syncing && <span style={{ fontSize: 9, color: '#4ade80', animation: 'pulse 1.5s infinite' }}>syncing...</span>}
        </div>
        
        {showSetup && isSupervisor && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}
            onClick={() => setShowSetup(false)}>
            <div onClick={e => e.stopPropagation()}
              style={{ background: '#fff', borderRadius: 12, padding: 24, width: 380, boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, color: '#1e3a4f', margin: '0 0 16px' }}>Change Sync Start Date</h3>
              <p style={{ fontSize: 13, color: '#5f6368', margin: '0 0 12px' }}>
                Emails after this date will be synced to the Regional Queue. Emails before this date stay in the personal inbox only.
              </p>
              <input type="date" value={syncDate} onChange={e => setSyncDate(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', border: '1px solid #dadce0', borderRadius: 8, fontSize: 14, marginBottom: 16, boxSizing: 'border-box' }} />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => setShowSetup(false)}
                  style={{ padding: '8px 20px', background: '#f0f4f9', border: '1px solid #dadce0', borderRadius: 8, cursor: 'pointer', fontSize: 13, color: '#5f6368' }}>
                  Cancel
                </button>
                <button onClick={updateSyncDate} disabled={syncing}
                  style={{ padding: '8px 20px', background: syncing ? '#94a3b8' : '#1a73e8', border: 'none', borderRadius: 8, cursor: syncing ? 'default' : 'pointer', fontSize: 13, color: '#fff', fontWeight: 600, opacity: syncing ? 0.7 : 1 }}>
                  {syncing ? 'Syncing in progress...' : 'Update & Re-sync'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <button onClick={startConnect} disabled={connecting || !isSupervisor}
        style={{ fontSize: 10, padding: '3px 8px', background: isSupervisor ? '#102f54' : '#333', border: '1px solid #2080c0', borderRadius: 4, color: isSupervisor ? '#a8c8e8' : '#888', cursor: isSupervisor ? 'pointer' : 'default', marginBottom: 4 }}>
        {isSupervisor ? 'Connect Workspace' : 'Supervisor Required'}
      </button>
      {showSetup && isSupervisor && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}
          onClick={() => setShowSetup(false)}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 12, padding: 24, width: 400, boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
            <h3 style={{ fontSize: 18, fontWeight: 600, color: '#1e3a4f', margin: '0 0 8px' }}>Connect Google Workspace</h3>
            <p style={{ fontSize: 13, color: '#5f6368', margin: '0 0 20px', lineHeight: 1.5 }}>
              Choose a start date for email syncing. All emails received <strong>after</strong> this date will automatically route to the Regional Queue as tickets. Emails before this date will remain in the personal inbox.
            </p>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#1e3a4f', display: 'block', marginBottom: 6 }}>Sync emails starting from:</label>
            <input type="date" value={syncDate} onChange={e => setSyncDate(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', border: '1px solid #dadce0', borderRadius: 8, fontSize: 14, marginBottom: 20, boxSizing: 'border-box' }} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowSetup(false)}
                style={{ padding: '10px 20px', background: '#f0f4f9', border: '1px solid #dadce0', borderRadius: 8, cursor: 'pointer', fontSize: 13, color: '#5f6368' }}>
                Cancel
              </button>
              <button onClick={doConnect} disabled={connecting}
                style={{ padding: '10px 20px', background: '#1a73e8', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, color: '#fff', fontWeight: 600, opacity: connecting ? 0.7 : 1 }}>
                {connecting ? 'Connecting...' : 'Connect & Sync'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
