// ── Seniority CareCoord Side Panel ──

let state = {
  loggedIn: false, user: null, serverUrl: '',
  tab: 'patient',
  overviewOpen: true, chartScanOpen: false,
  patientData: null, clinicalSnapshot: null,
  tickets: [], aiMessages: [], aiLoading: false,
  loading: false, chartScanning: false,
  scrapeProgress: '', scrapeLog: [],
  scanStartDate: '', scanEndDate: '',
  chartAiMessages: [], chartAiLoading: false,
  fullChartCache: null, fullChartCachePatient: '',
};

const app = document.getElementById('app');
const statusText = document.getElementById('status-text');
const toastEl = document.getElementById('toast');

// ── Storage ──
async function loadSettings() {
  return new Promise(r => { chrome.storage.local.get(['serverUrl'], (d) => { state.serverUrl = d.serverUrl || 'https://carecoord-o3en.onrender.com'; r(d); }); });
}
async function saveSettings() { return new Promise(r => chrome.storage.local.set({ serverUrl: state.serverUrl }, r)); }
function savePatientData() { chrome.storage.local.set({ patientData: state.patientData, clinicalSnapshot: state.clinicalSnapshot, fullChartCache: state.fullChartCache, fullChartCachePatient: state.fullChartCachePatient }); }
async function loadPatientData() {
  return new Promise(r => { chrome.storage.local.get(['patientData', 'clinicalSnapshot', 'fullChartCache', 'fullChartCachePatient'], (d) => {
    if (d.patientData) state.patientData = d.patientData;
    if (d.clinicalSnapshot) state.clinicalSnapshot = d.clinicalSnapshot;
    if (d.fullChartCache) state.fullChartCache = d.fullChartCache;
    if (d.fullChartCachePatient) state.fullChartCachePatient = d.fullChartCachePatient;
    r();
  }); });
}

// ── API ──
async function apiRequest(path, options = {}) {
  const config = { method: options.method || 'GET', headers: {}, credentials: 'include' };
  if (options.body) { config.headers['Content-Type'] = 'application/json'; config.body = JSON.stringify(options.body); }
  const res = await fetch(state.serverUrl + '/api' + path, config);
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch(e) { data = {}; }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function showToast(msg) { toastEl.textContent = msg; toastEl.style.display = 'block'; setTimeout(() => toastEl.style.display = 'none', 3000); }

// ── Auth ──
async function checkAuth() {
  try { const d = await apiRequest('/auth/me'); state.user = d.user; state.loggedIn = true; statusText.textContent = 'Connected — ' + d.user.name; return true; }
  catch(e) { state.loggedIn = false; state.user = null; statusText.textContent = 'Not connected'; return false; }
}
async function login(email, password) {
  try {
    const d = await apiRequest('/auth/login', { method: 'POST', body: { email, password } });
    if (d.step === 'done') { state.user = d.user; state.loggedIn = true; statusText.textContent = 'Connected — ' + d.user.name; render(); loadTickets(); }
    else if (d.step === '2fa') { showToast('2FA required'); render2FA(email); }
  } catch(e) { showToast(e.message); }
}
async function verify2FA(code, email) {
  try { const d = await apiRequest('/auth/verify-2fa', { method: 'POST', body: { code, email } }); if (d.step === 'done') { state.user = d.user; state.loggedIn = true; statusText.textContent = 'Connected — ' + d.user.name; render(); loadTickets(); } } catch(e) { showToast(e.message); }
}
async function loadTickets() { try { const d = await apiRequest('/tickets?status=all&queue=personal'); state.tickets = (d.tickets || []).filter(t => t.status !== 'CLOSED').slice(0, 30); render(); } catch(e) {} }
async function searchTickets(query) { try { const d = await apiRequest('/tickets?search=' + encodeURIComponent(query) + '&status=all'); state.tickets = (d.tickets || []).slice(0, 30); render(); } catch(e) {} }

// ── PF Communication ──
function scrapePatient() {
  state.loading = true; render();
  chrome.runtime.sendMessage({ type: 'SCRAPE_PATIENT' }, (response) => {
    state.loading = false;
    if (response && response.success) { state.patientData = response.data; savePatientData(); if (response.data.patientName) searchTickets(response.data.patientName); }
    else showToast('Could not read patient data');
    render();
  });
}
function liveScanPage() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'SCRAPE_PATIENT' }, (response) => {
      if (response && response.success) { state.patientData = response.data; savePatientData(); resolve(response.data); }
      else resolve(state.patientData || null);
    });
    setTimeout(() => resolve(state.patientData || null), 3000);
  });
}
function navigateAndRead(section) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'NAVIGATE_AND_READ', section }, (response) => {
      if (response && response.success) resolve(response.text);
      else resolve(null);
    });
    setTimeout(() => resolve(null), 8000);
  });
}

