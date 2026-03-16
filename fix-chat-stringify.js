const fs = require('fs');
let api = fs.readFileSync('client/src/api.js', 'utf8');

api = api.replace(
  "chatCreateChannel: (data) => request('/chat/channels', { method: 'POST', body: JSON.stringify(data) }),",
  "chatCreateChannel: (data) => request('/chat/channels', { method: 'POST', body: data }),"
);

api = api.replace(
  "chatSend: (channelId, data) => request('/chat/channels/' + channelId + '/messages', { method: 'POST', body: JSON.stringify(data) }),",
  "chatSend: (channelId, data) => request('/chat/channels/' + channelId + '/messages', { method: 'POST', body: data }),"
);

api = api.replace(
  "chatTicketChannel: (ticketId) => request('/chat/ticket-channel', { method: 'POST', body: JSON.stringify({ ticketId }) }),",
  "chatTicketChannel: (ticketId) => request('/chat/ticket-channel', { method: 'POST', body: { ticketId } }),"
);

fs.writeFileSync('client/src/api.js', api, 'utf8');

const check = fs.readFileSync('client/src/api.js', 'utf8');
const still = check.includes("body: JSON.stringify(data)") || check.includes("body: JSON.stringify({ ticketId })");
console.log(still ? '✗ Still has double stringify' : '✓ Fixed all 3 chat methods');
