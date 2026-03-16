const fs = require('fs');

const launcher = `import React from 'react';

export default function AppLauncher() {
  return (
    <a href="https://workspace.google.com/dashboard" target="_blank" rel="noopener noreferrer"
      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 8, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}
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
    </a>
  );
}
`;

fs.writeFileSync('client/src/components/AppLauncher.jsx', launcher, 'utf8');
console.log('✓ AppLauncher — opens Google Workspace dashboard directly');
console.log('  Click the grid icon → opens workspace.google.com in new tab');
console.log('  User sees their actual Google app launcher with real icons');
