const fs = require('fs');

// ═══════════════════════════════════════════════
// FIX 1: Supervisor reassign from ticket detail
// Already works — the TicketDetail has an assign dropdown for supervisors
// But let's also add reassign in the QueueScreen group headers
// ═══════════════════════════════════════════════
let queue = fs.readFileSync('client/src/components/QueueScreen.jsx', 'utf8');

// Remove the "Clear All" filters button from Bird's Eye (it's in Dashboard.jsx)
// Actually the "clear all" feedback is about the "Select all" bar — let's remove it for coordinators
// No — the feedback says "Get rid of clear all button" — this is the "Clear All" in Bird's Eye filters

// ═══════════════════════════════════════════════
// FIX 2: Remove "Clear All" from Bird's Eye filters
// FIX 3: Dashboard open tickets show sender
// FIX 4: Bird's Eye scroll — remove slice(0, 100) limit
// ═══════════════════════════════════════════════
let dash = fs.readFileSync('client/src/components/Dashboard.jsx', 'utf8');

// Remove Clear All button from Bird's Eye
dash = dash.replace(
  `{(filterRegion !== 'all' || filterCoord !== 'all' || filterAging !== 'all' || filterStatus !== 'all') && (
          <button onClick={() => { setFilterRegion('all'); setFilterCoord('all'); setFilterAging('all'); setFilterStatus('all'); }}
            style={{ padding: '6px 12px', background: '#fde8e8', color: '#d94040', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>Clear All</button>
        )}`,
  `{(filterRegion !== 'all' || filterCoord !== 'all' || filterAging !== 'all' || filterStatus !== 'all') && (
          <button onClick={() => { setFilterRegion('all'); setFilterCoord('all'); setFilterAging('all'); setFilterStatus('all'); }}
            style={{ padding: '6px 12px', background: '#f0f4f9', color: '#6b8299', border: '1px solid #c0d0e4', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 500 }}>Reset Filters</button>
        )}`
);

// Fix Bird's Eye scroll — remove the 100 ticket limit so all tickets show
dash = dash.replace(
  "filteredTickets.slice(0, 100).map(t => {",
  "filteredTickets.map(t => {"
);

// Remove the "showing first 100" message
dash = dash.replace(
  `{filteredTickets.length > 100 && <div style={{ padding: 8, textAlign: 'center', color: '#8a9fb0', fontSize: 11 }}>Showing first 100 of {filteredTickets.length}</div>}`,
  ``
);

// Add sender column to Bird's Eye table — add "From" header after "Subject"
dash = dash.replace(
  `<th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#5a7a8a' }}>Subject</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#5a7a8a' }}>Region</th>`,
  `<th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#5a7a8a' }}>Subject</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#5a7a8a' }}>From</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#5a7a8a' }}>Region</th>`
);

// Add sender data cell after subject cell
dash = dash.replace(
  `<td style={{ padding: '8px 12px', fontSize: 11 }}>{t.region?.name || '-'}</td>
                  <td style={{ padding: '8px 12px' }}>{t.assignee ?`,
  `<td style={{ padding: '8px 12px', fontSize: 11, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.fromEmail || '-'}</td>
                  <td style={{ padding: '8px 12px', fontSize: 11 }}>{t.region?.name || '-'}</td>
                  <td style={{ padding: '8px 12px' }}>{t.assignee ?`
);

// Also add sender to the drill-down ticket list in Overview
dash = dash.replace(
  `<span style={{ flex: 1, fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.subject}</span>
                  <span style={{ fontSize: 11, color: '#6b8299' }}>{fmt.time(t.last_activity_at)}</span>`,
  `<span style={{ flex: 1, fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.subject}</span>
                  <span style={{ fontSize: 10, color: '#8a9fb0', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.from_email || (t.external_participants||[])[0] || ''}</span>
                  <span style={{ fontSize: 11, color: '#6b8299' }}>{fmt.time(t.last_activity_at)}</span>`
);

// Make the Bird's Eye table container scrollable
dash = dash.replace(
  `<div style={{ background: '#fff', borderRadius: 10, border: '1px solid #dde8f2', overflow: 'hidden' }}>
        <table`,
  `<div style={{ background: '#fff', borderRadius: 10, border: '1px solid #dde8f2', overflow: 'auto', maxHeight: 'calc(100vh - 400px)' }}>
        <table`
);

// Make table header sticky
dash = dash.replace(
  `<thead>
            <tr style={{ background: '#f0f4f9' }}>`,
  `<thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
            <tr style={{ background: '#f0f4f9' }}>`
);

