const fs = require('fs');
let f = fs.readFileSync('client/src/components/QueueScreen.jsx', 'utf8');
f = f.replace(
  'if (statusFilter) params.status = statusFilter;',
  "if (queueFilter && queueFilter !== 'all') params.status = queueFilter;"
);
fs.writeFileSync('client/src/components/QueueScreen.jsx', f, 'utf8');
console.log('fixed');
