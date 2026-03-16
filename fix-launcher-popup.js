const fs = require('fs');

const launcher = `import React from 'react';

export default function AppLauncher() {
  const openLauncher = () => {
    // Open a small popup window positioned like Google's app launcher
    const w = 400, h = 600;
    const left = window.screenX + 60;
    const top = window.screenY + 60;
    window.open(
      'https://workspace.google.com/dashboard',
      'google-apps',
      'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top + ',menubar=no,toolbar=no,location=no,status=no,scrollbars=yes,resizable=yes'
    );
  };

  return (
    <button onClick={openLauncher}
      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 8, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.15)'}
      onMouseLeave={e => e.currentTarget.style.background = 'none'}
      title="Google Workspace Apps">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="#a8c8e8">
        <rect x="1" y="1" width="6" height="6" rx="1.5"/>
        <rect x="9" y="1" width="6" height="6" rx="1.5"/>
        <rect x="17" y="1" width="6" height="6" rx="1.5"/>
        <rect x="1" y="9" width="6" height="6" rx="1.5"/>
        <rect x="9" y="9" width="6" height="6" rx="1.5"/>
        <rect x="17" y="9" width="6" height="6" rx="1.5"/>
        <rect x="1" y="17" width="6" height="6" rx="1.5"/>
        <rect x="9" y="17" width="6" height="6" rx="1.5"/>
        <rect x="17" y="17" width="6" height="6" rx="1.5"/>
      </svg>
    </button>
  );
}
`;

fs.writeFileSync('client/src/components/AppLauncher.jsx', launcher, 'utf8');
console.log('✓ AppLauncher — opens as small popup window near the button');
console.log('  Mimics Google waffle behavior: small window, not full tab');
console.log('  User sees their actual Google Workspace dashboard');
console.log('  Click any app → opens in that popup or a new tab');
