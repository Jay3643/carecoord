const BASE = '/api';

const cache = {};
function cached(key, ttlMs, fn) {
  const entry = cache[key];
  if (entry && Date.now() - entry.ts < ttlMs) return Promise.resolve(entry.data);
  return fn().then(data => { cache[key] = { data, ts: Date.now() }; return data; });
}
function invalidate(prefix) {
  Object.keys(cache).forEach(k => { if (k.startsWith(prefix)) delete cache[k]; });
}
export function clearCache(prefix) { if (prefix) invalidate(prefix); else Object.keys(cache).forEach(k => delete cache[k]); }

async function request(path, options = {}) {
  const config = { method: options.method || 'GET', headers: {}, credentials: 'include' };
  if (options.body) { config.headers['Content-Type'] = 'application/json'; config.body = JSON.stringify(options.body); }
  const res = await fetch(BASE + path, config);
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch(e) { data = {}; }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export const api = {
  login: (email, pw) => request('/auth/login', { method: 'POST', body: { email, password: pw } }),
  verify2fa: (code, email) => request('/auth/verify-2fa', { method: 'POST', body: { code, email } }),
  setup2fa: () => request('/auth/setup-2fa', { method: 'POST' }),
  confirm2fa: (code, email) => request('/auth/confirm-2fa', { method: 'POST', body: { code, email } }),
  changePassword: (pw) => request('/auth/change-password', { method: 'POST', body: { newPassword: pw } }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  me: () => request('/auth/me'),
  getTickets: (p) => request('/tickets' + (p ? '?' + new URLSearchParams(p) : '')),
  getRegionTickets: (id) => request('/tickets/region/' + id),
  getMyTickets: () => request('/tickets/my'),
  getTicket: (id) => request('/tickets/' + id),
  claimTicket: (id) => request('/tickets/' + id + '/claim', { method: 'POST' }),
  updateTicket: (id, d) => request('/tickets/' + id, { method: 'PUT', body: d }),
  addMessage: (id, d) => request('/tickets/' + id + '/messages', { method: 'POST', body: d }),
  addNote: (id, d) => request('/tickets/' + id + '/notes', { method: 'POST', body: d }),
  createTicket: (d) => request('/tickets', { method: 'POST', body: d }),
  getRegions: () => cached('regions', 300000, () => request('/regions')),
  getUsers: () => cached('users', 300000, () => request('/users')),
  getDashboard: () => request('/dashboard'),
  getBirdsEye: () => request('/tickets/birds-eye'),
  getDashboardSummary: () => request('/dashboard/summary'),
  getDashboardByRegion: () => request('/dashboard/by-region'),
  getDashboardByCoordinator: () => request('/dashboard/by-coordinator'),
  getAuditLog: (type, limit) => request('/audit?type=' + encodeURIComponent(type || 'all') + '&limit=' + (limit || 50)),
  getTags: () => cached('tags', 300000, () => request('/tags').catch(() => ({ tags: [] }))),
  getCloseReasons: () => cached('reasons', 300000, () => request('/close-reasons').catch(() => ({ reasons: [] }))),
  bulkReassign: (from, to) => request('/tickets/bulk/reassign', { method: 'POST', body: { fromUserId: from, toUserId: to } }),
  adminGetUsers: () => request('/admin/users'),
  adminCreateUser: (d) => request('/admin/users', { method: 'POST', body: d }),
  adminUpdateUser: (id, d) => request('/admin/users/' + id, { method: 'PUT', body: d }),
  adminDeleteUser: (id) => request('/admin/users/' + id, { method: 'DELETE' }),
  adminReactivateUser: (id) => request('/admin/users/' + id + '/reactivate', { method: 'POST' }),
  adminResetPassword: (id) => request('/admin/users/' + id + '/reset-password', { method: 'POST' }),
  adminSetUserRegions: (id, rids) => request('/admin/users/' + id + '/regions', { method: 'POST', body: { regionIds: rids } }),
  adminGetRegions: () => request('/admin/regions'),
  adminCreateRegion: (d) => request('/admin/regions', { method: 'POST', body: d }),
  adminUpdateRegion: (id, d) => request('/admin/regions/' + id, { method: 'PUT', body: d }),
  adminDeleteRegion: (id) => request('/admin/regions/' + id, { method: 'DELETE' }),

  getAttachments: (id) => request('/tickets/' + id + '/attachments'),
  downloadAttachment: (ticketId, attId) => '/api/tickets/' + ticketId + '/attachments/' + attId + '/download',
  getMessages: (id) => request('/tickets/' + id + '/messages'),
  getNotes: (id) => request('/tickets/' + id + '/notes'),
  getCoordinatorsForRegion: (regionId) => request('/users?regionId=' + regionId),
  assignTicket: (id, userId) => request('/tickets/' + id + '/assign', { method: 'POST', body: { userId } }),
  changeStatus: (id, status, closeReasonId, comment) => request('/tickets/' + id + '/status', { method: 'POST', body: { status, closeReasonId, comment } }),
  sendReply: (id, body) => request('/tickets/' + id + '/reply', { method: 'POST', body: { body } }),
  addTag: (id, tagId) => request('/tickets/' + id + '/tags', { method: 'POST', body: { tagId } }),
  removeTag: (id, tagId) => request('/tickets/' + id + '/tags/' + tagId, { method: 'DELETE' }),
  changeRegion: (id, regionId) => request('/tickets/' + id + '/region', { method: 'POST', body: { regionId } }),
  bulkPushToQueue: (gmailMessageIds, regionId) => request('/gmail/bulk-push', { method: 'POST', body: { gmailMessageIds, regionId } }),
  bulkPullFromQueue: (ticketIds) => request('/gmail/bulk-pull', { method: 'POST', body: { ticketIds } }),
  pushToQueue: (gmailMessageId, regionId) => request('/gmail/push-to-queue', { method: 'POST', body: { gmailMessageId, regionId } }),
  pullFromQueue: (ticketId) => request('/gmail/pull-from-queue', { method: 'POST', body: { ticketId } }),
  sendInvite: (data) => request('/auth/invite', { method: 'POST', body: data }),
  verifyInvite: (token) => request('/auth/invite/' + token),
  acceptInvite: (token, password) => request('/auth/invite/' + token + '/accept', { method: 'POST', body: { password } }),
  confirmSetup2fa: (email, code) => request('/auth/invite/confirm-2fa', { method: 'POST', body: { email, code } }),
  getInvitations: () => request('/auth/invitations'),
  resendInvite: (id) => request('/auth/invite/' + id + '/resend', { method: 'POST' }),
  revokeInvite: (id) => request('/auth/invite/' + id, { method: 'DELETE' }),
  adminConnectWorkspace: (userId) => request('/gmail/admin-auth/' + userId),
  adminWorkspaceStatus: (userId) => request('/gmail/admin-status/' + userId),
  adminDisconnectWorkspace: (userId) => request('/gmail/admin-disconnect/' + userId, { method: 'POST' }),
  gmailAuth: () => request('/gmail/auth'),
  getGmailLabels: () => request('/gmail/labels'),
  chatChannels: () => request('/chat/channels'),
  chatCreateChannel: (data) => request('/chat/channels', { method: 'POST', body: JSON.stringify(data) }),
  chatMessages: (channelId, before) => request('/chat/channels/' + channelId + '/messages' + (before ? '?before=' + before : '')),
  chatSend: (channelId, data) => request('/chat/channels/' + channelId + '/messages', { method: 'POST', body: JSON.stringify(data) }),
  chatMarkRead: (channelId) => request('/chat/channels/' + channelId + '/read', { method: 'POST' }),
  chatUnread: () => request('/chat/unread'),
  chatTicketChannel: (ticketId) => request('/chat/ticket-channel', { method: 'POST', body: JSON.stringify({ ticketId }) }),
  gmailStatus: () => cached('gmailStatus', 60000, () => request('/gmail/status')),
  gmailDisconnect: () => request('/gmail/disconnect', { method: 'POST' }),
  gmailSync: () => request('/gmail/sync', { method: 'POST' }),
  gmailAutoSync: () => request('/gmail/auto-sync?t=' + Date.now()),
  gmailFilters: () => request('/gmail/filters'),
  gmailAddFilter: (d) => request('/gmail/filters', { method: 'POST', body: d }),
  gmailDeleteFilter: (id) => request('/gmail/filters/' + id, { method: 'DELETE' }),
  gmailAccounts: () => request('/gmail/accounts'),
  gmailPersonal: (f, q, m) => cached('gmail:'+f+':'+q, 30000, () => request('/gmail/personal?folder='+(f||'INBOX')+'&q='+encodeURIComponent(q||'')+'&max='+(m||20))),
  gmailPersonalMsg: (id) => request('/gmail/personal/' + id),
  gmailPersonalSend: (d) => request('/gmail/personal/send', { method: 'POST', body: d }),
  calendarEvents: (min, max) => cached('cal:'+min+':'+max, 30000, () => request('/gmail/calendar/events?timeMin='+(min||'')+'&timeMax='+(max||''))),
  calendarCreate: (d) => request('/gmail/calendar/events', { method: 'POST', body: d }),
  calendarDelete: (id) => request('/gmail/calendar/events/' + id, { method: 'DELETE' }),
  driveFiles: (q, fid, pt) => cached('drive:'+q+':'+fid, 30000, () => request('/gmail/drive/files?q='+encodeURIComponent(q||'')+(fid?'&folderId='+fid:'')+(pt?'&pageToken='+pt:''))),
  driveShared: () => request('/gmail/drive/shared'),
};
