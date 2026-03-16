// rewrite-api.js
const fs = require('fs');
const path = require('path');

const apiPath = path.join(__dirname, 'client', 'src', 'api.js');

// Read existing to find the base URL pattern
const old = fs.readFileSync(apiPath, 'utf8');
const baseMatch = old.match(/const BASE = ['"]([^'"]*)['"]/);
const base = baseMatch ? baseMatch[1] : '/api';

fs.writeFileSync(apiPath, `const BASE = '${base}';

async function request(path, options = {}) {
  const url = BASE + path;
  const config = {
    method: options.method || 'GET',
    headers: {},
    credentials: 'include',
  };
  if (options.body) {
    config.headers['Content-Type'] = 'application/json';
    config.body = JSON.stringify(options.body);
  }
  const res = await fetch(url, config);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export const api = {
  // Auth
  login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password } }),
  verify2fa: (code) => request('/auth/verify-2fa', { method: 'POST', body: { code } }),
  setup2fa: () => request('/auth/setup-2fa', { method: 'POST' }),
  confirm2fa: (code) => request('/auth/confirm-2fa', { method: 'POST', body: { code } }),
  changePassword: (newPassword) => request('/auth/change-password', { method: 'POST', body: { newPassword } }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  me: () => request('/auth/me'),

  // Tickets
  getRegionTickets: (regionId) => request('/tickets/region/' + regionId),
  getMyTickets: () => request('/tickets/my'),
  getTicket: (id) => request('/tickets/' + id),
  claimTicket: (id) => request('/tickets/' + id + '/claim', { method: 'POST' }),
  updateTicket: (id, data) => request('/tickets/' + id, { method: 'PUT', body: data }),
  addMessage: (id, data) => request('/tickets/' + id + '/messages', { method: 'POST', body: data }),
  addNote: (id, data) => request('/tickets/' + id + '/notes', { method: 'POST', body: data }),
  createTicket: (data) => request('/tickets', { method: 'POST', body: data }),

  // Regions + Users
  getRegions: () => request('/regions'),
  getUsers: () => request('/users'),

  // Dashboard
  getDashboard: () => request('/dashboard'),

  // Audit
  getAuditLog: () => request('/audit'),

  // Admin
  adminGetUsers: () => request('/admin/users'),
  adminCreateUser: (data) => request('/admin/users', { method: 'POST', body: data }),
  adminUpdateUser: (id, data) => request('/admin/users/' + id, { method: 'PUT', body: data }),
  adminDeleteUser: (id) => request('/admin/users/' + id, { method: 'DELETE' }),
  adminReactivateUser: (id) => request('/admin/users/' + id + '/reactivate', { method: 'POST' }),
  adminResetPassword: (id) => request('/admin/users/' + id + '/reset-password', { method: 'POST' }),
  adminSetUserRegions: (id, regionIds) => request('/admin/users/' + id + '/regions', { method: 'POST', body: { regionIds } }),
  adminGetRegions: () => request('/admin/regions'),
  adminCreateRegion: (data) => request('/admin/regions', { method: 'POST', body: data }),
  adminUpdateRegion: (id, data) => request('/admin/regions/' + id, { method: 'PUT', body: data }),
  adminDeleteRegion: (id) => request('/admin/regions/' + id, { method: 'DELETE' }),

  // Google Workspace
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
  gmailPersonal: (folder, q, max) => request('/gmail/personal?folder=' + (folder || 'INBOX') + '&q=' + encodeURIComponent(q || '') + '&max=' + (max || 20)),
  gmailPersonalMsg: (id) => request('/gmail/personal/' + id),
  gmailPersonalSend: (data) => request('/gmail/personal/send', { method: 'POST', body: data }),

  // Calendar
  calendarEvents: (timeMin, timeMax) => request('/gmail/calendar/events?timeMin=' + (timeMin || '') + '&timeMax=' + (timeMax || '')),
  calendarCreate: (data) => request('/gmail/calendar/events', { method: 'POST', body: data }),
  calendarDelete: (id) => request('/gmail/calendar/events/' + id, { method: 'DELETE' }),

  // Drive
  driveFiles: (q, folderId, pageToken) => request('/gmail/drive/files?q=' + encodeURIComponent(q || '') + (folderId ? '&folderId=' + folderId : '') + (pageToken ? '&pageToken=' + pageToken : '')),
  driveShared: () => request('/gmail/drive/shared'),
};
`, 'utf8');

console.log('✓ api.js — clean rewrite with all methods');
console.log('Refresh browser.');
