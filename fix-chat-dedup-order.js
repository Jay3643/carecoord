const fs = require('fs');

// Fix chat.js - improve dedup and ordering
let chat = fs.readFileSync('server/routes/chat.js', 'utf8');

// 1. Fix message ordering - ensure messages come back sorted by created_at ASC
chat = chat.replace(
  "ORDER BY cm.created_at DESC LIMIT ?",
  "ORDER BY cm.created_at ASC LIMIT ?"
);

// Remove the .reverse() since we're now sorting ASC directly
chat = chat.replace(
  "res.json({ messages: messages.reverse().map(m => ({",
  "res.json({ messages: messages.map(m => ({"
);

// 2. Fix channel listing - sort by last message time properly, handle null
chat = chat.replace(
  "ORDER BY (SELECT MAX(created_at) FROM chat_messages WHERE channel_id = c.id) DESC",
  "ORDER BY COALESCE((SELECT MAX(created_at) FROM chat_messages WHERE channel_id = c.id), c.created_at) DESC"
);

// 3. Fix the group chat dedup - for group chats, check if a channel with exact same members exists
// Replace the entire create channel endpoint
const newCreateChannel = `// Create channel (direct or group)
router.post('/channels', requireAuth, (req, res) => {
  const db = getDb();
  const { name, type, memberIds, ticketId } = req.body;

  // For direct messages, check if channel already exists between these two users
  if (type === 'direct' && memberIds && memberIds.length === 1) {
    const otherId = memberIds[0];
    const existing = db.prepare(\`
      SELECT c.id FROM chat_channels c
      WHERE c.type = 'direct'
      AND EXISTS (SELECT 1 FROM chat_members WHERE channel_id = c.id AND user_id = ?)
      AND EXISTS (SELECT 1 FROM chat_members WHERE channel_id = c.id AND user_id = ?)
      AND (SELECT COUNT(*) FROM chat_members WHERE channel_id = c.id) = 2
    \`).get(req.user.id, otherId);
    if (existing) return res.json({ channelId: toStr(existing.id), existing: true });
  }

  // For group chats, check if a group with the exact same members already exists
  if (type === 'group' && memberIds && memberIds.length > 1) {
    const allMembers = [req.user.id, ...memberIds].sort();
    const memberCount = allMembers.length;
    // Find channels where the current user is a member and member count matches
    const candidates = db.prepare(\`
      SELECT c.id FROM chat_channels c
      WHERE c.type = 'group'
      AND (SELECT COUNT(*) FROM chat_members WHERE channel_id = c.id) = ?
      AND EXISTS (SELECT 1 FROM chat_members WHERE channel_id = c.id AND user_id = ?)
    \`).all(memberCount, req.user.id);
    
    for (const cand of candidates) {
      const members = db.prepare('SELECT user_id FROM chat_members WHERE channel_id = ? ORDER BY user_id').all(toStr(cand.id));
      const candMembers = members.map(m => toStr(m.user_id)).sort();
      if (JSON.stringify(candMembers) === JSON.stringify(allMembers)) {
        return res.json({ channelId: toStr(cand.id), existing: true });
      }
    }
  }

  const id = 'ch-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  db.prepare('INSERT INTO chat_channels (id, name, type, ticket_id, created_by, created_at) VALUES (?,?,?,?,?,?)')
    .run(id, name || null, type || 'group', ticketId || null, req.user.id, Date.now());

  // Add creator as member
  db.prepare('INSERT INTO chat_members (channel_id, user_id, joined_at, last_read_at) VALUES (?,?,?,?)').run(id, req.user.id, Date.now(), Date.now());

  // Add other members
  if (memberIds) {
    for (const mid of memberIds) {
      if (mid !== req.user.id) {
        db.prepare('INSERT OR IGNORE INTO chat_members (channel_id, user_id, joined_at, last_read_at) VALUES (?,?,?,0)').run(id, mid, Date.now());
      }
    }
  }
  saveDb();
  res.json({ channelId: id });
});`;

// Replace the old create channel handler
chat = chat.replace(
  /\/\/ Create channel \(direct or group\)\nrouter\.post\('\/channels'[\s\S]*?res\.json\(\{ channelId: id \}\);\n\}\);/,
  newCreateChannel
);

fs.writeFileSync('server/routes/chat.js', chat, 'utf8');

const check = fs.readFileSync('server/routes/chat.js', 'utf8');
console.log(check.includes('JSON.stringify(candMembers)') ? '✓ Group chat dedup added' : '✗ Group dedup failed');
console.log(check.includes('ORDER BY cm.created_at ASC') ? '✓ Message ordering fixed' : '✗ Ordering fix failed');
console.log(check.includes('COALESCE') ? '✓ Channel sort fixed' : '✗ Channel sort failed');
