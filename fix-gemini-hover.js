const fs = require('fs');
let app = fs.readFileSync('client/src/App.jsx', 'utf8');

// Give Gemini a fake url so it goes through the <a> rendering path
// But override the click to open popup instead of following the link
app = app.replace(
  "{ key: 'gemini', label: 'Gemini',",
  "{ key: 'gemini', label: 'Gemini', url: 'gemini',",
);

// Now in the external link handler, intercept gemini specifically
app = app.replace(
  `if (item.url) return (
              <a key={item.key} href={item.url} target="_blank" rel="noopener noreferrer"`,
  `if (item.url) return (
              <a key={item.key} href={item.url === 'gemini' ? '#' : item.url} target={item.url === 'gemini' ? undefined : '_blank'} rel="noopener noreferrer"
                onClick={item.url === 'gemini' ? (e) => { e.preventDefault(); const w=420,h=window.innerHeight-40; const left=window.screenX+window.innerWidth-w-10; const top=window.screenY+20; window.open('https://gemini.google.com/app','gemini-ai','width='+w+',height='+h+',left='+left+',top='+top+',menubar=no,toolbar=no,location=yes,status=no,scrollbars=yes,resizable=yes'); } : undefined}`
);

// Remove the gemini check from the button click handler since it now goes through <a>
app = app.replace(
  `if (item.key === 'gemini') {
                const w = 420, h = window.innerHeight - 40;
                const left = window.screenX + window.innerWidth - w - 10;
                const top = window.screenY + 20;
                window.open('https://gemini.google.com/app', 'gemini-ai', 'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top + ',menubar=no,toolbar=no,location=yes,status=no,scrollbars=yes,resizable=yes');
                return;
              }`,
  ''
);

fs.writeFileSync('client/src/App.jsx', app, 'utf8');
console.log('✓ Gemini now uses same hover/style as other Google apps');
