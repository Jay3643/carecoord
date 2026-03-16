const fs = require('fs');
let f = fs.readFileSync('client/src/components/QueueScreen.jsx', 'utf8');

// Add gmailAutoSync before the ticket fetch
f = f.replace(
  "const fetchTickets = async () => {\n    setLoading(true);\n    try {",
  "const fetchTickets = async () => {\n    setLoading(true);\n    try {\n      if (mode === 'region') await api.gmailAutoSync().catch(() => {});"
);

fs.writeFileSync('client/src/components/QueueScreen.jsx', f, 'utf8');
console.log('fixed — QueueScreen now triggers sync before loading tickets');