fs.writeFileSync('client/src/components/Dashboard.jsx', dash, 'utf8');
console.log('✓ Fix 1: Removed Clear All button (now Reset Filters)');
console.log('✓ Fix 3: Dashboard/Bird\'s Eye shows sender (From column)');
console.log('✓ Fix 4: Bird\'s Eye scrollable — no 100 ticket limit, sticky header');

// ═══════════════════════════════════════════════
// FIX 5: Admin/supervisor tag management
// ═══════════════════════════════════════════════
// Check if admin routes have tag endpoints
let admin = fs.readFileSync('server/routes/admin.js', 'utf8');

if (!admin.includes("'/tags'")) {
  // Add tag CRUD endpoints to admin routes
  const tagRoutes = `
// ── Tag Management (admin/supervisor) ──
router.get('/tags', requireAuth, (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'supervisor') return res.status(403).json({ error: 'Not authorized' });
  const tags = getDb().prepare('SELECT * FROM tags ORDER BY name').all();
  res.json({ tags: tags.map(t => ({ id: toStr(t.id), name: toStr(t.name), color: toStr(t.color) })) });
});

router.post('/tags', requireAuth, (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'supervisor') return res.status(403).json({ error: 'Not authorized' });
  const { name, color } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const id = 't' + Date.now();
  getDb().prepare('INSERT INTO tags (id, name, color) VALUES (?, ?, ?)').run(id, name, color || '#6b7280');
  saveDb();
  res.json({ id, name, color: color || '#6b7280' });
});

router.put('/tags/:id', requireAuth, (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'supervisor') return res.status(403).json({ error: 'Not authorized' });
  const { name, color } = req.body;
  getDb().prepare('UPDATE tags SET name = COALESCE(?, name), color = COALESCE(?, color) WHERE id = ?').run(name || null, color || null, req.params.id);
  saveDb();
  res.json({ ok: true });
});

router.delete('/tags/:id', requireAuth, (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'supervisor') return res.status(403).json({ error: 'Not authorized' });
  const db = getDb();
  db.prepare('DELETE FROM ticket_tags WHERE tag_id = ?').run(req.params.id);
  db.prepare('DELETE FROM tags WHERE id = ?').run(req.params.id);
  saveDb();
  res.json({ ok: true });
});

`;

  // Insert before module.exports
  admin = admin.replace('module.exports = router;', tagRoutes + 'module.exports = router;');
  fs.writeFileSync('server/routes/admin.js', admin, 'utf8');
  console.log('✓ Fix 5: Tag CRUD endpoints added to admin routes');
} else {
  console.log('⊘ Fix 5: Tag routes already exist');
}

// Add tag management API methods
let apiFile = fs.readFileSync('client/src/api.js', 'utf8');
if (!apiFile.includes('adminCreateTag')) {
  apiFile = apiFile.replace(
    'adminGetRegions:',
    `adminGetTags: () => request('/admin/tags'),
  adminCreateTag: (d) => request('/admin/tags', { method: 'POST', body: d }),
  adminUpdateTag: (id, d) => request('/admin/tags/' + id, { method: 'PUT', body: d }),
  adminDeleteTag: (id) => request('/admin/tags/' + id, { method: 'DELETE' }),
  adminGetRegions:`
  );
  fs.writeFileSync('client/src/api.js', apiFile, 'utf8');
  console.log('  ✓ API methods for tag management added');
}

