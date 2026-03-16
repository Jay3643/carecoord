const fs = require('fs');
let admin = fs.readFileSync('client/src/components/AdminPanel.jsx', 'utf8');

admin = admin.replace(
  `<button onClick={openNewUser} style={s.btn('#1a5e9a', '#fff')}>
                + Add User
              </button>`,
  ''
);

fs.writeFileSync('client/src/components/AdminPanel.jsx', admin, 'utf8');
console.log('✓ "Add User" button removed from Users tab');
console.log('  New users are created through Invitations tab only');