// ── Chart Scan ──
async function startChartScan() {
  state.chartScanning = true; state.clinicalSnapshot = null; state.chartAiMessages = []; state.scrapeLog = []; state.scrapeProgress = 'Starting...'; render();
  let sd = state.scanStartDate || null; let ed = state.scanEndDate || null;
  if (sd && ed && new Date(sd) > new Date(ed)) { const tmp = sd; sd = ed; ed = tmp; state.scanStartDate = sd; state.scanEndDate = ed; }
  chrome.runtime.sendMessage({ type: 'CHART_SCAN', startDate: sd, endDate: ed });
}
async function generateSnapshot(chartData) {
  state.scrapeProgress = 'Generating clinical overview...'; render();
  try { const d = await apiRequest('/ai/clinical-snapshot', { method: 'POST', body: { chartData } }); state.clinicalSnapshot = d.snapshot; savePatientData(); state.chartAiMessages = []; }
  catch(e) { state.clinicalSnapshot = 'Error: ' + (e.message || 'Failed'); }
  state.chartScanning = false; state.scrapeProgress = ''; render();
}
async function pushSnapshotToTicket(ticketId) {
  if (!state.clinicalSnapshot) return;
  try { await apiRequest('/tickets/' + ticketId + '/notes', { method: 'POST', body: { body: 'Clinical Overview from Practice Fusion:\n\n' + state.clinicalSnapshot } }); showToast('Pushed to ticket'); } catch(e) { showToast(e.message); }
}
async function pushDataToTicket(ticketId) {
  if (!state.patientData) return;
  const pd = state.patientData;
  let note = 'Patient Data from Practice Fusion:\n\n';
  if (pd.patientName) note += 'Patient: ' + pd.patientName + '\n';
  if (pd.dob) note += 'DOB: ' + pd.dob + '\n';
  if (pd.insurance) note += 'Insurance: ' + pd.insurance + '\n';
  if (pd.phone) note += 'Phone: ' + pd.phone + '\n';
  if (pd.diagnoses?.length) note += '\nDiagnoses:\n' + pd.diagnoses.map(d => '  - ' + d).join('\n') + '\n';
  if (pd.medications?.length) note += '\nMedications:\n' + pd.medications.map(m => '  - ' + m).join('\n') + '\n';
  if (pd.allergies?.length) note += '\nAllergies: ' + pd.allergies.join(', ') + '\n';
  try { await apiRequest('/tickets/' + ticketId + '/notes', { method: 'POST', body: { body: note } }); showToast('Patient data pushed'); } catch(e) { showToast(e.message); }
}

// ── Full Chart Cache — scans ALL sections once, caches for all questions ──
async function ensureFullChartCache() {
  const currentPatient = state.patientData?.patientName || '';
  if (state.fullChartCache && state.fullChartCachePatient === currentPatient && currentPatient) return;

  state.fullChartCache = {};
  state.fullChartCachePatient = currentPatient;

  for (const section of ['profile', 'timeline', 'documents']) {
    state.scrapeProgress = 'Reading ' + section + '...';
    render();
    const text = await navigateAndRead(section);
    if (text) state.fullChartCache[section] = text;
  }
  state.scrapeProgress = '';
  savePatientData();
  render();
}

