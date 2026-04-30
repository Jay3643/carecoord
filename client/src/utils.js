export const fmt = {
  time(ts) {
    if (!ts) return '';
    const d = new Date(typeof ts === 'number' ? ts : Date.parse(ts));
    if (isNaN(d)) return String(ts);
    const now = new Date();
    const diff = now - d;
    // Show relative time with actual time for context
    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago (' + time + ')';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago (' + time + ')';
    if (diff < 604800000) return Math.floor(diff / 86400000) + 'd ago';
    return d.toLocaleDateString();
  },
  full(ts) {
    if (!ts) return '';
    const d = new Date(typeof ts === 'number' ? ts : Date.parse(ts));
    if (isNaN(d)) return String(ts);
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  },
  initials(name) {
    if (!name) return '?';
    return name.split(' ').map(w => w[0]).join('').toUpperCase().substring(0, 2);
  },
  date(ts) {
    if (!ts) return '';
    return new Date(typeof ts === 'number' ? ts : Date.parse(ts)).toLocaleDateString();
  },
  stamp(ts) {
    if (!ts) return '';
    const d = new Date(typeof ts === 'number' ? ts : Date.parse(ts));
    if (isNaN(d)) return String(ts);
    const date = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const now = new Date();
    const diff = now - d;
    let ago = '';
    if (diff < 60000) ago = 'just now';
    else if (diff < 3600000) ago = Math.floor(diff / 60000) + 'm ago';
    else if (diff < 86400000) ago = Math.floor(diff / 3600000) + 'h ago';
    else if (diff < 604800000) ago = Math.floor(diff / 86400000) + 'd ago';
    return date + ' ' + time + (ago ? ' (' + ago + ')' : '');
  },
  age(ts) {
    if (!ts) return '';
    const d = new Date(typeof ts === 'number' ? ts : Date.parse(ts));
    if (isNaN(d)) return '';
    const diff = Date.now() - d;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' min';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ' + Math.floor((diff % 3600000) / 60000) + 'm';
    return Math.floor(diff / 86400000) + 'd ' + Math.floor((diff % 86400000) / 3600000) + 'h';
  },
};
