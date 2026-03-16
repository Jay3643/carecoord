const fs = require('fs');
let api = fs.readFileSync('client/src/api.js', 'utf8');

// Add all missing methods before the gmailAuth line
const newMethods = `
  getMessages: (id) => request('/tickets/' + id + '/messages'),
  getNotes: (id) => request('/tickets/' + id + '/notes'),
  getCoordinatorsForRegion: (regionId) => request('/users?regionId=' + regionId),
  assignTicket: (id, userId) => request('/tickets/' + id + '/assign', { method: 'POST', body: { userId } }),
  changeStatus: (id, status, closeReasonId, comment) => request('/tickets/' + id + '/status', { method: 'POST', body: { status, closeReasonId, comment } }),
  sendReply: (id, body) => request('/tickets/' + id + '/reply', { method: 'POST', body: { body } }),
  addTag: (id, tagId) => request('/tickets/' + id + '/tags', { method: 'POST', body: { tagId } }),
  removeTag: (id, tagId) => request('/tickets/' + id + '/tags/' + tagId, { method: 'DELETE' }),
  changeRegion: (id, regionId) => request('/tickets/' + id + '/region', { method: 'POST', body: { regionId } }),`;

if (!api.includes('getMessages:')) {
  api = api.replace(
    "  gmailAuth:",
    newMethods + "\n  gmailAuth:"
  );
}

fs.writeFileSync('client/src/api.js', api, 'utf8');
console.log('✓ api.js — added 9 missing methods for TicketDetail');

// Also add server route for coordinators by region
let index = fs.readFileSync('server/index.js', 'utf8');
if (!index.includes('regionId')) {
  index = index.replace(
    "app.get('/api/users', (req, res) => {",
    `app.get('/api/users', (req, res) => {
  const regionId = req.query.regionId;
  if (regionId) {
    try {
      const { getDb } = require('./database');
      const users = getDb().prepare('SELECT u.id, u.name, u.email, u.role, u.avatar FROM users u JOIN user_regions ur ON ur.user_id = u.id WHERE ur.region_id = ? AND u.is_active = 1').all(regionId);
      return res.json({ users });
    } catch(e) { return res.json({ users: [] }); }
  }`
  );
  fs.writeFileSync('server/index.js', index, 'utf8');
  console.log('✓ index.js — /api/users?regionId= now works');
}

console.log('Done. Refresh browser, click the ticket.');