function buildFullContext() {
  let ctx = '';
  const pd = state.patientData;
  if (pd) {
    ctx += 'PATIENT: ' + (pd.patientName||'?') + ' | DOB: ' + (pd.dob||'?') + ' | Age: ' + (pd.age||'?') + ' | ' + (pd.gender||'') + ' | PRN: ' + (pd.prn||'') + '\n';
    ctx += 'Phone: ' + (pd.phone||'?') + ' | Insurance: ' + (pd.insurance||'?') + '\n';
    if (pd.allergies?.length) ctx += 'Allergies: ' + pd.allergies.join(', ') + '\n';
    if (pd.advanceDirectives) ctx += 'Advance Directives: ' + pd.advanceDirectives + '\n';
    if (pd.familyHistory) ctx += 'Family History: ' + pd.familyHistory + '\n';
    if (pd.diagnoses?.length) ctx += 'Diagnoses: ' + pd.diagnoses.join('; ') + '\n';
    if (pd.medications?.length) ctx += 'Medications: ' + pd.medications.join('; ') + '\n';
    if (pd.healthConcerns) ctx += 'Health Concerns: ' + pd.healthConcerns.substring(0, 600) + '\n';
    if (pd.socialHistory?.freeText) ctx += 'Social History: ' + pd.socialHistory.freeText.substring(0, 400) + '\n';
    if (pd.socialHistory?.tobacco) ctx += 'Tobacco: ' + pd.socialHistory.tobacco + '\n';
    if (pd.screenings?.length) ctx += 'Screenings: ' + pd.screenings.slice(0,5).join('; ') + '\n';
    if (pd.encounters?.length) ctx += 'Encounters: ' + pd.encounters.join('; ') + '\n';
    if (pd.encounterDetails?.length) {
      ctx += '\nEncounter Details:\n';
      for (const enc of pd.encounterDetails.slice(0, 15)) {
        ctx += '- ' + (enc.date||'?') + ' | ' + (enc.type||'') + ' | CC: ' + (enc.chiefComplaint||enc.summary?.substring(0,60)||'') + '\n';
      }
    }
  }
  // Add all cached sections
  if (state.fullChartCache) {
    for (const [section, text] of Object.entries(state.fullChartCache)) {
      if (text) ctx += '\n' + section.toUpperCase() + ' PAGE:\n' + text.substring(0, 2500) + '\n';
    }
  }
  if (state.clinicalSnapshot) ctx += '\nCLINICAL OVERVIEW:\n' + state.clinicalSnapshot.substring(0, 1000) + '\n';
  return ctx;
}

// ── AI Chat — full chart intelligence ──
async function chartAiChat(message) {
  if (!message.trim() || state.chartAiLoading) return;
  state.chartAiMessages.push({ role: 'user', content: message });
  state.chartAiLoading = true;
  render();

  // Ensure we have fresh Summary data
  await liveScanPage();
  // Ensure all sections are cached (only scans once per patient)
  await ensureFullChartCache();

  const ctx = buildFullContext();

  let fullMsg = message;
  if (state.chartAiMessages.length <= 1) {
    fullMsg = 'You are a clinical intelligence assistant for Seniority Healthcare. You have the COMPLETE patient chart from Practice Fusion below — Summary, Profile, Timeline, Documents, all medications, diagnoses, encounters, and notes.\n\nRules:\n1. Only answer based on the data below\n2. If information is not present, say "I don\'t see that in the chart data"\n3. NEVER invent clinical data\n4. When asked about care optimization, compare against clinical best practices\n5. Be specific — cite dates, medication names, and encounter details\n\nFULL CHART DATA:\n' + ctx + '\n---\nQuestion: ' + message;
  }

  try {
    const history = state.chartAiMessages.length > 1 ? state.chartAiMessages.slice(0, -1) : undefined;
    const d = await apiRequest('/ai/chat', { method: 'POST', body: { message: fullMsg, history } });
    state.chartAiMessages.push({ role: 'assistant', content: d.reply });
  } catch(e) {
    state.chartAiMessages.push({ role: 'assistant', content: 'Error: ' + e.message });
  }
  state.chartAiLoading = false;
  render();
  setTimeout(() => {
    const el = document.getElementById('chart-ai-messages');
    if (el) el.scrollTop = el.scrollHeight;
    // Also scroll the content area to keep AI visible
    const content = document.querySelector('.content');
    if (content) content.scrollTop = content.scrollHeight;
  }, 150);
}

