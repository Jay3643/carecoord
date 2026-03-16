const fs = require('fs');
let gmail = fs.readFileSync('server/routes/gmail.js', 'utf8');

// Update set-sync-date endpoint to clean up tickets outside the new date range
gmail = gmail.replace(
  `router.post('/set-sync-date', requireAuth, (req, res) => {
  if (req.user.role !== 'supervisor' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Supervisor access required' });
  }
  const { syncDate, resetSync } = req.body;
  if (!syncDate) return res.status(400).json({ error: 'syncDate required' });
  
  const db = getDb();
  const existing = db.prepare('SELECT * FROM email_sync_state WHERE user_id=?').get(req.user.id);
  if (existing) {
    if (resetSync) {
      db.prepare('UPDATE email_sync_state SET sync_start_date=?, last_sync_at=0 WHERE user_id=?').run(syncDate, req.user.id);
    } else {
      db.prepare('UPDATE email_sync_state SET sync_start_date=? WHERE user_id=?').run(syncDate, req.user.id);
    }
  } else {
    db.prepare('INSERT INTO email_sync_state (user_id, last_sync_at, sync_start_date) VALUES (?, 0, ?)').run(req.user.id, syncDate);
  }
  saveDb();
  console.log('[Sync] Start date set to', syncDate, 'for user', req.user.id, resetSync ? '(reset)' : '');
  res.json({ ok: true, syncDate });
});`,
  `router.post('/set-sync-date', requireAuth, (req, res) => {
  if (req.user.role !== 'supervisor' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Supervisor access required' });
  }
  const { syncDate, resetSync } = req.body;
  if (!syncDate) return res.status(400).json({ error: 'syncDate required' });
  
  const db = getDb();
  
  // Convert sync date to timestamp for comparison
  const newCutoff = new Date(syncDate.replace(/\\//g, '-') + 'T00:00:00').getTime();
  
  // Get the old sync date to determine if we're moving forward
  const existing = db.prepare('SELECT * FROM email_sync_state WHERE user_id=?').get(req.user.id);
  const oldDate = existing ? toStr(existing.sync_start_date) : null;
  const oldCutoff = oldDate ? new Date(oldDate.replace(/\\//g, '-') + 'T00:00:00').getTime() : 0;
  
  // If moving the date FORWARD, delete tickets/messages that fall before the new date
  // These emails will now show in personal inbox since the cutoff moved
  if (newCutoff > oldCutoff) {
    // Find all synced tickets created between old and new cutoff dates
    const oldTickets = db.prepare(
      "SELECT t.id FROM tickets t WHERE t.created_at >= ? AND t.created_at < ? AND t.id LIKE 'tk-%-%'"
    ).all(oldCutoff, newCutoff);
    
    let removed = 0;
    for (const t of oldTickets) {
      // Delete messages and attachments for this ticket
      db.prepare('DELETE FROM attachments WHERE ticket_id = ?').run(t.id);
      db.prepare('DELETE FROM messages WHERE ticket_id = ?').run(t.id);
      db.prepare('DELETE FROM ticket_tags WHERE ticket_id = ?').run(t.id);
      db.prepare('DELETE FROM tickets WHERE id = ?').run(t.id);
      removed++;
    }
    if (removed) console.log('[Sync] Removed', removed, 'tickets before new cutoff', syncDate);
  }
  
  // If moving the date BACKWARD, we need to re-sync the gap
  // Setting last_sync_at to 0 forces a full re-scan
  
  // Update the sync state
  if (existing) {
    db.prepare('UPDATE email_sync_state SET sync_start_date=?, last_sync_at=0 WHERE user_id=?').run(syncDate, req.user.id);
  } else {
    db.prepare('INSERT INTO email_sync_state (user_id, last_sync_at, sync_start_date) VALUES (?, 0, ?)').run(req.user.id, syncDate);
  }
  saveDb();
  console.log('[Sync] Start date changed from', oldDate || 'none', 'to', syncDate, 'for user', req.user.id);
  res.json({ ok: true, syncDate });
});`
);

fs.writeFileSync('server/routes/gmail.js', gmail, 'utf8');

try { require('./server/routes/gmail'); console.log('✓ gmail.js compiles OK'); }
catch(e) { console.log('ERROR:', e.message); }

console.log('');
console.log('✓ Sync date change now:');
console.log('  • Moving date FORWARD (3/1 → 3/7):');
console.log('    - Deletes tickets/messages from 3/1-3/6');
console.log('    - Those emails appear in personal inbox (cutoff moved)');
console.log('    - Re-syncs from 3/7 onward');
console.log('  • Moving date BACKWARD (3/7 → 3/1):');
console.log('    - Re-syncs to pick up emails from 3/1-3/6');
console.log('    - Those emails move from personal inbox to queue');
console.log('Refresh browser.');
