const fs = require('fs');
let app = fs.readFileSync('client/src/App.jsx', 'utf8');

// The regular button uses <Icon name={item.icon} /> but Gemini has gIcon, not icon
// Fix the button to check for gIcon first
app = app.replace(
  `<button key={item.key} onClick={() => { if (item.key === 'gemini') { setShowGemini(g => !g); } else { setScreen(item.key); setSelectedTicketId(null); } }}`,
  `<button key={item.key} onClick={() => { if (item.key === 'gemini') { setShowGemini(prev => !prev); return; } setScreen(item.key); setSelectedTicketId(null); }}`
);

app = app.replace(
  `              <Icon name={item.icon} size={18} />
              {!sidebarCollapsed && <span>{item.label}</span>}`,
  `              {item.gIcon || <Icon name={item.icon} size={18} />}
              {!sidebarCollapsed && <span>{item.label}</span>}`
);

fs.writeFileSync('client/src/App.jsx', app, 'utf8');
console.log('✓ Button rendering now supports gIcon (for Gemini)');
console.log('Refresh browser.');
