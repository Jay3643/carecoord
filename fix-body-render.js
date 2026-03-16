const fs = require('fs');
let f = fs.readFileSync('client/src/components/TicketDetail.jsx', 'utf8');

// Replace inbound body (line 199-201)
f = f.replace(
  `<div style={{ marginLeft: 36, padding: '14px 18px', background: '#dde8f2', borderRadius: '4px 12px 12px 12px', border: '1px solid #c0d0e4', fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap', color: '#2d4a5e' }}>
                    {m.body_text}
                  </div>`,
  `<div style={{ marginLeft: 36, padding: '14px 18px', background: '#dde8f2', borderRadius: '4px 12px 12px 12px', border: '1px solid #c0d0e4', fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap', color: '#2d4a5e' }}>
                    <MessageBody text={m.body_text} />
                  </div>`
);

// Replace outbound body (line 214-216)
f = f.replace(
  `<div style={{ padding: '14px 18px', background: '#e8f0f8', borderRadius: '12px 4px 12px 12px', border: '1px solid #a8c0dc', fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap', color: '#2d4a5e' }}>
                    {m.body_text}
                  </div>`,
  `<div style={{ padding: '14px 18px', background: '#e8f0f8', borderRadius: '12px 4px 12px 12px', border: '1px solid #a8c0dc', fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap', color: '#2d4a5e' }}>
                    <MessageBody text={m.body_text} />
                  </div>`
);

// Add MessageBody component if not already there
if (!f.includes('function MessageBody')) {
  f = f.replace(
    'export default function TicketDetail(',
    `function MessageBody({ text }) {
  if (!text) return null;
  // Strip HTML to plain text
  const plain = text
    .replace(/<style[\\s\\S]*?<\\/style>/gi, '')
    .replace(/<script[\\s\\S]*?<\\/script>/gi, '')
    .replace(/<img[^>]*>/gi, '')
    .replace(/<br\\s*\\/?>/gi, '\\n')
    .replace(/<\\/p>/gi, '\\n')
    .replace(/<\\/div>/gi, '\\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\\n{3,}/g, '\\n\\n')
    .trim();
  return <span>{plain}</span>;
}

export default function TicketDetail(`
  );
}

fs.writeFileSync('client/src/components/TicketDetail.jsx', f, 'utf8');
console.log('✓ TicketDetail.jsx — HTML emails now rendered as clean text');
console.log('Refresh browser.');
