import React, { useState, useEffect } from 'react';
import { api } from '../api';
import Icon from './Icons';
import { Avatar } from './ui';

export default function LoginScreen({ onLogin }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Fetch users list (unauthenticated endpoint needed - we'll use a workaround)
    // For the demo, we'll try the /api/ref/users endpoint. If that fails (not authed), we use hardcoded list.
    fetch('/api/ref/users', { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => setUsers(data.users))
      .catch(() => {
        // Fallback: hardcoded user list for login screen
        setUsers([
          { id: 'u1', name: 'Sarah Mitchell', email: 'smitchell@carecoord.org', role: 'coordinator', avatar: 'SM' },
          { id: 'u2', name: 'James Rivera', email: 'jrivera@carecoord.org', role: 'coordinator', avatar: 'JR' },
          { id: 'u3', name: 'Angela Chen', email: 'achen@carecoord.org', role: 'coordinator', avatar: 'AC' },
          { id: 'u4', name: 'Marcus Brown', email: 'mbrown@carecoord.org', role: 'coordinator', avatar: 'MB' },
          { id: 'u5', name: 'Lisa Nowak', email: 'lnowak@carecoord.org', role: 'coordinator', avatar: 'LN' },
          { id: 'u6', name: 'Dr. Patricia Hayes', email: 'phayes@carecoord.org', role: 'supervisor', avatar: 'PH' },
          { id: 'u7', name: 'Tom Adkins', email: 'tadkins@carecoord.org', role: 'admin', avatar: 'TA' },
        ]);
      });
  }, []);

  const handleLogin = async (userId) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.login(userId);
      onLogin(data.user);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const roleColor = (role) => role === 'supervisor' ? '#c9963b' : role === 'admin' ? '#d94040' : '#1a5e9a';

  return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #f4f7f8, #e8f0f8)' }}>
      <div style={{ width: 420, padding: 40, background: '#f0f4f9', borderRadius: 16, border: '1px solid #dde8f2' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'linear-gradient(135deg, #1a5e9a, #1a5e9a)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="shield" size={20} />
          </div>
          <div>
            <div style={{ color: '#1e3a4f', fontWeight: 700, fontSize: 18, letterSpacing: -0.3 }}>CareCoord</div>
            <div style={{ color: '#6b8299', fontSize: 12 }}>Regional Care Coordination Overlay</div>
          </div>
        </div>

        {error && <div style={{ padding: '8px 12px', background: '#d9404020', border: '1px solid #d94040', borderRadius: 8, color: '#d94040', fontSize: 12, marginBottom: 12 }}>{error}</div>}

        <div style={{ color: '#5a7a8a', fontSize: 13, marginBottom: 20 }}>Select a user to sign in as (demo mode):</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {users.map(user => (
            <button key={user.id} onClick={() => handleLogin(user.id)} disabled={loading}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: '#dde8f2', border: '1px solid #c0d0e4', borderRadius: 10, cursor: loading ? 'wait' : 'pointer', color: '#1e3a4f', textAlign: 'left', transition: 'all 0.15s', opacity: loading ? 0.6 : 1 }}
              onMouseEnter={e => { e.currentTarget.style.background = '#c8d8ec'; e.currentTarget.style.borderColor = '#1a5e9a'; }}
              onMouseLeave={e => { e.currentTarget.style.background = '#dde8f2'; e.currentTarget.style.borderColor = '#c0d0e4'; }}>
              <Avatar user={user} size={36} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{user.name}</div>
                <div style={{ fontSize: 11, color: '#6b8299' }}>{user.email}</div>
              </div>
              <span style={{ fontSize: 10, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5, color: roleColor(user.role), background: roleColor(user.role) + '18', padding: '2px 8px', borderRadius: 99 }}>{user.role}</span>
            </button>
          ))}
        </div>

        <div style={{ marginTop: 24, padding: '12px 16px', background: '#f4f7f8', borderRadius: 8, border: '1px solid #dde8f2' }}>
          <div style={{ fontSize: 11, color: '#6b8299', lineHeight: 1.5 }}>
            <strong style={{ color: '#5a7a8a' }}>HIPAA Notice:</strong> In production, authentication uses SSO (Google Workspace / enterprise IdP) with MFA. This demo uses direct user selection.
          </div>
        </div>
      </div>
    </div>
  );
}
