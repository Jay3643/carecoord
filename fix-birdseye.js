const fs = require('fs');

// 1. Add server endpoint for bird's eye data
let tickets = fs.readFileSync('server/routes/tickets.js', 'utf8');
if (!tickets.includes('birds-eye')) {
  tickets = tickets.replace(
    'module.exports = router;',
    `// ── Bird's Eye Dashboard ──
router.get('/birds-eye', requireAuth, (req, res) => {
  if (req.user.role !== 'supervisor' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Supervisor access required' });
  }
  const db = getDb();

  // All open tickets with details
  const allTickets = db.prepare(\`
    SELECT t.*, 
      (SELECT body_text FROM messages WHERE ticket_id = t.id ORDER BY created_at DESC LIMIT 1) as last_message
    FROM tickets t WHERE t.status != 'CLOSED'
    ORDER BY t.last_activity_at DESC
  \`).all();

  const now = Date.now();
  const tickets = allTickets.map(t => {
    const age = now - (t.created_at || now);
    const lastActivity = now - (t.last_activity_at || now);
    const assignee = t.assignee_user_id ? db.prepare('SELECT id,name,email,role FROM users WHERE id=?').get(t.assignee_user_id) : null;
    const region = t.region_id ? db.prepare('SELECT id,name FROM regions WHERE id=?').get(t.region_id) : null;
    return {
      id: toStr(t.id), subject: toStr(t.subject), status: toStr(t.status),
      fromEmail: toStr(t.from_email), createdAt: t.created_at, lastActivityAt: t.last_activity_at,
      hasUnread: !!t.has_unread, ageMs: age, lastActivityMs: lastActivity,
      aging: lastActivity > 86400000 ? '24h+' : lastActivity > 14400000 ? '4h+' : lastActivity > 3600000 ? '1h+' : 'fresh',
      assignee: assignee ? { id: toStr(assignee.id), name: toStr(assignee.name) } : null,
      region: region ? { id: toStr(region.id), name: toStr(region.name) } : null,
    };
  });

  // Coordinator stats
  const coordinators = db.prepare("SELECT id,name,email,role FROM users WHERE role='coordinator' AND is_active=1").all();
  const coordStats = coordinators.map(c => {
    const open = db.prepare("SELECT COUNT(*) as n FROM tickets WHERE assignee_user_id=? AND status!='CLOSED'").get(c.id);
    const lastActive = db.prepare("SELECT MAX(last_activity_at) as t FROM tickets WHERE assignee_user_id=?").get(c.id);
    // Check if user has an active session (online indicator)
    const session = db.prepare("SELECT 1 FROM sessions WHERE user_id=? AND expires > ?").get(c.id, now);
    return {
      id: toStr(c.id), name: toStr(c.name), email: toStr(c.email),
      openTickets: open?.n || 0,
      lastActive: lastActive?.t || 0,
      isOnline: !!session,
    };
  });

  // Region stats
  const regions = db.prepare("SELECT id,name FROM regions WHERE is_active=1").all();
  const regionStats = regions.map(r => {
    const total = db.prepare("SELECT COUNT(*) as n FROM tickets WHERE region_id=? AND status!='CLOSED'").get(r.id);
    const unassigned = db.prepare("SELECT COUNT(*) as n FROM tickets WHERE region_id=? AND assignee_user_id IS NULL AND status!='CLOSED'").get(r.id);
    return {
      id: toStr(r.id), name: toStr(r.name),
      totalOpen: total?.n || 0, unassigned: unassigned?.n || 0,
    };
  });

  res.json({ tickets, coordinators: coordStats, regions: regionStats });
});

module.exports = router;`
  );
  fs.writeFileSync('server/routes/tickets.js', tickets, 'utf8');
  console.log('  ✓ tickets.js — birds-eye endpoint');
}

// 2. Add API method
let api = fs.readFileSync('client/src/api.js', 'utf8');
if (!api.includes('getBirdsEye')) {
  api = api.replace(
    'getDashboardSummary:',
    "getBirdsEye: () => request('/tickets/birds-eye'),\n  getDashboardSummary:"
  );
  fs.writeFileSync('client/src/api.js', api, 'utf8');
  console.log('  ✓ api.js — getBirdsEye method');
}

// 3. Rewrite Dashboard.jsx with tabs: Overview + Bird's Eye
let dash = fs.readFileSync('client/src/components/Dashboard.jsx', 'utf8');

