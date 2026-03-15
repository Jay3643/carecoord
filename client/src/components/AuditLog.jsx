import React, { useState, useEffect } from 'react';
import { api } from '../api';
import { fmt } from '../utils';
import Icon from './Icons';
import { Avatar } from './ui';

export default function AuditLog({ showToast }) {
  const [entries, setEntries] = useState([]);
  const [actionTypes, setActionTypes] = useState([]);
  const [filterType, setFilterType] = useState('all');
  const [loading, setLoading] = useState(true);

  const fetchLog = async () => {
    setLoading(true);
    try {
      const data = await api.getAuditLog(filterType, 200);
      setEntries(data.entries);
      setActionTypes(data.actionTypes);
    } catch (e) {
      showToast('Error loading audit log');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchLog(); }, [filterType]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '16px 24px', borderBottom: '1px solid #dde8f2', background: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, letterSpacing: -0.3 }}>Audit Log</h1>
        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          style={{ background: '#dde8f2', border: '1px solid #c0d0e4', borderRadius: 8, padding: '6px 12px', color: '#1e3a4f', fontSize: 12 }}>
          <option value="all">All Events</option>
          {actionTypes.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
        </select>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '8px 24px' }}>
        {loading && <div style={{ padding: 20, color: '#8a9fb0', textAlign: 'center' }}>Loading...</div>}
        {!loading && entries.length === 0 && <div style={{ padding: 20, color: '#8a9fb0', textAlign: 'center' }}>No audit entries found</div>}
        {entries.map(entry => (
          <div key={entry.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid #dde8f260' }}>
            <div style={{ width: 140, fontSize: 10, color: '#6b8299', fontFamily: "'IBM Plex Mono', monospace", flexShrink: 0, lineHeight: 1.4 }}>
              {entry.ts ? new Date(typeof entry.ts === 'number' ? entry.ts : Number(entry.ts)).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : ''}
              <br />
              {entry.ts ? new Date(typeof entry.ts === 'number' ? entry.ts : Number(entry.ts)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : ''}
            </div>
            {entry.actor_user_id ? (
              <Avatar user={{ id: entry.actor_user_id, name: entry.actor_name, avatar: entry.actor_avatar }} size={22} />
            ) : (
              <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#c0d0e4', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="settings" size={10} />
              </div>
            )}
            <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: '#1a5e9a', background: '#1a5e9a18', padding: '2px 8px', borderRadius: 4, flexShrink: 0 }}>
              {entry.action_type.replace(/_/g, ' ')}
            </span>
            <span style={{ fontSize: 12, color: '#5a7a8a', flex: 1 }}>
              {entry.actor_name && <strong style={{ color: '#1e3a4f' }}>{entry.actor_name}</strong>}
              {entry.actor_name && ' — '}
              {entry.detail}
            </span>
            <span style={{ fontSize: 10, fontFamily: "'IBM Plex Mono', monospace", color: '#8a9fb0', flexShrink: 0 }}>
              {entry.entity_type}:{entry.entity_id}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
