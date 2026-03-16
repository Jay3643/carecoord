const fs = require('fs');
let f = fs.readFileSync('client/src/components/Dashboard.jsx', 'utf8');

// The file is a mess with duplicates. Find the clean BirdsEyeView (first one) and the export default function Dashboard
// Then rebuild the file properly

// 1. Extract the clean BirdsEyeView function (first occurrence, ends before the broken `) {` fragment)
const beStart = f.indexOf('function BirdsEyeView');
const beBodyStart = f.indexOf('{', beStart);
let depth = 0, beEnd = beBodyStart;
for (let i = beBodyStart; i < f.length; i++) {
  if (f[i] === '{') depth++;
  if (f[i] === '}') { depth--; if (depth === 0) { beEnd = i + 1; break; } }
}
const birdsEye = f.substring(beStart, beEnd);

// 2. Extract the export default function Dashboard
const dashStart = f.indexOf('export default function Dashboard');
const dashBody = f.substring(dashStart);

// 3. Now fix the Dashboard function - remove duplicate dashTab, duplicate tab buttons, duplicate birdsEye renders, duplicate closing divs
let dash = dashBody;

// Remove duplicate dashTab state
dash = dash.replace(
  "const [dashTab, setDashTab] = useState('overview');\n  const [dashTab, setDashTab] = useState('overview');",
  "const [dashTab, setDashTab] = useState('overview');"
);

// Remove duplicate tab buttons block (keep only one)
const tabBlock = `<div style={{ display: 'flex', gap: 4, background: '#dde8f2', borderRadius: 8, padding: 3, border: '1px solid #c0d0e4' }}>
          {[{ key: 'overview', label: 'Overview' }, { key: 'birdsEye', label: "Bird's Eye" }].map(t => (
            <button key={t.key} onClick={() => setDashTab(t.key)}
              style={{ padding: '6px 16px', borderRadius: 6, border: 'none', background: dashTab === t.key ? '#1a5e9a' : 'transparent', color: dashTab === t.key ? '#fff' : '#5a7a8a', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              {t.label}
            </button>
          ))}
        </div>`;
// Find both occurrences and remove the second
const firstTab = dash.indexOf(tabBlock);
const secondTab = dash.indexOf(tabBlock, firstTab + tabBlock.length);
if (secondTab > -1) {
  dash = dash.substring(0, secondTab) + dash.substring(secondTab + tabBlock.length);
}

// Remove duplicate birdsEye render blocks - keep only the first
const beRender = `{dashTab === 'birdsEye' && (
        <BirdsEyeView currentUser={currentUser} allUsers={allUsers} onOpenTicket={onOpenTicket} showToast={showToast} />
      )}`;
const firstBE = dash.indexOf(beRender);
const secondBE = dash.indexOf(beRender, firstBE + beRender.length);
if (secondBE > -1) {
  dash = dash.substring(0, secondBE) + dash.substring(secondBE + beRender.length);
}

// Fix the broken overview section: remove the bad `{dashTab === 'overview' && {dashTab === 'birdsEye'` line
dash = dash.replace(
  `{dashTab === 'overview' && {dashTab === 'birdsEye' && (
        <BirdsEyeView currentUser={currentUser} allUsers={allUsers} onOpenTicket={onOpenTicket} showToast={showToast} />
      )}

      {dashTab === 'overview' && <div`,
  `{dashTab === 'overview' && <div`
);

// Fix double closing </div>} 
dash = dash.replace(
  `      </div>}

      </div>}

      {/* Bulk modal */}`,
  `      </div>}

      {/* Bulk modal */}`
);

// 4. Rebuild the file: imports + BirdsEyeView + Dashboard
const imports = `import React, { useState, useEffect } from 'react';
import { api } from '../api';
import { fmt } from '../utils';
import Icon from './Icons';
import { StatusBadge, Avatar } from './ui';

`;

const result = imports + birdsEye + '\n\n' + dash;
fs.writeFileSync('client/src/components/Dashboard.jsx', result, 'utf8');
console.log('✓ Dashboard.jsx cleaned — no duplicates');
console.log('Refresh browser.');
