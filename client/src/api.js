const BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
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

  // Reference data
  getRegions: () => request('/ref/regions'),
  getUsers: () => request('/ref/users'),
  getTags: () => request('/ref/tags'),
  getCloseReasons: () => request('/ref/close-reasons'),
  getCoordinatorsForRegion: (regionId) => request(`/ref/coordinators-for-region/${regionId}`),

  // Tickets
  getTickets: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/tickets?${qs}`);
  },
  createTicket: (data) => request('/tickets', { method: 'POST', body: data }),
  getTicket: (id) => request(`/tickets/${id}`),
  getMessages: (ticketId) => request(`/tickets/${ticketId}/messages`),
  getNotes: (ticketId) => request(`/tickets/${ticketId}/notes`),
  assignTicket: (id, userId) => request(`/tickets/${id}/assign`, { method: 'POST', body: { userId } }),
  changeStatus: (id, status, closeReasonId, closeComment) =>
    request(`/tickets/${id}/status`, { method: 'POST', body: { status, closeReasonId, closeComment } }),
  sendReply: (id, body) => request(`/tickets/${id}/reply`, { method: 'POST', body: { body } }),
  addNote: (id, body) => request(`/tickets/${id}/notes`, { method: 'POST', body: { body } }),
  addTag: (id, tagId) => request(`/tickets/${id}/tags`, { method: 'POST', body: { tagId } }),
  removeTag: (id, tagId) => request(`/tickets/${id}/tags/${tagId}`, { method: 'DELETE' }),
  changeRegion: (id, regionId) => request(`/tickets/${id}/region`, { method: 'POST', body: { regionId } }),
  bulkReassign: (fromUserId, toUserId) =>
    request('/tickets/bulk/reassign', { method: 'POST', body: { fromUserId, toUserId } }),

  // Dashboard
  getDashboardSummary: () => request('/dashboard/summary'),
  getDashboardByRegion: () => request('/dashboard/by-region'),
  getDashboardByCoordinator: () => request('/dashboard/by-coordinator'),

  // Audit
  getAuditLog: (filter, limit) => {
    const params = new URLSearchParams();
    if (filter && filter !== 'all') params.set('filter', filter);
    if (limit) params.set('limit', limit);
    return request(`/audit?${params}`);
  },

  // Admin
  adminGetUsers: () => request('/admin/users'),
  adminCreateUser: (data) => request('/admin/users', { method: 'POST', body: data }),
  adminUpdateUser: (id, data) => request(`/admin/users/${id}`, { method: 'PUT', body: data }),
  adminDeleteUser: (id) => request(`/admin/users/${id}`, { method: 'DELETE' }),
  adminReactivateUser: (id) => request(`/admin/users/${id}/reactivate`, { method: 'POST' }),
  adminResetPassword: (id) => request(`/admin/users/${id}/reset-password`, { method: 'POST' }),
  adminSetUserRegions: (id, regionIds) => request(`/admin/users/${id}/regions`, { method: 'POST', body: { regionIds } }),
  adminGetRegions: () => request('/admin/regions'),
  adminCreateRegion: (data) => request('/admin/regions', { method: 'POST', body: data }),
  adminUpdateRegion: (id, data) => request(`/admin/regions/${id}`, { method: 'PUT', body: data }),
  adminDeleteRegion: (id) => request(`/admin/regions/${id}`, { method: 'DELETE' }),
};