// Add BirdsEye component before the export
dash = dash.replace(
  'export default function Dashboard',
  `function BirdsEyeView({ currentUser, allUsers, onOpenTicket, showToast }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filterRegion, setFilterRegion] = useState('all');
  const [filterCoord, setFilterCoord] = useState('all');
  const [filterAging, setFilterAging] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [reassignTicket, setReassignTicket] = useState(null);
  const [reassignTo, setReassignTo] = useState('');

  const fetchData = () => {
    api.getBirdsEye().then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  };
  useEffect(() => { fetchData(); const i = setInterval(fetchData, 10000); return () => clearInterval(i); }, []);

  const handleReassign = async () => {
    if (!reassignTicket) return;
    try {
      await api.assignTicket(reassignTicket, reassignTo || null);
      showToast('Ticket reassigned');
      setReassignTicket(null); setReassignTo('');
      fetchData();
    } catch(e) { showToast(e.message); }
  };

  if (loading || !data) return <div style={{ padding: 40, textAlign: 'center', color: '#8a9fb0' }}>Loading command center...</div>;

  const filteredTickets = data.tickets.filter(t => {
    if (filterRegion !== 'all' && t.region?.id !== filterRegion) return false;
    if (filterCoord !== 'all') {
      if (filterCoord === 'unassigned' && t.assignee) return false;
      if (filterCoord !== 'unassigned' && t.assignee?.id !== filterCoord) return false;
    }
    if (filterAging !== 'all' && t.aging !== filterAging) return false;
    if (filterStatus !== 'all' && t.status !== filterStatus) return false;
    return true;
  });

  const agingCounts = { fresh: 0, '1h+': 0, '4h+': 0, '24h+': 0 };
  data.tickets.forEach(t => agingCounts[t.aging]++);

  const selectStyle = { padding: '6px 10px', background: '#dde8f2', border: '1px solid #c0d0e4', borderRadius: 6, fontSize: 11, color: '#1e3a4f', cursor: 'pointer' };

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Aging cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        {[
          { key: 'fresh', label: 'Fresh (<1hr)', count: agingCounts.fresh, color: '#2e7d32', bg: '#e8f5e9' },
          { key: '1h+', label: '1-4 hours', count: agingCounts['1h+'], color: '#f59e0b', bg: '#fef8ec' },
          { key: '4h+', label: '4-24 hours', count: agingCounts['4h+'], color: '#e67e22', bg: '#fdf0e0' },
          { key: '24h+', label: '24+ hours', count: agingCounts['24h+'], color: '#d94040', bg: '#fde8e8' },
        ].map(a => (
          <div key={a.key} onClick={() => setFilterAging(filterAging === a.key ? 'all' : a.key)}
            style={{ padding: '14px 16px', background: filterAging === a.key ? a.color : a.bg, borderRadius: 10,
              border: '1px solid ' + a.color + '40', cursor: 'pointer', transition: 'all 0.15s' }}>
            <div style={{ fontSize: 10, color: filterAging === a.key ? '#fff' : a.color, fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>{a.label}</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: filterAging === a.key ? '#fff' : a.color, fontFamily: "'IBM Plex Mono', monospace" }}>{a.count}</div>
          </div>
        ))}
      </div>

      {/* Coordinators online strip */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '12px 16px', background: '#f0f4f9', borderRadius: 10, border: '1px solid #dde8f2' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#6b8299', alignSelf: 'center', marginRight: 8 }}>Team:</span>
        {data.coordinators.map(c => (
          <div key={c.id} onClick={() => setFilterCoord(filterCoord === c.id ? 'all' : c.id)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 20,
              background: filterCoord === c.id ? '#102f54' : '#fff', color: filterCoord === c.id ? '#fff' : '#1e3a4f',
              border: '1px solid #c0d0e4', cursor: 'pointer', fontSize: 12, fontWeight: 500 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: c.isOnline ? '#4ade80' : '#d1d5db', flexShrink: 0 }} />
            <span>{c.name}</span>
            <span style={{ fontSize: 10, fontWeight: 700, background: filterCoord === c.id ? '#1a5e9a' : '#dde8f2', padding: '1px 6px', borderRadius: 10, color: filterCoord === c.id ? '#fff' : '#1a5e9a' }}>{c.openTickets}</span>
          </div>
        ))}
        <div onClick={() => setFilterCoord(filterCoord === 'unassigned' ? 'all' : 'unassigned')}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 20,
            background: filterCoord === 'unassigned' ? '#d94040' : '#fff', color: filterCoord === 'unassigned' ? '#fff' : '#d94040',
            border: '1px solid #d9404060', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
          Unassigned
          <span style={{ fontSize: 10, fontWeight: 700, background: filterCoord === 'unassigned' ? '#b91c1c' : '#fde8e8', padding: '1px 6px', borderRadius: 10 }}>
            {data.tickets.filter(t => !t.assignee).length}
          </span>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#6b8299' }}>Filters:</span>
        <select value={filterRegion} onChange={e => setFilterRegion(e.target.value)} style={selectStyle}>
          <option value="all">All Regions</option>
          {data.regions.map(r => <option key={r.id} value={r.id}>{r.name} ({r.totalOpen})</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={selectStyle}>
          <option value="all">All Statuses</option>
          <option value="OPEN">Open</option>
          <option value="WAITING_ON_EXTERNAL">Waiting</option>
        </select>
        {(filterRegion !== 'all' || filterCoord !== 'all' || filterAging !== 'all' || filterStatus !== 'all') && (
          <button onClick={() => { setFilterRegion('all'); setFilterCoord('all'); setFilterAging('all'); setFilterStatus('all'); }}
            style={{ padding: '6px 12px', background: '#fde8e8', color: '#d94040', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
            Clear All
          </button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#6b8299' }}>{filteredTickets.length} tickets</span>
      </div>

      {/* Region depth bars */}
      <div style={{ display: 'flex', gap: 8 }}>
        {data.regions.map(r => {
          const pct = data.tickets.length ? (r.totalOpen / Math.max(...data.regions.map(x => x.totalOpen || 1))) * 100 : 0;
          return (
            <div key={r.id} onClick={() => setFilterRegion(filterRegion === r.id ? 'all' : r.id)}
              style={{ flex: 1, padding: '10px 12px', background: filterRegion === r.id ? '#102f54' : '#f0f4f9', borderRadius: 8,
                border: '1px solid #dde8f2', cursor: 'pointer', color: filterRegion === r.id ? '#fff' : '#1e3a4f' }}>
              <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6 }}>{r.name}</div>
              <div style={{ height: 6, background: filterRegion === r.id ? '#1a5e9a' : '#dde8f2', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: pct + '%', background: filterRegion === r.id ? '#4ade80' : '#1a5e9a', borderRadius: 3, transition: 'width 0.3s' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 10, color: filterRegion === r.id ? '#a8c8e8' : '#6b8299' }}>
                <span>{r.totalOpen} open</span>
                <span>{r.unassigned} unassigned</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Ticket list */}
      <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #dde8f2', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: '#f0f4f9' }}>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#5a7a8a' }}>Ticket</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#5a7a8a' }}>Subject</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#5a7a8a' }}>Region</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#5a7a8a' }}>Assigned To</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#5a7a8a' }}>Age</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#5a7a8a' }}>Status</th>
              <th style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 600, color: '#5a7a8a' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredTickets.slice(0, 100).map(t => {
              const ageColor = t.aging === '24h+' ? '#d94040' : t.aging === '4h+' ? '#e67e22' : t.aging === '1h+' ? '#f59e0b' : '#2e7d32';
              const ageLabel = t.lastActivityMs < 60000 ? '<1m' : t.lastActivityMs < 3600000 ? Math.floor(t.lastActivityMs/60000)+'m' : t.lastActivityMs < 86400000 ? Math.floor(t.lastActivityMs/3600000)+'h' : Math.floor(t.lastActivityMs/86400000)+'d';
              return (
                <tr key={t.id} style={{ borderTop: '1px solid #f0f4f9' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <td style={{ padding: '8px 12px', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: '#6b8299' }}>{t.id.slice(0,12).toUpperCase()}</td>
                  <td style={{ padding: '8px 12px', maxWidth: 250 }}>
                    <div onClick={() => onOpenTicket(t.id)} style={{ cursor: 'pointer', fontWeight: 500, color: '#1a5e9a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
                      onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}>
                      {t.subject}
                    </div>
                    <div style={{ fontSize: 10, color: '#8a9fb0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.fromEmail}</div>
                  </td>
                  <td style={{ padding: '8px 12px', fontSize: 11 }}>{t.region?.name || '-'}</td>
                  <td style={{ padding: '8px 12px' }}>
                    {t.assignee ? (
                      <span style={{ fontSize: 11, fontWeight: 500 }}>{t.assignee.name}</span>
                    ) : (
                      <span style={{ fontSize: 11, color: '#d94040', fontWeight: 600 }}>Unassigned</span>
                    )}
                  </td>
                  <td style={{ padding: '8px 12px' }}>
                    <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, background: ageColor + '18', color: ageColor }}>{ageLabel}</span>
                  </td>
                  <td style={{ padding: '8px 12px' }}><StatusBadge status={t.status} /></td>
                  <td style={{ padding: '8px 8px', textAlign: 'right' }}>
                    <button onClick={() => { setReassignTicket(t.id); setReassignTo(t.assignee?.id || ''); }}
                      style={{ padding: '3px 8px', background: '#dde8f2', border: '1px solid #c0d0e4', borderRadius: 4, fontSize: 10, cursor: 'pointer', color: '#1a5e9a', fontWeight: 600 }}>
                      Reassign
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filteredTickets.length === 0 && <div style={{ padding: 32, textAlign: 'center', color: '#8a9fb0' }}>No tickets match filters</div>}
        {filteredTickets.length > 100 && <div style={{ padding: 8, textAlign: 'center', color: '#8a9fb0', fontSize: 11 }}>Showing first 100 of {filteredTickets.length}</div>}
      </div>

      {/* Reassign modal */}
      {reassignTicket && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }} onClick={() => setReassignTicket(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, padding: 24, width: 360, boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: '#1e3a4f', marginBottom: 16 }}>Reassign Ticket</h3>
            <div style={{ fontSize: 12, color: '#6b8299', marginBottom: 12 }}>{reassignTicket}</div>
            <select value={reassignTo} onChange={e => setReassignTo(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', border: '1px solid #c0d0e4', borderRadius: 8, fontSize: 13, marginBottom: 16, background: '#fff' }}>
              <option value="">Return to Queue (unassign)</option>
              {data.coordinators.map(c => <option key={c.id} value={c.id}>{c.name} ({c.openTickets} tickets)</option>)}
            </select>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setReassignTicket(null)} style={{ padding: '8px 16px', background: '#f0f4f9', border: '1px solid #c0d0e4', borderRadius: 8, cursor: 'pointer', fontSize: 12, color: '#5a7a8a' }}>Cancel</button>
              <button onClick={handleReassign} style={{ padding: '8px 16px', background: '#1a5e9a', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>Reassign</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Dashboard`
);