// ── Render ──
function render() {
  if (!state.loggedIn) { renderLogin(); return; }
  let html = '<div class="tabs">';
  html += '<div class="tab ' + (state.tab === 'patient' ? 'active' : '') + '" data-tab="patient">Patient</div>';
  html += '<div class="tab ' + (state.tab === 'tickets' ? 'active' : '') + '" data-tab="tickets">Tickets</div>';
  html += '<div class="tab ' + (state.tab === 'settings' ? 'active' : '') + '" data-tab="settings">⚙</div>';
  html += '</div><div class="content">';
  if (state.tab === 'patient') html += renderPatientTab();
  else if (state.tab === 'tickets') html += renderTicketsTab();
  else if (state.tab === 'settings') html += renderSettingsTab();
  html += '</div>';
  app.innerHTML = html;
  bindEvents();
}

function renderLogin() {
  app.innerHTML = '<div class="login-screen"><img src="icons/icon128.jpg" style="width:64px;height:64px;border-radius:12px;margin-bottom:8px"><div style="font-size:16px;font-weight:700;color:#1e3a4f">Seniority CareCoord</div><div style="font-size:12px;color:#6b8299;margin-bottom:8px">Sign in to connect</div><div class="server-url"><input type="text" id="server-url" value="' + state.serverUrl + '" placeholder="Server URL"><button class="btn btn-secondary btn-small" id="save-url">Save</button></div><input type="email" id="login-email" placeholder="Email"><input type="password" id="login-password" placeholder="Password"><button class="btn btn-primary" id="login-btn" style="width:100%">Sign In</button></div>';
  document.getElementById('login-btn').addEventListener('click', () => login(document.getElementById('login-email').value, document.getElementById('login-password').value));
  document.getElementById('login-password').addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('login-btn').click(); });
  document.getElementById('save-url').addEventListener('click', () => { state.serverUrl = document.getElementById('server-url').value.replace(/\/$/, ''); saveSettings(); showToast('Saved'); });
}
function render2FA(email) {
  app.innerHTML = '<div class="login-screen"><div style="font-size:14px;font-weight:600">Enter 2FA Code</div><input type="text" id="twofa-code" placeholder="6-digit code" maxlength="6" style="text-align:center;font-size:18px;letter-spacing:4px"><button class="btn btn-primary" id="twofa-btn" style="width:100%">Verify</button></div>';
  document.getElementById('twofa-btn').addEventListener('click', () => verify2FA(document.getElementById('twofa-code').value, email));
  document.getElementById('twofa-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('twofa-btn').click(); });
}

function renderPatientTab() {
  let html = '';
  const pd = state.patientData;

  // Scanning in progress
  if (state.chartScanning) {
    html += '<div class="card" style="padding:16px"><div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><img src="icons/icon128.jpg" style="width:28px;height:28px;border-radius:4px;object-fit:contain;animation:pulse 1.5s ease-in-out infinite"><div><div style="font-size:13px;font-weight:600;color:#3d8ba8">Chart Scan</div><div style="font-size:11px;color:#6b8299">' + (state.scrapeProgress || 'Working...') + '</div></div></div>';
    html += '<div style="background:#f8fafc;border:1px solid #e8f0f8;border-radius:6px;padding:8px;max-height:150px;overflow-y:auto;font-family:monospace;font-size:10px;line-height:1.6;color:#5a7a8a">';
    for (const line of state.scrapeLog) html += '<div style="color:' + (line.includes('ERROR') ? '#d94040' : '#5a7a8a') + '">' + escapeHtml(line) + '</div>';
    html += '</div></div>';
    return html;
  }

  // 1. Patient Overview (collapsible)
  html += '<div style="border:1px solid #dde8f2;border-radius:8px;margin-bottom:8px;overflow:hidden">';
  html += '<button id="toggle-overview" style="display:flex;align-items:center;gap:8px;width:100%;padding:10px 12px;background:#f0f4f9;border:none;cursor:pointer;text-align:left;font-size:13px;font-weight:600;color:#1e3a4f">';
  html += '<span style="transform:rotate(' + (state.overviewOpen ? '90' : '0') + 'deg);font-size:10px">▶</span>Patient Overview';
  if (pd?.patientName) html += '<span style="font-size:10px;font-weight:400;color:#6b8299;margin-left:auto">' + pd.patientName + '</span>';
  html += '</button>';
  if (state.overviewOpen) {
    html += '<div style="padding:8px 12px">';
    html += '<div style="display:flex;gap:4px;margin-bottom:8px"><button class="btn btn-primary btn-small" id="scrape-btn">Read from PF</button><button class="btn btn-secondary btn-small" id="refresh-btn">Refresh</button></div>';
    if (state.loading) html += '<div class="loading">Reading...</div>';
    else if (!pd) html += '<div style="text-align:center;color:#8a9fb0;padding:12px;font-size:12px">Open a patient chart in PF and click "Read from PF"</div>';
    else {
      for (const [l, v] of [['Name', pd.patientName], ['DOB', pd.dob], ['Age', pd.age], ['Gender', pd.gender], ['Phone', pd.phone], ['Insurance', pd.insurance], ['PRN', pd.prn]]) {
        if (v) html += '<div class="field"><div class="field-label">' + l + '</div><div class="field-value">' + v + '</div></div>';
      }
      if (pd.medications?.length) html += '<div class="field"><div class="field-label">Medications</div><div class="field-value">' + pd.medications.length + ' active</div></div>';
      if (pd.diagnoses?.length) html += '<div class="field"><div class="field-label">Diagnoses</div><div class="field-value">' + pd.diagnoses.length + ' active</div></div>';
      if (pd.allergies?.length) html += '<div class="field"><div class="field-label">Allergies</div><div class="field-value">' + pd.allergies.join(', ') + '</div></div>';
      if (pd.advanceDirectives) html += '<div class="field"><div class="field-label">Directives</div><div class="field-value">' + pd.advanceDirectives + '</div></div>';
      if (state.tickets.length > 0) {
        html += '<div style="margin-top:8px;font-size:10px;font-weight:600;color:#6b8299;margin-bottom:4px">PUSH TO TICKET</div>';
        for (const t of state.tickets.slice(0, 3)) html += '<div class="ticket-row" data-push="' + t.id + '"><span class="ticket-id">' + t.id.toUpperCase() + '</span><span class="ticket-subject">' + (t.subject || '') + '</span></div>';
      }
    }
    html += '</div>';
  }
  html += '</div>';

  // 2. Chart Scan (collapsible)
  html += '<div style="border:1px solid #dde8f2;border-radius:8px;margin-bottom:8px;overflow:hidden">';
  html += '<button id="toggle-chartscan" style="display:flex;align-items:center;gap:8px;width:100%;padding:10px 12px;background:#f0f4f9;border:none;cursor:pointer;text-align:left;font-size:13px;font-weight:600;color:#1e3a4f">';
  html += '<span style="transform:rotate(' + (state.chartScanOpen ? '90' : '0') + 'deg);font-size:10px">▶</span>Chart Scan';
  if (state.clinicalSnapshot) html += '<span style="width:8px;height:8px;border-radius:50%;background:#2e7d32;margin-left:auto"></span>';
  html += '</button>';
  if (state.chartScanOpen) {
    html += '<div style="padding:8px 12px">';
    if (state.clinicalSnapshot) {
      const fromDate = state.scanStartDate ? new Date(state.scanStartDate).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : 'All';
      const toDate = state.scanEndDate ? new Date(state.scanEndDate).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : 'Present';
      html += '<div style="font-size:10px;color:#5a7a8a;margin-bottom:6px"><strong>Range:</strong> ' + fromDate + ' — ' + toDate + ' | <strong>Encounters:</strong> ' + (pd?._encountersScanned || 0) + '</div>';
      html += '<div style="font-size:12px;line-height:1.6;white-space:pre-wrap;word-break:break-word;max-height:300px;overflow-y:auto;margin-bottom:8px">' + escapeHtml(state.clinicalSnapshot) + '</div>';
      html += '<div style="display:flex;gap:4px;margin-bottom:4px"><button class="btn btn-primary btn-small" data-copy-snapshot>Copy</button>';
      if (state.tickets.length > 0) html += '<button class="btn btn-secondary btn-small" data-push-snapshot>Push to Ticket</button>';
      html += '<button class="btn btn-secondary btn-small" id="rescan-btn">Rescan</button></div>';
    } else {
      html += '<div style="display:flex;gap:4px;margin-bottom:6px"><div style="flex:1"><label style="font-size:9px;color:#8a9fb0">From</label><input type="date" id="scan-start" value="' + state.scanStartDate + '" style="width:100%;padding:4px 6px;border:1px solid #c0d0e4;border-radius:4px;font-size:11px"></div>';
      html += '<div style="flex:1"><label style="font-size:9px;color:#8a9fb0">To</label><input type="date" id="scan-end" value="' + state.scanEndDate + '" style="width:100%;padding:4px 6px;border:1px solid #c0d0e4;border-radius:4px;font-size:11px"></div></div>';
      html += '<button class="btn btn-primary btn-small" id="chart-scan-btn" style="width:100%;background:#3d8ba8">Start Chart Scan</button>';
    }
    html += '</div>';
  }
  html += '</div>';

  // 3. AI — always visible
  html += '<div class="card">';
  html += '<div class="card-title" style="display:flex;align-items:center;gap:6px"><img src="icons/icon128.jpg" style="width:16px;height:16px;border-radius:3px;object-fit:contain">Ask about this patient</div>';
  html += '<div id="chart-ai-messages" style="max-height:300px;overflow-y:auto;margin-bottom:8px">';
  if (!state.chartAiMessages?.length && !state.chartAiLoading) {
    html += '<div style="font-size:11px;color:#8a9fb0;padding:8px 0">Ask anything. On first question, the AI reads the full chart (Summary + Profile + Timeline + Documents). Try: "Is this patient\'s treatment optimized?"</div>';
  }
  for (const m of (state.chartAiMessages || [])) {
    const isUser = m.role === 'user';
    html += '<div style="display:flex;gap:6px;padding:4px 0"><div style="width:20px;height:20px;border-radius:' + (isUser?'50%':'3px') + ';background:' + (isUser?'#1a5e9a':'#52a8c7') + ';display:flex;align-items:center;justify-content:center;color:#fff;font-size:9px;font-weight:700;flex-shrink:0">' + (isUser ? (state.user?.name?.[0]||'U') : '✦') + '</div>';
    html += '<div style="flex:1;min-width:0"><div style="font-size:9px;font-weight:700;color:' + (isUser?'#1e3a4f':'#3d8ba8') + '">' + (isUser?'You':'Seniority AI') + '</div>';
    html += '<div style="font-size:13px;line-height:1.6;white-space:pre-wrap;word-break:break-word">' + escapeHtml(m.content) + '</div></div></div>';
  }
  if (state.chartAiLoading) {
    html += '<div style="display:flex;gap:6px;padding:4px 0;align-items:center"><img src="icons/icon128.jpg" style="width:20px;height:20px;border-radius:3px;animation:pulse 1.5s ease-in-out infinite">';
    html += '<span style="font-size:11px;color:#8a9fb0;font-style:italic">' + (state.scrapeProgress || 'Thinking...') + '</span></div>';
  }
  html += '</div>';
  html += '<div style="display:flex;gap:4px"><input type="text" id="chart-ai-input" placeholder="Is this patient\'s treatment optimized?" style="flex:1;padding:6px 10px;border:1px solid #c0d0e4;border-radius:16px;font-size:13px;outline:none">';
  html += '<button class="btn btn-primary btn-small" id="chart-ai-send" style="background:#52a8c7;border-radius:16px;padding:6px 12px">Ask</button></div>';
  html += '</div>';
  return html;
}

function renderTicketsTab() {
  let html = '<div style="margin-bottom:8px"><input type="text" id="ticket-search" placeholder="Search tickets..." style="width:100%;padding:8px 12px;border:1px solid #c0d0e4;border-radius:8px;font-size:12px;outline:none"></div>';
  if (state.tickets.length === 0) return html + '<div class="loading">No tickets found</div>';
  for (const t of state.tickets) {
    const sc = t.status === 'OPEN' ? 'open' : t.status === 'WAITING_ON_EXTERNAL' ? 'waiting' : 'closed';
    html += '<div class="ticket-row" data-ticket="' + t.id + '"><div style="flex:1;min-width:0"><div style="display:flex;align-items:center;gap:4px;margin-bottom:2px"><span class="ticket-id">' + t.id.toUpperCase() + '</span><span class="status-badge status-' + sc + '">' + (t.status === 'OPEN' ? 'Open' : t.status === 'WAITING_ON_EXTERNAL' ? 'Waiting' : 'Closed') + '</span></div><div class="ticket-subject">' + (t.subject || '') + '</div></div></div>';
  }
  return html;
}
function renderSettingsTab() {
  let html = '<div class="card"><div class="card-title">Connection</div>';
  html += '<div class="field"><div class="field-label">Server</div><div class="field-value">' + state.serverUrl + '</div></div>';
  html += '<div class="field"><div class="field-label">User</div><div class="field-value">' + (state.user?.name || '?') + ' (' + (state.user?.role || '?') + ')</div></div>';
  html += '<button class="btn btn-secondary btn-small" id="logout-btn" style="margin-top:8px">Log Out</button></div>';
  html += '<div class="card"><div class="card-title">Server URL</div><div class="server-url"><input type="text" id="settings-url" value="' + state.serverUrl + '"><button class="btn btn-primary btn-small" id="settings-save-url">Save</button></div></div>';
  html += '<div class="card"><div class="card-title">Chart Cache</div><div style="font-size:11px;color:#5a7a8a">' + (state.fullChartCachePatient ? 'Cached: ' + state.fullChartCachePatient + ' (' + Object.keys(state.fullChartCache || {}).length + ' sections)' : 'No cache') + '</div>';
  html += '<button class="btn btn-secondary btn-small" id="clear-cache-btn" style="margin-top:4px">Clear Cache</button></div>';
  return html;
}
function escapeHtml(text) {
  return (text||'')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^#{1,4}\s+/gm, '')        // remove markdown headers
    .replace(/\*\*([^*]+)\*\*/g, '$1')  // remove bold **text**
    .replace(/\*([^*]+)\*/g, '$1')      // remove italic *text*
    .replace(/^[-•]\s+/gm, '  ')        // replace bullet dashes with indent
    .replace(/^\d+\.\s+/gm, '  ')       // replace numbered lists with indent
    .replace(/\n/g, '<br>');
}

// ── Events ──
function bindEvents() {
  document.querySelectorAll('.tab[data-tab]').forEach(t => t.addEventListener('click', () => { state.tab = t.dataset.tab; render(); }));
  const to = document.getElementById('toggle-overview'); if (to) to.addEventListener('click', () => { state.overviewOpen = !state.overviewOpen; render(); });
  const tc = document.getElementById('toggle-chartscan'); if (tc) tc.addEventListener('click', () => { state.chartScanOpen = !state.chartScanOpen; render(); });
  const sb = document.getElementById('scrape-btn'); if (sb) sb.addEventListener('click', scrapePatient);
  const rb = document.getElementById('refresh-btn'); if (rb) rb.addEventListener('click', () => { loadTickets(); scrapePatient(); });
  const csb = document.getElementById('chart-scan-btn'); if (csb) csb.addEventListener('click', () => { state.scanStartDate = document.getElementById('scan-start')?.value || ''; state.scanEndDate = document.getElementById('scan-end')?.value || ''; startChartScan(); });
  const rescan = document.getElementById('rescan-btn'); if (rescan) rescan.addEventListener('click', () => { state.clinicalSnapshot = null; state.chartAiMessages = []; savePatientData(); render(); });
  document.querySelectorAll('[data-copy-snapshot]').forEach(el => el.addEventListener('click', () => { if (state.clinicalSnapshot) { navigator.clipboard.writeText(state.clinicalSnapshot); showToast('Copied'); } }));
  document.querySelectorAll('[data-push-snapshot]').forEach(el => el.addEventListener('click', () => { if (state.clinicalSnapshot && state.tickets.length > 0) pushSnapshotToTicket(state.tickets[0].id); }));
  document.querySelectorAll('[data-push]').forEach(el => el.addEventListener('click', () => pushDataToTicket(el.dataset.push)));
  document.querySelectorAll('[data-ticket]').forEach(el => el.addEventListener('click', () => { window.open(state.serverUrl + '/#ticket-' + el.dataset.ticket, '_blank'); }));
  const ai = document.getElementById('chart-ai-input'); const as = document.getElementById('chart-ai-send');
  if (ai && as) { as.addEventListener('click', () => { chartAiChat(ai.value); }); ai.addEventListener('keydown', (e) => { if (e.key === 'Enter') chartAiChat(ai.value); }); }
  const ts = document.getElementById('ticket-search'); if (ts) { let timer; ts.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { if (ts.value.trim()) searchTickets(ts.value.trim()); else loadTickets(); }, 500); }); }
  const lo = document.getElementById('logout-btn'); if (lo) lo.addEventListener('click', async () => { try { await apiRequest('/auth/logout', { method: 'POST' }); } catch(e) {} state.loggedIn = false; state.user = null; statusText.textContent = 'Not connected'; render(); });
  const su = document.getElementById('settings-save-url'); if (su) su.addEventListener('click', () => { state.serverUrl = document.getElementById('settings-url').value.replace(/\/$/, ''); saveSettings(); showToast('Saved'); checkAuth().then(() => render()); });
  const cc = document.getElementById('clear-cache-btn'); if (cc) cc.addEventListener('click', () => { state.fullChartCache = null; state.fullChartCachePatient = ''; state.chartAiMessages = []; savePatientData(); showToast('Cache cleared'); render(); });
}

// ── Messages from content script ──
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'PATIENT_DATA_UPDATE' || msg.type === 'PATIENT_DATA') {
    state.patientData = msg.data; savePatientData();
    if (state.tab === 'patient') render();
    if (msg.data.patientName) searchTickets(msg.data.patientName);
  }
  if (msg.type === 'SCRAPE_PROGRESS') {
    state.scrapeProgress = msg.status;
    state.scrapeLog.push(new Date().toLocaleTimeString() + ' — ' + msg.status);
    if (state.scrapeLog.length > 30) state.scrapeLog.shift();
    render();
  }
  if (msg.type === 'CHART_SCAN_COMPLETE') {
    state.patientData = msg.data; savePatientData();
    if (msg.data.patientName) searchTickets(msg.data.patientName);
    const enc = msg.data._encountersScanned || 0;
    showToast('Scan complete — ' + enc + ' encounters');
    if (enc > 0 || msg.data.patientName) generateSnapshot(msg.data);
    else { state.chartScanning = false; state.scrapeProgress = 'No data found'; render(); }
  }
});

// ── Init ──
(async function init() {
  await loadSettings();
  await loadPatientData();
  const authed = await checkAuth();
  render();
  if (authed) loadTickets();
})();
