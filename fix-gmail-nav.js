// fix-gmail-nav.js
const fs = require('fs');
const path = require('path');

const appPath = path.join(__dirname, 'client', 'src', 'App.jsx');
let app = fs.readFileSync(appPath, 'utf8');

// Check if GmailPanel import exists
if (!app.includes('GmailPanel')) {
  // Find last import and add after it
  app = app.replace(
    /import AdminPanel from '\.\/components\/AdminPanel';/,
    "import AdminPanel from './components/AdminPanel';\nimport GmailPanel from './components/GmailPanel';"
  );
  console.log('  ✓ Added GmailPanel import');
} else {
  console.log('  ✓ GmailPanel import already present');
}

// Find the nav items array and add gmail
if (!app.includes("'gmail'")) {
  // Try to find the nav items pattern
  const navMatch = app.match(/const\s+navItems\s*=\s*\[/);
  if (navMatch) {
    // It's a standalone array
    app = app.replace(
      /\{ key: 'dashboard', icon: 'chart', label: 'Dashboard' \}/,
      "{ key: 'dashboard', icon: 'chart', label: 'Dashboard' },\n            { key: 'gmail', icon: 'mail', label: 'Gmail' }"
    );
  } else {
    // Nav items might be inline - search for any dashboard reference in nav
    // Try broader pattern
    const dashboardLine = app.match(/dashboard.*?Dashboard.*?\}/);
    if (dashboardLine) {
      app = app.replace(
        dashboardLine[0],
        dashboardLine[0] + ",\n            { key: 'gmail', icon: 'mail', label: 'Gmail' }"
      );
    }
  }
  console.log('  ✓ Added Gmail nav item');
} else {
  console.log('  ✓ Gmail nav item already present');
}

// Add Gmail screen rendering
if (!app.includes("screen === 'gmail'")) {
  app = app.replace(
    "{screen === 'admin'",
    "{screen === 'gmail' && (\n          <GmailPanel currentUser={currentUser} showToast={showToast} />\n        )}\n        {screen === 'admin'"
  );
  console.log('  ✓ Added Gmail screen rendering');
} else {
  console.log('  ✓ Gmail screen rendering already present');
}

fs.writeFileSync(appPath, app, 'utf8');

// Show what nav items look like now
const navSection = app.match(/key: 'regionQueue'[\s\S]{0,800}/);
if (navSection) {
  console.log('\nNav items section:');
  console.log(navSection[0].substring(0, 500));
}

console.log('\n✅ Done! Gmail should now appear in sidebar.');
