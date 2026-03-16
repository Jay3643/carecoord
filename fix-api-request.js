// fix-api-request.js
const fs = require('fs');
const path = require('path');

const apiPath = path.join(__dirname, 'client', 'src', 'api.js');
let api = fs.readFileSync(apiPath, 'utf8');

// Replace the request function with one that handles empty responses
api = api.replace(
  /async function request\(path, options = \{\}\) \{[\s\S]*?return data;\s*\}/,
  `async function request(path, options = {}) {
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
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (e) {
    if (!res.ok) throw new Error('Request failed: ' + res.status);
    data = {};
  }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}`
);

fs.writeFileSync(apiPath, api, 'utf8');
console.log('✓ api.js — request function now handles empty/non-JSON responses');
