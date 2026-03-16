const fs = require('fs');

// 1. Fix api.js — verify2fa and confirm2fa must send email
let api = fs.readFileSync('client/src/api.js', 'utf8');

api = api.replace(
  "verify2fa: (code) => request('/auth/verify-2fa', { method: 'POST', body: { code } }),",
  "verify2fa: (code, email) => request('/auth/verify-2fa', { method: 'POST', body: { code, email } }),"
);

api = api.replace(
  "confirm2fa: (code) => request('/auth/confirm-2fa', { method: 'POST', body: { code } }),",
  "confirm2fa: (code, email) => request('/auth/confirm-2fa', { method: 'POST', body: { code, email } }),"
);

fs.writeFileSync('client/src/api.js', api, 'utf8');
console.log('  ✓ api.js — verify2fa and confirm2fa now send email');

// 2. Fix LoginScreen to pass email to both verify and confirm
let login = fs.readFileSync('client/src/components/LoginScreen.jsx', 'utf8');

// Fix verify2fa call
login = login.replace(
  "const data = await api.verify2fa(code.trim());",
  "const data = await api.verify2fa(code.trim(), email.trim().toLowerCase());"
);

// Fix confirm2fa call  
login = login.replace(
  "const data = await api.confirm2fa(code.trim());",
  "const data = await api.confirm2fa(code.trim(), email.trim().toLowerCase());"
);

fs.writeFileSync('client/src/components/LoginScreen.jsx', login, 'utf8');
console.log('  ✓ LoginScreen.jsx — passes email to both 2FA calls');

// 3. Fix App.jsx Loading race — retry me() if server isn't up yet
let app = fs.readFileSync('client/src/App.jsx', 'utf8');
app = app.replace(
  `useEffect(() => {
    api.me()
      .then(data => {
        setCurrentUser(data.user);
        setScreen('regionQueue');
      })
      .catch(() => {})
      .finally(() => setAuthChecked(true));
  }, []);`,
  `useEffect(() => {
    const checkAuth = (retries = 3) => {
      api.me()
        .then(data => {
          setCurrentUser(data.user);
          setScreen('regionQueue');
          setAuthChecked(true);
        })
        .catch(() => {
          if (retries > 0) setTimeout(() => checkAuth(retries - 1), 1000);
          else setAuthChecked(true);
        });
    };
    checkAuth();
  }, []);`
);
fs.writeFileSync('client/src/App.jsx', app, 'utf8');
console.log('  ✓ App.jsx — retries auth check if server slow to start');

console.log('\nDone. Refresh browser and test login + 2FA.');
