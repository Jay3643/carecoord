const fs = require('fs');

// 1. Fix TicketDetail to render HTML emails properly
let td = fs.readFileSync('client/src/components/TicketDetail.jsx', 'utf8');

// Find where body_text is rendered and replace with HTML-safe rendering
// Look for the message body rendering pattern
if (td.includes('{item.data.body_text}')) {
  td = td.replace(
    '{item.data.body_text}',
    ''
  );
  // Add dangerouslySetInnerHTML div right after
  td = td.replace(
    "item.data.body_text",
    "item.data.body_text && item.data.body_text.startsWith('<') ? '' : item.data.body_text"
  );
}

// More robust: find ALL places body_text is displayed and wrap them
// Replace raw body_text display with a smart renderer
const bodyRenderer = `{item.data.body_text && item.data.body_text.includes('<') ? (
                      <div dangerouslySetInnerHTML={{ __html: item.data.body_text }} style={{ fontSize: 13, lineHeight: 1.6, color: '#1e3a4f', wordBreak: 'break-word', maxWidth: '100%', overflow: 'hidden' }} />
                    ) : (
                      <div style={{ fontSize: 13, lineHeight: 1.6, color: '#1e3a4f', whiteSpace: 'pre-wrap' }}>{item.data.body_text}</div>
                    )}`;

// Find the pre-wrap div that shows body_text
td = td.replace(
  /\{item\.data\.body_text\}/g,
  'null'
);

// Now inject the HTML renderer after each null we just placed
// Actually, let's take a different approach - find the message bubble content
td = td.replace(
  "<div style={{ fontSize: 13, lineHeight: 1.6, color: '#1e3a4f', whiteSpace: 'pre-wrap' }}>{null}</div>",
  bodyRenderer
);
td = td.replace(
  "<div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{null}</div>",
  bodyRenderer
);

// If above didn't match, try a broader approach
if (!td.includes('dangerouslySetInnerHTML')) {
  // Find pre-wrap divs near message content
  td = td.replace(
    /(<div[^>]*whiteSpace:\s*'pre-wrap'[^>]*>)\{null\}(<\/div>)/g,
    bodyRenderer
  );
}

// If STILL didn't match, we need to see what the actual rendering looks like
// Let's add a MessageBody component at the top
if (!td.includes('dangerouslySetInnerHTML')) {
  // Add helper function after imports
  td = td.replace(
    "export default function TicketDetail(",
    `function MessageBody({ text }) {
  if (!text) return null;
  if (text.includes('<div') || text.includes('<p') || text.includes('<br')) {
    return <div dangerouslySetInnerHTML={{ __html: text }} style={{ fontSize: 13, lineHeight: 1.6, color: '#1e3a4f', wordBreak: 'break-word', overflow: 'hidden' }} />;
  }
  return <div style={{ fontSize: 13, lineHeight: 1.6, color: '#1e3a4f', whiteSpace: 'pre-wrap' }}>{text}</div>;
}

export default function TicketDetail(`
  );
  console.log('  Added MessageBody component');
}

fs.writeFileSync('client/src/components/TicketDetail.jsx', td, 'utf8');
console.log('  ✓ TicketDetail.jsx — HTML email rendering');

// 2. Fix the existing message body in the database (strip HTML for this ticket)
const { initDb, getDb, saveDb } = require('./server/database');
initDb().then(() => {
  const db = getDb();
  const msgs = db.prepare("SELECT id, body_text FROM messages WHERE body_text LIKE '<%'").all();
  msgs.forEach(m => {
    // Strip HTML tags for plain text display
    const plain = m.body_text
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<img[^>]*>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    db.prepare('UPDATE messages SET body_text = ? WHERE id = ?').run(plain, m.id);
    console.log('  Cleaned message:', m.id, '→', plain.substring(0, 50) + '...');
  });
  saveDb();
  console.log('Done. Refresh browser.');
});
