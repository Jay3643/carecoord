// fix-tickets.js
const fs = require('fs');
let f = fs.readFileSync('server/routes/tickets.js', 'utf8');

// Add toStr import
f = f.replace(
  "const { requireAuth, requireSupervisor, addAudit } = require('../middleware');",
  "const { requireAuth, requireSupervisor, addAudit, toStr } = require('../middleware');"
);

// Add sanitize function and fix enrichTicket
f = f.replace(
  `function enrichTicket(db, ticket) {
  if (!ticket) return null;
  ticket.external_participants = JSON.parse(ticket.external_participants || '[]');`,
  `function sanitize(obj) {
  if (!obj) return obj;
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v instanceof Uint8Array || (v && typeof v === 'object' && v.constructor && v.constructor.name === 'Uint8Array')) obj[k] = Buffer.from(v).toString('utf8');
  }
  return obj;
}

function enrichTicket(db, ticket) {
  if (!ticket) return null;
  sanitize(ticket);
  ticket.external_participants = JSON.parse(ticket.external_participants || '[]');`
);

fs.writeFileSync('server/routes/tickets.js', f, 'utf8');
console.log('fixed — tickets.js now converts Uint8Arrays');
