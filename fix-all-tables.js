// fix-all-tables.js
const fs = require('fs');
const path = require('path');

// Scan seed.js for all table references
const seed = fs.readFileSync(path.join(__dirname, 'server', 'seed.js'), 'utf8');
const insertTables = [...new Set((seed.match(/INSERT INTO (\w+)/g) || []).map(m => m.replace('INSERT INTO ', '')))];
console.log('Tables seed uses:', insertTables.join(', '));

// Read database.js
const dbPath = path.join(__dirname, 'server', 'database.js');
let db = fs.readFileSync(dbPath, 'utf8');

// Check which tables are missing
const missing = [];
for (const t of insertTables) {
  if (!db.includes("'" + t)) {
    missing.push(t);
  }
}
console.log('Missing tables:', missing.length ? missing.join(', ') : 'None');

// Define schemas for missing tables
const schemas = {
  close_reasons: 'id TEXT PRIMARY KEY, label TEXT',
  tags: 'id TEXT PRIMARY KEY, label TEXT, color TEXT',
  ticket_tags: 'ticket_id TEXT, tag_id TEXT, PRIMARY KEY(ticket_id, tag_id)',
  attachments: 'id TEXT PRIMARY KEY, ticket_id TEXT, message_id TEXT, filename TEXT, mime_type TEXT, size INTEGER, path TEXT, uploaded_by TEXT, uploaded_at INTEGER',
  contacts: 'id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, organization TEXT, role TEXT, region_id TEXT, created_by TEXT, created_at INTEGER',
  ticket_contacts: 'ticket_id TEXT, contact_id TEXT, PRIMARY KEY(ticket_id, contact_id)',
  templates: 'id TEXT PRIMARY KEY, name TEXT, subject TEXT, body TEXT, created_by TEXT, created_at INTEGER',
  escalations: 'id TEXT PRIMARY KEY, ticket_id TEXT, from_user_id TEXT, to_user_id TEXT, reason TEXT, created_at INTEGER',
  sla_rules: 'id TEXT PRIMARY KEY, name TEXT, priority TEXT, response_minutes INTEGER, resolve_minutes INTEGER',
};

if (missing.length > 0) {
  const additions = missing.map(t => {
    const schema = schemas[t] || 'id TEXT PRIMARY KEY, data TEXT';
    return "  db.run('CREATE TABLE IF NOT EXISTS " + t + " (" + schema + ")');";
  }).join('\n');

  db = db.replace(
    "db.run('CREATE TABLE IF NOT EXISTS email_filters",
    additions + "\n\n  db.run('CREATE TABLE IF NOT EXISTS email_filters"
  );

  fs.writeFileSync(dbPath, db, 'utf8');
  console.log('✓ Added ' + missing.length + ' missing tables');
} else {
  console.log('✓ All tables present');
}

console.log('\nNow: del server\\carecoord.db && npm run seed');