// Add tabs to Dashboard header
dash = dash.replace(
  `<h1 style={{ fontSize: 18, fontWeight: 700, letterSpacing: -0.3 }}>Supervisor Dashboard</h1>`,
  `<h1 style={{ fontSize: 18, fontWeight: 700, letterSpacing: -0.3 }}>Supervisor Dashboard</h1>
        <div style={{ display: 'flex', gap: 4, background: '#dde8f2', borderRadius: 8, padding: 3, border: '1px solid #c0d0e4' }}>
          {[{ key: 'overview', label: 'Overview' }, { key: 'birdsEye', label: "Bird's Eye" }].map(t => (
            <button key={t.key} onClick={() => setDashTab(t.key)}
              style={{ padding: '6px 16px', borderRadius: 6, border: 'none', background: dashTab === t.key ? '#1a5e9a' : 'transparent', color: dashTab === t.key ? '#fff' : '#5a7a8a', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              {t.label}
            </button>
          ))}
        </div>`
);

// Add dashTab state
dash = dash.replace(
  'const [showBulkModal, setShowBulkModal] = useState(false);',
  "const [dashTab, setDashTab] = useState('overview');\n  const [showBulkModal, setShowBulkModal] = useState(false);"
);

// Wrap the existing overview content in a conditional, and add bird's eye
dash = dash.replace(
  `<div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Summary cards */}`,
  `{dashTab === 'birdsEye' && (
        <BirdsEyeView currentUser={currentUser} allUsers={allUsers} onOpenTicket={onOpenTicket} showToast={showToast} />
      )}

      {dashTab === 'overview' && <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Summary cards */}`
);

// Close the overview div before the bulk modal
dash = dash.replace(
  `      {/* Bulk modal */}`,
  `      </div>}

      {/* Bulk modal */}`
);

fs.writeFileSync('client/src/components/Dashboard.jsx', dash, 'utf8');
console.log('  ✓ Dashboard.jsx — Bird\'s Eye tab added');

// Verify server compiles
try { require('./server/routes/tickets'); console.log('  ✓ tickets.js compiles OK'); }
catch(e) { console.log('  ERROR:', e.message); }

console.log('');
console.log('Done. Restart server and refresh browser.');
console.log('');
console.log('Bird\'s Eye features:');
console.log('  • Aging cards: Fresh, 1-4hr, 4-24hr, 24h+ (clickable filters)');
console.log('  • Team strip: each coordinator with online dot + ticket count');
console.log('  • Region depth bars: visual queue depth per region');
console.log('  • Filter by region, coordinator, status, aging');
console.log('  • Full ticket table with click-to-open');
console.log('  • Reassign button on each ticket');
console.log('  • Auto-refreshes every 10 seconds');
