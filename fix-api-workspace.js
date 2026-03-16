// fix-api-workspace.js
const fs = require('fs');
const path = require('path');

const apiPath = path.join(__dirname, 'client', 'src', 'api.js');
let api = fs.readFileSync(apiPath, 'utf8');

// Remove all old gmail methods
api = api.replace(
  /gmailAuth:[\s\S]*?gmailLabels:[^,]*,/,
  `// Google Workspace
  gmailAuth: () => request('/gmail/auth'),
  gmailStatus: () => request('/gmail/status'),
  gmailDisconnect: () => request('/gmail/disconnect', { method: 'POST' }),
  gmailSync: () => request('/gmail/sync', { method: 'POST' }),
  gmailReply: (ticketId, body) => request('/gmail/reply', { method: 'POST', body: { ticketId, body } }),
  gmailFilters: () => request('/gmail/filters'),
  gmailAddFilter: (data) => request('/gmail/filters', { method: 'POST', body: data }),
  gmailDeleteFilter: (id) => request('/gmail/filters/' + id, { method: 'DELETE' }),
  gmailAccounts: () => request('/gmail/accounts'),
  // Personal inbox
  gmailPersonal: (folder, q, max) => request('/gmail/personal?folder=' + (folder||'INBOX') + '&q=' + encodeURIComponent(q||'') + '&max=' + (max||20)),
  gmailPersonalMsg: (id) => request('/gmail/personal/' + id),
  gmailPersonalSend: (data) => request('/gmail/personal/send', { method: 'POST', body: data }),
  // Calendar
  calendarEvents: (timeMin, timeMax) => request('/gmail/calendar/events?timeMin=' + (timeMin||'') + '&timeMax=' + (timeMax||'')),
  calendarCreate: (data) => request('/gmail/calendar/events', { method: 'POST', body: data }),
  calendarDelete: (id) => request('/gmail/calendar/events/' + id, { method: 'DELETE' }),
  // Drive
  driveFiles: (q, folderId, pageToken) => request('/gmail/drive/files?q=' + encodeURIComponent(q||'') + (folderId ? '&folderId='+folderId : '') + (pageToken ? '&pageToken='+pageToken : '')),
  driveShared: () => request('/gmail/drive/shared'),`
);

fs.writeFileSync(apiPath, api, 'utf8');
console.log('✓ api.js — all workspace methods added');
console.log('Refresh browser.');