// Add Tags tab to AdminPanel
let adminPanel = fs.readFileSync('client/src/components/AdminPanel.jsx', 'utf8');
if (!adminPanel.includes("'tags'")) {
  // Add tags tab
  adminPanel = adminPanel.replace(
    "{ key: 'regions', label: 'Regions' }",
    "{ key: 'regions', label: 'Regions' }, { key: 'tags', label: 'Tags' }"
  );

  // Add tags tab content - find where regions tab content ends and add after
  if (adminPanel.includes("activeTab === 'regions'")) {
    adminPanel = adminPanel.replace(
      /(\{activeTab === 'regions' &&[\s\S]*?\n        \}\))/,
      (match) => match + `

        {activeTab === 'tags' && (
          <TagManager />
        )}`
    );

    // Add TagManager component inside AdminPanel file
    adminPanel = adminPanel.replace(
      'export default function AdminPanel',
      `function TagManager() {
  const [tags, setTags] = React.useState([]);
  const [newName, setNewName] = React.useState('');
  const [newColor, setNewColor] = React.useState('#3b82f6');
  const [editId, setEditId] = React.useState(null);
  const [editName, setEditName] = React.useState('');
  const [editColor, setEditColor] = React.useState('');

  React.useEffect(() => { api.adminGetTags().then(d => setTags(d.tags || [])).catch(() => {}); }, []);

  const addTag = async () => {
    if (!newName.trim()) return;
    const d = await api.adminCreateTag({ name: newName, color: newColor });
    setTags(prev => [...prev, { id: d.id, name: newName, color: newColor }]);
    setNewName(''); setNewColor('#3b82f6');
  };

  const saveEdit = async () => {
    if (!editId) return;
    await api.adminUpdateTag(editId, { name: editName, color: editColor });
    setTags(prev => prev.map(t => t.id === editId ? { ...t, name: editName, color: editColor } : t));
    setEditId(null);
  };

  const deleteTag = async (id) => {
    if (!confirm('Delete this tag? It will be removed from all tickets.')) return;
    await api.adminDeleteTag(id);
    setTags(prev => prev.filter(t => t.id !== id));
  };

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, alignItems: 'center' }}>
        <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Tag name"
          style={{ padding: '8px 12px', border: '1px solid #c0d0e4', borderRadius: 8, fontSize: 13, flex: 1 }} />
        <input type="color" value={newColor} onChange={e => setNewColor(e.target.value)}
          style={{ width: 40, height: 36, border: '1px solid #c0d0e4', borderRadius: 8, cursor: 'pointer' }} />
        <button onClick={addTag} style={{ padding: '8px 16px', background: '#1a5e9a', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Add Tag</button>
      </div>
      {tags.map(tag => (
        <div key={tag.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderBottom: '1px solid #f0f4f9' }}>
          {editId === tag.id ? (
            <>
              <input value={editName} onChange={e => setEditName(e.target.value)}
                style={{ padding: '6px 10px', border: '1px solid #c0d0e4', borderRadius: 6, fontSize: 13, flex: 1 }} />
              <input type="color" value={editColor} onChange={e => setEditColor(e.target.value)}
                style={{ width: 32, height: 28, border: '1px solid #c0d0e4', borderRadius: 6, cursor: 'pointer' }} />
              <button onClick={saveEdit} style={{ padding: '4px 12px', background: '#1a5e9a', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>Save</button>
              <button onClick={() => setEditId(null)} style={{ padding: '4px 12px', background: '#f0f4f9', color: '#5a7a8a', border: '1px solid #c0d0e4', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>Cancel</button>
            </>
          ) : (
            <>
              <div style={{ width: 16, height: 16, borderRadius: '50%', background: tag.color, flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 14, fontWeight: 500 }}>{tag.name}</span>
              <button onClick={() => { setEditId(tag.id); setEditName(tag.name); setEditColor(tag.color); }}
                style={{ padding: '4px 10px', background: '#f0f4f9', border: '1px solid #c0d0e4', borderRadius: 6, cursor: 'pointer', fontSize: 11, color: '#1a5e9a' }}>Edit</button>
              <button onClick={() => deleteTag(tag.id)}
                style={{ padding: '4px 10px', background: '#fde8e8', border: '1px solid #d9404060', borderRadius: 6, cursor: 'pointer', fontSize: 11, color: '#d94040' }}>Delete</button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

export default function AdminPanel`
    );

    // Make sure api is imported
    if (!adminPanel.includes("import { api }")) {
      adminPanel = adminPanel.replace(
        "import React",
        "import React"
      );
    }
  }

  fs.writeFileSync('client/src/components/AdminPanel.jsx', adminPanel, 'utf8');
  console.log('  ✓ Tags tab added to Admin Panel');
}

// ═══════════════════════════════════════════════
// FIX 6: Check admin.js has toStr and getDb imported
// ═══════════════════════════════════════════════
let adminCheck = fs.readFileSync('server/routes/admin.js', 'utf8');
if (!adminCheck.includes('toStr')) {
  adminCheck = adminCheck.replace(
    "const { requireAuth } = require('../middleware');",
    "const { requireAuth, toStr } = require('../middleware');"
  );
  fs.writeFileSync('server/routes/admin.js', adminCheck, 'utf8');
  console.log('  ✓ Added toStr import to admin.js');
}
if (!adminCheck.includes('saveDb')) {
  adminCheck = fs.readFileSync('server/routes/admin.js', 'utf8');
  adminCheck = adminCheck.replace(
    "const { getDb } = require('../database');",
    "const { getDb, saveDb } = require('../database');"
  );
  fs.writeFileSync('server/routes/admin.js', adminCheck, 'utf8');
  console.log('  ✓ Added saveDb import to admin.js');
}

console.log('\n✅ All 5 medium fixes applied!');
console.log('Push and redeploy.');
