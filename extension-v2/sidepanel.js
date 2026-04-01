// Seniority Connect — Side Panel Controller

const APP_URL = 'https://carecoord-o3en.onrender.com';

const frame = document.getElementById('app-frame');
const loading = document.getElementById('loading');
const offlineBanner = document.getElementById('offline-banner');
const btnRefresh = document.getElementById('btn-refresh');
const btnPopout = document.getElementById('btn-popout');
const btnLogout = document.getElementById('btn-logout');

// Load the app
function loadApp() {
  loading.classList.remove('hidden');
  frame.src = APP_URL;
}

// Frame loaded
frame.addEventListener('load', () => {
  loading.classList.add('hidden');
});

// Refresh button
btnRefresh.addEventListener('click', () => {
  loading.classList.remove('hidden');
  frame.src = APP_URL + '?t=' + Date.now();
});

// Pop out to new window
btnPopout.addEventListener('click', () => {
  window.open(APP_URL, '_blank', 'width=1200,height=800');
});

// Logout
btnLogout.addEventListener('click', async () => {
  try {
    await fetch(APP_URL + '/api/auth/logout', { method: 'POST', credentials: 'include' });
  } catch (e) {}
  loading.classList.remove('hidden');
  frame.src = APP_URL + '?t=' + Date.now();
});

// Online/offline detection
function updateOnlineStatus() {
  if (navigator.onLine) {
    offlineBanner.classList.remove('show');
    if (!frame.src || frame.src === 'about:blank') loadApp();
  } else {
    offlineBanner.classList.add('show');
  }
}

window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);

// Initial load
updateOnlineStatus();
loadApp();
