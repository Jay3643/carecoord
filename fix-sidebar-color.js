// fix-sidebar-color.js
const fs = require('fs');
const path = require('path');

const appPath = path.join(__dirname, 'client', 'src', 'App.jsx');
let app = fs.readFileSync(appPath, 'utf8');

// Remove the duplicate color: 'inherit' that overrides the white
app = app.replace(
  "cursor: 'pointer', fontSize: 13, fontWeight: 500, width: '100%', textAlign: 'left', color: 'inherit',",
  "cursor: 'pointer', fontSize: 13, fontWeight: 500, width: '100%', textAlign: 'left',"
);

fs.writeFileSync(appPath, app, 'utf8');
console.log('✓ Fixed sidebar text color — selected items will be white');
