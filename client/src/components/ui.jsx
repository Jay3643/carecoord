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

const AVATAR_COLORS = ['#1a5e9a', '#0891b2', '#c96a1b', '#059669', '#dc2626', '#7c3aed', '#d946ef', '#e11d48', '#ca8a04', '#4f46e5', '#0d9488', '#b91c1c'];

export function Avatar({ user, size = 32 }) {
  const idx = user && user.id ? (user.id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) * 7) % AVATAR_COLORS.length : 0;
  const photoUrl = user?.photoUrl || user?.profile_photo_url;
  const [imgError, setImgError] = React.useState(false);
  if (photoUrl && !imgError) {
    return (
      <img src={photoUrl} alt={user.name || ''} referrerPolicy="no-referrer"
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
        onError={() => setImgError(true)} />
    );
  }
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: user ? AVATAR_COLORS[idx] : '#5a7a8a', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: size * 0.38, fontWeight: 700, letterSpacing: 0.5, flexShrink: 0 }}>
      {user ? (user.avatar || fmt.initials(user.name)) : '?'}
    </div>
  );
}
