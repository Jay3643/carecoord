import React from 'react';
import { fmt } from '../utils';

const STATUS_MAP = {
  OPEN: { bg: '#dbeafe', color: '#1e40af', label: 'Open' },
  WAITING_ON_EXTERNAL: { bg: '#fef3c7', color: '#8a6d2e', label: 'Waiting' },
  CLOSED: { bg: '#d1d5db', color: '#374151', label: 'Closed' },
};

export function StatusBadge({ status }) {
  const s = STATUS_MAP[status] || STATUS_MAP.OPEN;
  return (
    <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 99, fontSize: 11, fontWeight: 600, letterSpacing: 0.3, background: s.bg, color: s.color, textTransform: 'uppercase' }}>
      {s.label}
    </span>
  );
}

export function TagPill({ tag, onRemove }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 99, fontSize: onRemove ? 11 : 10, fontWeight: onRemove ? 500 : 600, background: tag.color + '18', color: tag.color, border: `1px solid ${tag.color}40`, marginRight: 4 }}>
      {tag.name}
      {onRemove && <button onClick={onRemove} style={{ background: 'none', border: 'none', color: tag.color, cursor: 'pointer', padding: 0, fontSize: 14, lineHeight: 1 }}>×</button>}
    </span>
  );
}

const AVATAR_COLORS = ['#1a5e9a', '#1a5e9a', '#c96a1b', '#d97706', '#dc2626', '#7c3aed', '#1a5e9a'];

export function Avatar({ user, size = 32 }) {
  const idx = user ? (user.id.charCodeAt(1) * 7) % AVATAR_COLORS.length : 0;
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: user ? AVATAR_COLORS[idx] : '#5a7a8a', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: size * 0.38, fontWeight: 700, letterSpacing: 0.5, flexShrink: 0 }}>
      {user ? (user.avatar || fmt.initials(user.name)) : '?'}
    </div>
  );
}
