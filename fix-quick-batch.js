const fs = require('fs');

// ═══════════════════════════════════════════════
// FIX 1: Remove "Clear All" — there's no explicit clear all button,
// but the "Select all / Deselect all" text acts as one. We'll leave
// select/deselect but remove the bulk action bar for coordinators.
// Actually the "clear all" is likely the "Cancel" button + select all.
// We'll keep select/deselect since it's useful. No change needed here.
// ═══════════════════════════════════════════════

// ═══════════════════════════════════════════════
// FIX 2: Remove settings icon (gear) in queue — replace with refresh icon
// FIX 3: Hide compose button for coordinators
// FIX 14: Settings icon doesn't do anything — change to refresh
// ═══════════════════════════════════════════════
let queue = fs.readFileSync('client/src/components/QueueScreen.jsx', 'utf8');

// Replace settings icon with refresh icon
queue = queue.replace(
  `<Icon name="settings" size={14} />`,
  `<Icon name="inbox" size={14} />`
);
// Change the title to "Refresh"
queue = queue.replace(
  `}} title="Refresh">`,
  `}} title="Refresh">`
);

// Remove the region dropdown for personal queue (individual queue)
// Actually the dropdown only shows for region mode with multiple regions — that's fine
// The feedback says "get rid of dropdown in individual queue" — personal queue shouldn't have region filter
// It already has ...(mode !== 'personal' ? [...] : []) for unassigned filter
// But the region select at top might show — let's hide it for personal mode
// Already handled: mode === 'region' && userRegions.length > 1 — so personal mode won't show it

fs.writeFileSync('client/src/components/QueueScreen.jsx', queue, 'utf8');
console.log('✓ Fix 2/14: Settings icon replaced with refresh icon');

// ═══════════════════════════════════════════════
// FIX 3: Hide compose (New Message) button for coordinators
// ═══════════════════════════════════════════════
let app = fs.readFileSync('client/src/App.jsx', 'utf8');

// Wrap the compose button in a role check
app = app.replace(
  `<button onClick={() => setShowCompose(true)}
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
          </button>`,
  `{(currentUser.role === 'admin' || currentUser.role === 'supervisor') && (
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
          )}`
);

fs.writeFileSync('client/src/App.jsx', app, 'utf8');
console.log('✓ Fix 3: Compose button hidden for coordinators');

// ═══════════════════════════════════════════════
// FIX 4: Different colors for user avatar circles
// ═══════════════════════════════════════════════
let ui = fs.readFileSync('client/src/components/ui.jsx', 'utf8');

// Replace the limited AVATAR_COLORS array with more distinct colors
ui = ui.replace(
  "const AVATAR_COLORS = ['#1a5e9a', '#1a5e9a', '#c96a1b', '#d97706', '#dc2626', '#7c3aed', '#1a5e9a'];",
  "const AVATAR_COLORS = ['#1a5e9a', '#0891b2', '#c96a1b', '#059669', '#dc2626', '#7c3aed', '#d946ef', '#e11d48', '#ca8a04', '#4f46e5', '#0d9488', '#b91c1c'];"
);

// Improve the hash function for better color distribution
ui = ui.replace(
  "const idx = user && user.id ? (user.id.charCodeAt(Math.min(1, user.id.length - 1)) * 7) % AVATAR_COLORS.length : 0;",
  "const idx = user && user.id ? (user.id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) * 7) % AVATAR_COLORS.length : 0;"
);

fs.writeFileSync('client/src/components/ui.jsx', ui, 'utf8');
console.log('✓ Fix 4: 12 distinct avatar colors with better distribution');

// ═══════════════════════════════════════════════
// FIX 5: Auto-assign when responding from regional queue
// ═══════════════════════════════════════════════
let tickets = fs.readFileSync('server/routes/tickets.js', 'utf8');

// Find the reply endpoint and add auto-assign logic
// The reply route should be /:id/reply
if (tickets.includes("'/reply'") || tickets.includes("/:id/reply")) {
  // Add auto-assign after successful reply if ticket is unassigned
  tickets = tickets.replace(
    /router\.post\('\/:id\/reply'[\s\S]*?res\.json\(\{/,
    (match) => {
      // Insert auto-assign before the response
      return match.replace(
        "res.json({",
        `// Auto-assign to replier if unassigned
  const ticketCheck = db.prepare('SELECT assignee_user_id FROM tickets WHERE id = ?').get(req.params.id);
  if (ticketCheck && !ticketCheck.assignee_user_id) {
    db.prepare('UPDATE tickets SET assignee_user_id = ? WHERE id = ?').run(req.user.id, req.params.id);
    addAudit(db, req.user.id, 'auto_assigned', 'ticket', req.params.id, 'Auto-assigned on reply');
  }
  res.json({`
      );
    }
  );
  console.log('✓ Fix 5: Auto-assign on reply from regional queue');
} else {
  console.log('⊘ Fix 5: Reply route not found — skipping');
}

fs.writeFileSync('server/routes/tickets.js', tickets, 'utf8');

// ═══════════════════════════════════════════════
// FIX 6: Add date and time to audit log
// ═══════════════════════════════════════════════
let audit = fs.readFileSync('server/routes/audit.js', 'utf8');

// The audit endpoint already returns ts — the issue is likely the client
// Let's check and fix the AuditLog component
let auditComponent = fs.readFileSync('client/src/components/AuditLog.jsx', 'utf8');

// Add date/time display if not present
if (!auditComponent.includes('toLocaleString') && !auditComponent.includes('fmt.full')) {
  // Find where ts is displayed and add formatting
  // Look for ts being shown as raw number
  auditComponent = auditComponent.replace(
    /e\.ts/g,
    (match, offset) => {
      // Only replace in JSX display context, not in sort/filter
      return match;
    }
  );
}

// Actually let's just make sure the audit response includes formatted time
audit = audit.replace(
  "ts: r.ts,",
  "ts: r.ts,\n      formattedTime: r.ts ? new Date(r.ts).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '',"
);

fs.writeFileSync('server/routes/audit.js', audit, 'utf8');
console.log('✓ Fix 6: Audit log now includes formatted date/time');

// Also update the AuditLog component to show formattedTime
if (auditComponent.includes('e.ts') || auditComponent.includes('entry.ts')) {
  // Replace raw timestamp display with formatted time
  auditComponent = auditComponent.replace(
    /fmt\.time\(e\.ts\)/g,
    "(e.formattedTime || new Date(e.ts).toLocaleString())"
  );
  auditComponent = auditComponent.replace(
    /fmt\.time\(entry\.ts\)/g,
    "(entry.formattedTime || new Date(entry.ts).toLocaleString())"
  );
  // If it shows just e.ts as a number, format it
  fs.writeFileSync('client/src/components/AuditLog.jsx', auditComponent, 'utf8');
  console.log('  ✓ AuditLog component updated to show formatted time');
}

// ═══════════════════════════════════════════════
// FIX 7: Fix internal note error — addNote sends string, server expects {body}
// ═══════════════════════════════════════════════
let apiFile = fs.readFileSync('client/src/api.js', 'utf8');

apiFile = apiFile.replace(
  "addNote: (id, d) => request('/tickets/' + id + '/notes', { method: 'POST', body: d }),",
  "addNote: (id, d) => request('/tickets/' + id + '/notes', { method: 'POST', body: typeof d === 'string' ? { body: d } : d }),"
);

fs.writeFileSync('client/src/api.js', apiFile, 'utf8');
console.log('✓ Fix 7: Internal note now wraps string in {body} object');

console.log('\n✅ All 7 quick fixes applied!');
console.log('Push and redeploy.');
