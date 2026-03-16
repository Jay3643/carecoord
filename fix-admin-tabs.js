const fs = require('fs');
let admin = fs.readFileSync('client/src/components/AdminPanel.jsx', 'utf8');

// 1. Add regions prop
admin = admin.replace(
  "export default function AdminPanel({ currentUser, showToast }) {",
  "export default function AdminPanel({ currentUser, showToast, regions: passedRegions }) {"
);

// 2. Add invitations to the tab list
admin = admin.replace(
  "{['users', 'regions'].map(t => (",
  "{['users', 'invitations', 'regions'].map(t => ("
);

// 3. Add invitations tab rendering before the users tab
admin = admin.replace(
  `{/* ── USERS TAB ── */}
        {!loading && tab === 'users' && (`,
  `{/* ── INVITATIONS TAB ── */}
        {!loading && tab === 'invitations' && (
          <InviteSection currentUser={currentUser} showToast={showToast} regions={passedRegions || regions} />
        )}

        {/* ── USERS TAB ── */}
        {!loading && tab === 'users' && (`
);

fs.writeFileSync('client/src/components/AdminPanel.jsx', admin, 'utf8');
console.log('✓ AdminPanel — Invitations tab added');
console.log('  Tabs now: Users | Invitations | Regions');
console.log('Refresh browser.');
