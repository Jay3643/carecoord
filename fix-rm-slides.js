const fs = require('fs');
let app = fs.readFileSync('client/src/App.jsx', 'utf8');

app = app.replace(
  /\{ key: 'ext_slides'[^}]*\},\n/,
  ''
);

fs.writeFileSync('client/src/App.jsx', app, 'utf8');
console.log('✓ Slides removed');
