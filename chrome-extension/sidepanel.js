// ── Seniority CareCoord Side Panel ──

let state = {
  loggedIn: false,
  user: null,
  serverUrl: '',
  tab: 'patient',
  overviewOpen: true,
  chartScanOpen: false,
  patientData: null,
  clinicalSnapshot: null,
  tickets: [],
  aiMessages: [],
  aiLoading: false,
  loading: false,
  chartScanning: false,
  scrapeProgress: '',
  scrapeLog: [],
  scanStartDate: '',
  scanEndDate: '',
  chartAiMessages: [],
  chartAiLoading: false,
};

const app = document.getElementById('app');
const statusText = document.getElementById('status-text');
const toastEl = document.getElementById('toast');

// ── Storage ──
async function loadSettings() {
  return new Promise(r => {
    chrome.storage.local.get(['serverUrl', 'sessionCookie'], (d) => {
      state.serverUrl = d.serverUrl || 'https://carecoord-o3en.onrender.com';
      r(d);
    });
  });
}
async function saveSettings() {
  return new Promise(r => chrome.storage.local.set({ serverUrl: state.serverUrl }, r));
}
function savePatientData() {
  chrome.storage.local.set({
    patientData: state.patientData,
    clinicalSnapshot: state.clinicalSnapshot,
  });
}
async function loadPatientData() {
  return new Promise(r => {
    chrome.storage.local.get(['patientData', 'clinicalSnapshot'], (d) => {
      if (d.patientData) state.patientData = d.patientData;
      if (d.clinicalSnapshot) state.clinicalSnapshot = d.clinicalSnapshot;
      r();
    });
  });
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

// ── Toast ──
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.style.display = 'block';
  setTimeout(() => toastEl.style.display = 'none', 3000);
}

// ── Check Auth ──
async function checkAuth() {
  try {
    const d = await apiRequest('/auth/me');
    state.user = d.user;
    state.loggedIn = true;
    statusText.textContent = 'Connected — ' + d.user.name;
    return true;
  } catch(e) {
    state.loggedIn = false;
    state.user = null;
    statusText.textContent = 'Not connected';
    return false;
  }
}

// ── Login ──
async function login(email, password) {
  try {
    const d = await apiRequest('/auth/login', { method: 'POST', body: { email, password } });
    if (d.step === 'done') {
      state.user = d.user;
      state.loggedIn = true;
      statusText.textContent = 'Connected — ' + d.user.name;
      render();
      loadTickets();
    } else if (d.step === '2fa') {
      showToast('2FA required — enter code');
      render2FA(email);
    }
  } catch(e) { showToast(e.message); }
}

async function verify2FA(code, email) {
  try {
    const d = await apiRequest('/auth/verify-2fa', { method: 'POST', body: { code, email } });
    if (d.step === 'done') {
      state.user = d.user;
      state.loggedIn = true;
      statusText.textContent = 'Connected — ' + d.user.name;
      render();
      loadTickets();
    }
  } catch(e) { showToast(e.message); }
}

// ── Load Tickets ──
async function loadTickets() {
  try {
    const d = await apiRequest('/tickets?status=all&queue=personal');
    state.tickets = (d.tickets || []).filter(t => t.status !== 'CLOSED').slice(0, 30);
    render();
  } catch(e) {}
}

// ── Search tickets by patient name ──
async function searchTickets(query) {
  try {
    const d = await apiRequest('/tickets?search=' + encodeURIComponent(query) + '&status=all');
    state.tickets = (d.tickets || []).slice(0, 30);
    render();
  } catch(e) {}
}

// ── Scrape patient from PF ──
async function scrapePatient() {
  state.loading = true;
  render();
  chrome.runtime.sendMessage({ type: 'SCRAPE_PATIENT' }, (response) => {
    state.loading = false;
    if (response && response.success) {
      state.patientData = response.data;
      savePatientData();
      if (response.data.patientName) {
        searchTickets(response.data.patientName);
      }
    } else {
      showToast('Could not read patient data from page');
    }
    render();
  });
}

// ── Chart Scan — reads summary + encounters within date range ──
async function startChartScan() {
  state.chartScanning = true;
  state.clinicalSnapshot = null;
  state.chartAiMessages = [];
  state.scrapeLog = [];
  state.scrapeProgress = 'Starting chart scan...';
  render();
  // Auto-fix backwards date range
  let sd = state.scanStartDate || null;
  let ed = state.scanEndDate || null;
  if (sd && ed && new Date(sd) > new Date(ed)) { const tmp = sd; sd = ed; ed = tmp; state.scanStartDate = sd; state.scanEndDate = ed; }
  chrome.runtime.sendMessage({ type: 'CHART_SCAN', startDate: sd, endDate: ed });
}

// ── Generate clinical snapshot from chart data ──
async function generateSnapshot(chartData) {
  state.scrapeProgress = 'Generating clinical snapshot...';
  render();
  try {
    const d = await apiRequest('/ai/clinical-snapshot', { method: 'POST', body: { chartData } });
    state.clinicalSnapshot = d.snapshot;
    savePatientData();
    state.aiMessages = [];
  } catch(e) {
    state.clinicalSnapshot = 'Error generating snapshot: ' + (e.message || 'Failed');
  }
  state.chartScanning = false;
  state.scrapeProgress = '';
  render();
}

// ── Push patient data to CareCoord (create note on a ticket) ──
async function pushToTicket(ticketId) {
  if (!state.patientData) { showToast('No patient data to push'); return; }
  const pd = state.patientData;
  let noteBody = 'Patient Data from Practice Fusion:\n\n';
  if (pd.patientName) noteBody += 'Patient: ' + pd.patientName + '\n';
  if (pd.dob) noteBody += 'DOB: ' + pd.dob + '\n';
  if (pd.age) noteBody += 'Age: ' + pd.age + '\n';
  if (pd.gender) noteBody += 'Gender: ' + pd.gender + '\n';
  if (pd.phone) noteBody += 'Phone: ' + pd.phone + '\n';
  if (pd.email) noteBody += 'Email: ' + pd.email + '\n';
  if (pd.address) noteBody += 'Address: ' + pd.address + '\n';
  if (pd.ssnLast4) noteBody += 'SSN (last 4): ' + pd.ssnLast4 + '\n';
  if (pd.insurance) noteBody += 'Insurance: ' + pd.insurance + '\n';
  if (pd.memberId) noteBody += 'Member ID: ' + pd.memberId + '\n';
  if (pd.groupNumber) noteBody += 'Group #: ' + pd.groupNumber + '\n';
  if (pd.pcp) noteBody += 'PCP: ' + pd.pcp + '\n';
  if (pd.pharmacy) noteBody += 'Pharmacy: ' + pd.pharmacy + '\n';
  if (pd.smokingStatus) noteBody += 'Smoking: ' + pd.smokingStatus + '\n';
  if (pd.vitals) {
    noteBody += '\nVitals:\n';
    const vl = { bp: 'BP', hr: 'HR', temp: 'Temp', weight: 'Weight', height: 'Height', bmi: 'BMI', o2: 'O2' };
    for (const [k, v] of Object.entries(pd.vitals)) noteBody += '  ' + (vl[k]||k) + ': ' + v + '\n';
  }
  if (pd.medications?.length) noteBody += '\nMedications:\n' + pd.medications.map(m => '  - ' + m).join('\n') + '\n';
  if (pd.allergies?.length) noteBody += '\nAllergies:\n' + pd.allergies.map(a => '  - ' + a).join('\n') + '\n';
  if (pd.diagnoses?.length) noteBody += '\nDiagnoses:\n' + pd.diagnoses.map(d => '  - ' + d).join('\n') + '\n';

  try {
    await apiRequest('/tickets/' + ticketId + '/notes', { method: 'POST', body: { body: noteBody } });
    showToast('Patient data pushed to ticket');
  } catch(e) { showToast(e.message); }
}

// ── Chart AI — live-scans PF page on every question ──
function liveScanPage() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'SCRAPE_PATIENT' }, (response) => {
      if (response && response.success) {
        state.patientData = response.data;
        savePatientData();
        resolve(response.data);
      } else {
        resolve(state.patientData || null);
      }
    });
    // Timeout fallback — use cached data if content script doesn't respond
    setTimeout(() => resolve(state.patientData || null), 3000);
  });
}

function buildPatientContext(pd) {
  if (!pd) return 'No patient data available.\n';
  let ctx = '';
  ctx += 'Patient: ' + (pd.patientName||'?') + ' | DOB: ' + (pd.dob||'?') + ' | Age: ' + (pd.age||'?') + ' | ' + (pd.gender||'') + ' | PRN: ' + (pd.prn||'') + '\n';
  ctx += 'Phone: ' + (pd.phone||'?') + ' | Insurance: ' + (pd.insurance||'?') + '\n';
  if (pd.allergies?.length) ctx += 'Allergies: ' + pd.allergies.join(', ') + '\n';
  if (pd.advanceDirectives) ctx += 'Advance Directives: ' + pd.advanceDirectives + '\n';
  if (pd.familyHistory) ctx += 'Family History: ' + pd.familyHistory + '\n';
  if (pd.diagnoses?.length) ctx += 'Diagnoses: ' + pd.diagnoses.join('; ') + '\n';
  if (pd.medications?.length) ctx += 'Medications: ' + pd.medications.join('; ') + '\n';
  if (pd.healthConcerns) ctx += 'Health Concerns: ' + pd.healthConcerns.substring(0, 500) + '\n';
  if (pd.socialHistory) {
    ctx += 'Social History: ';
    if (pd.socialHistory.tobacco) ctx += 'Tobacco: ' + pd.socialHistory.tobacco + '; ';
    if (pd.socialHistory.freeText) ctx += pd.socialHistory.freeText.substring(0, 300);
    ctx += '\n';
  }
  if (pd.pastMedicalHistory) {
    ctx += 'Past Medical History: ';
    if (pd.pastMedicalHistory.majorEvents) ctx += 'Events: ' + pd.pastMedicalHistory.majorEvents + '; ';
    if (pd.pastMedicalHistory.preventiveCare) ctx += 'Preventive: ' + pd.pastMedicalHistory.preventiveCare.substring(0, 200);
    ctx += '\n';
  }
  if (pd.screenings?.length) ctx += 'Screenings: ' + pd.screenings.slice(0,5).join('; ') + '\n';
  if (pd.flowsheets?.length) ctx += 'Flowsheets: ' + pd.flowsheets.join(', ') + '\n';
  if (pd.encounters?.length) ctx += 'Encounters: ' + pd.encounters.join('; ') + '\n';
  if (pd.encounterDetails?.length) {
    ctx += '\nEncounter details:\n';
    for (const enc of pd.encounterDetails.slice(0, 10)) {
      ctx += '- ' + (enc.date||'?') + ' | ' + (enc.type||'') + ' | CC: ' + (enc.chiefComplaint||'none') + '\n';
    }
  }
  // Include whatever is currently visible on the PF page
  if (pd._pageContext) ctx += '\nPage text (current view):\n' + pd._pageContext.substring(0, 3000) + '\n';
  return ctx;
}

// Navigate to a PF section and read it
function navigateAndRead(section) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'NAVIGATE_AND_READ', section }, (response) => {
      if (response && response.success) resolve(response.text);
      else resolve(null);
    });
    setTimeout(() => resolve(null), 8000);
  });
}

async function chartAiChat(message) {
  if (!message.trim() || state.chartAiLoading) return;
  state.chartAiMessages.push({ role: 'user', content: message });
  state.chartAiLoading = true;
  render();

  // Step 1: Live scan the current page (Summary)
  const freshData = await liveScanPage();
  let ctx = buildPatientContext(freshData);
  if (state.clinicalSnapshot) ctx += '\nClinical Overview: ' + state.clinicalSnapshot.substring(0, 800) + '\n';

  // Step 2: Detect which sections to check based on the question
  const q = message.toLowerCase();
  let additionalCtx = '';
  const sectionsToCheck = [];

  // Keyword routing — figure out which PF sections might have the answer
  if (q.includes('pharmacy') || q.includes('address') || q.includes('email') || q.includes('emergency contact') || q.includes('employer') || q.includes('language') || q.includes('race') || q.includes('marital') || q.includes('demographic') || q.includes('profile') || q.includes('contact')) {
    sectionsToCheck.push('profile');
  }
  if (q.includes('document') || q.includes('lab result') || q.includes('imaging') || q.includes('report') || q.includes('file') || q.includes('scan result') || q.includes('xray') || q.includes('x-ray') || q.includes('mri')) {
    sectionsToCheck.push('documents');
  }
  if (q.includes('timeline') || q.includes('history of visit') || q.includes('all encounter') || q.includes('visit history') || q.includes('appointment') || q.includes('when did') || q.includes('last visit') || q.includes('how many visit')) {
    sectionsToCheck.push('timeline');
  }
  if (q.includes('payment') || q.includes('billing') || q.includes('copay') || q.includes('balance') || q.includes('charge')) {
    sectionsToCheck.push('payment');
  }
  if (q.includes('ledger') || q.includes('account') || q.includes('financial')) {
    sectionsToCheck.push('ledger');
  }

  for (const section of sectionsToCheck) {
    state.scrapeProgress = 'Looking in ' + section + '...';
    render();
    const sectionText = await navigateAndRead(section);
    if (sectionText) {
      additionalCtx += '\n\nData from ' + section.toUpperCase() + ' section:\n' + sectionText.substring(0, 3000) + '\n';
    }
  }
  if (sectionsToCheck.length > 0) {
    state.scrapeProgress = '';
    render();
  }

  // Step 3: Answer the question with all available data
  let fullMsg = message;
  if (state.chartAiMessages.length <= 1) {
    fullMsg = 'Patient chart data from Practice Fusion (live scan):\n\n' + ctx + additionalCtx + '\n\nIMPORTANT: Only answer based on the data above. If information is not present, say "I don\'t have that data in the current chart view." NEVER make up clinical information.\n\nQuestion: ' + message;
  } else if (additionalCtx) {
    fullMsg = 'Additional chart data just retrieved:\n' + additionalCtx + '\n\nQuestion: ' + message;
  }

  try {
    const history = state.chartAiMessages.length > 1 ? state.chartAiMessages.slice(0, -1) : undefined;
    const d = await apiRequest('/ai/chat', { method: 'POST', body: { message: fullMsg, history } });
    state.chartAiMessages.push({ role: 'assistant', content: d.reply });
  } catch(e) {
    state.chartAiMessages.push({ role: 'assistant', content: 'Error: ' + e.message });
  }
  state.chartAiLoading = false;
  state.scrapeProgress = '';
  render();
  setTimeout(() => {
    const el = document.getElementById('chart-ai-messages');
    if (el) el.scrollTop = el.scrollHeight;
  }, 100);
}

// ── Push snapshot to ticket as note ──
async function pushSnapshotToTicket(ticketId) {
  if (!state.clinicalSnapshot) { showToast('No snapshot to push'); return; }
  try {
    await apiRequest('/tickets/' + ticketId + '/notes', { method: 'POST', body: { body: 'Clinical Snapshot from Practice Fusion:\n\n' + state.clinicalSnapshot } });
    showToast('Snapshot pushed to ticket');
  } catch(e) { showToast(e.message); }
}

// ── AI Chat ──
async function aiChat(message) {
  if (!message.trim() || state.aiLoading) return;
  state.aiMessages.push({ role: 'user', content: message });
  state.aiLoading = true;
  render();

  // Build context with patient data
  let fullMsg = message;
  if (state.aiMessages.length === 1 && state.patientData) {
    const pd = state.patientData;
    let ctx = 'Current patient on screen in Practice Fusion:\n';
    if (pd.patientName) ctx += 'Name: ' + pd.patientName + '\n';
    if (pd.dob) ctx += 'DOB: ' + pd.dob + '\n';
    if (pd.insurance) ctx += 'Insurance: ' + pd.insurance + '\n';
    if (pd.medications) ctx += 'Medications: ' + pd.medications.join(', ') + '\n';
    if (pd.diagnoses) ctx += 'Diagnoses: ' + pd.diagnoses.join(', ') + '\n';
    if (state.clinicalSnapshot) ctx += '\nClinical Snapshot:\n' + state.clinicalSnapshot + '\n';
    if (pd.encounterDetails) ctx += '\nEncounter details available: ' + pd.encounterDetails.length + ' encounters scanned\n';
    if (pd._pageContext) ctx += '\nPage context:\n' + pd._pageContext.substring(0, 2000) + '\n';
    fullMsg = ctx + '\n---\n\nUser request: ' + message;
  }

  try {
    const history = state.aiMessages.length > 1 ? state.aiMessages.slice(0, -1) : undefined;
    const d = await apiRequest('/ai/chat', { method: 'POST', body: { message: fullMsg, history } });
    state.aiMessages.push({ role: 'assistant', content: d.reply });
  } catch(e) {
    state.aiMessages.push({ role: 'assistant', content: 'Error: ' + e.message });
  }
  state.aiLoading = false;
  render();
}

// ── Render ──
function render() {
  if (!state.loggedIn) {
    renderLogin();
    return;
  }

  let html = '';

  // Tabs
  html += '<div class="tabs">';
  html += `<div class="tab ${state.tab === 'patient' ? 'active' : ''}" data-tab="patient">Patient</div>`;
  html += `<div class="tab ${state.tab === 'tickets' ? 'active' : ''}" data-tab="tickets">Tickets</div>`;
  html += `<div class="tab ${state.tab === 'ai' ? 'active' : ''}" data-tab="ai">AI</div>`;
  html += `<div class="tab ${state.tab === 'settings' ? 'active' : ''}" data-tab="settings">⚙</div>`;
  html += '</div>';

  html += '<div class="content">';

  if (state.tab === 'patient') {
    html += renderPatientTab();
  } else if (state.tab === 'tickets') {
    html += renderTicketsTab();
  } else if (state.tab === 'ai') {
    html += renderAITab();
  } else if (state.tab === 'settings') {
    html += renderSettingsTab();
  }

  html += '</div>';
  app.innerHTML = html;
  bindEvents();
}

function renderLogin() {
  app.innerHTML = `
    <div class="login-screen">
      <img src="icons/icon128.jpg" style="width:64px;height:64px;border-radius:12px;margin-bottom:8px">
      <div style="font-size:16px;font-weight:700;color:#1e3a4f">Seniority CareCoord</div>
      <div style="font-size:12px;color:#6b8299;margin-bottom:8px">Sign in to connect</div>
      <div class="server-url">
        <input type="text" id="server-url" value="${state.serverUrl}" placeholder="Server URL">
        <button class="btn btn-secondary btn-small" id="save-url">Save</button>
      </div>
      <input type="email" id="login-email" placeholder="Email">
      <input type="password" id="login-password" placeholder="Password">
      <button class="btn btn-primary" id="login-btn" style="width:100%">Sign In</button>
    </div>
  `;
  document.getElementById('login-btn').addEventListener('click', () => {
    const email = document.getElementById('login-email').value;
    const pw = document.getElementById('login-password').value;
    login(email, pw);
  });
  document.getElementById('login-password').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { document.getElementById('login-btn').click(); }
  });
  document.getElementById('save-url').addEventListener('click', () => {
    state.serverUrl = document.getElementById('server-url').value.replace(/\/$/, '');
    saveSettings();
    showToast('Server URL saved');
  });
}

function render2FA(email) {
  app.innerHTML = `
    <div class="login-screen">
      <div style="font-size:14px;font-weight:600;color:#1e3a4f">Enter 2FA Code</div>
      <input type="text" id="twofa-code" placeholder="6-digit code" maxlength="6" style="text-align:center;font-size:18px;letter-spacing:4px">
      <button class="btn btn-primary" id="twofa-btn" style="width:100%">Verify</button>
    </div>
  `;
  document.getElementById('twofa-btn').addEventListener('click', () => {
    verify2FA(document.getElementById('twofa-code').value, email);
  });
  document.getElementById('twofa-code').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('twofa-btn').click();
  });
}

function renderPatientTab() {
  let html = '';
  const pd = state.patientData;

  // ── Scanning in progress ──
  if (state.chartScanning) {
    html += '<div class="card" style="padding:16px">';
    html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">';
    html += '<img src="icons/icon128.jpg" style="width:28px;height:28px;border-radius:4px;object-fit:contain;animation:pulse 1.5s ease-in-out infinite">';
    html += '<div><div style="font-size:13px;font-weight:600;color:#3d8ba8">Chart Scan in Progress</div>';
    html += '<div style="font-size:11px;color:#6b8299">' + (state.scrapeProgress || 'Starting...') + '</div></div>';
    html += '</div>';
    html += '<div style="background:#f8fafc;border:1px solid #e8f0f8;border-radius:6px;padding:8px;max-height:200px;overflow-y:auto;font-family:monospace;font-size:10px;line-height:1.6;color:#5a7a8a">';
    for (const line of state.scrapeLog) {
      html += '<div style="color:' + (line.includes('ERROR') || line.includes('WARNING') ? '#d94040' : '#5a7a8a') + '">' + escapeHtml(line) + '</div>';
    }
    html += '</div></div>';
    return html;
  }

  // ── 1. Patient Overview (collapsible) ──
  html += '<div style="border:1px solid #dde8f2;border-radius:8px;margin-bottom:8px;overflow:hidden">';
  html += '<button id="toggle-overview" style="display:flex;align-items:center;gap:8px;width:100%;padding:10px 12px;background:#f0f4f9;border:none;cursor:pointer;text-align:left;font-size:13px;font-weight:600;color:#1e3a4f">';
  html += '<span style="transform:rotate(' + (state.overviewOpen ? '90' : '0') + 'deg);transition:transform 0.2s;font-size:10px">▶</span>';
  html += 'Patient Overview';
  if (pd?.patientName) html += '<span style="font-size:10px;font-weight:400;color:#6b8299;margin-left:auto">' + pd.patientName + '</span>';
  html += '</button>';

  if (state.overviewOpen) {
    html += '<div style="padding:8px 12px">';
    html += '<div style="display:flex;gap:4px;margin-bottom:8px">';
    html += '<button class="btn btn-primary btn-small" id="scrape-btn">Read from PF</button>';
    html += '<button class="btn btn-secondary btn-small" id="refresh-btn">Refresh</button>';
    html += '</div>';

    if (state.loading) { html += '<div class="loading">Reading...</div>'; }
    else if (!pd) {
      html += '<div style="text-align:center;color:#8a9fb0;padding:12px;font-size:12px">Open a patient chart in PF and click "Read from PF"</div>';
    } else {
      // Patient info
      const fields = [
        ['Name', pd.patientName], ['DOB', pd.dob], ['Age', pd.age], ['Gender', pd.gender],
        ['Phone', pd.phone], ['Insurance', pd.insurance], ['PRN', pd.prn],
      ];
      for (const [label, val] of fields) {
        if (val) html += '<div class="field"><div class="field-label">' + label + '</div><div class="field-value">' + val + '</div></div>';
      }
      if (pd.medications?.length) html += '<div class="field"><div class="field-label">Medications</div><div class="field-value">' + pd.medications.length + ' active</div></div>';
      if (pd.diagnoses?.length) html += '<div class="field"><div class="field-label">Diagnoses</div><div class="field-value">' + pd.diagnoses.length + ' active</div></div>';
      if (pd.allergies?.length) html += '<div class="field"><div class="field-label">Allergies</div><div class="field-value">' + pd.allergies.join(', ') + '</div></div>';
      if (pd.advanceDirectives) html += '<div class="field"><div class="field-label">Advance Directives</div><div class="field-value">' + pd.advanceDirectives + '</div></div>';
      if (pd.healthConcerns) html += '<details style="margin-top:4px"><summary style="font-size:10px;font-weight:600;color:#6b8299;cursor:pointer">Health Concerns</summary><div style="font-size:11px;white-space:pre-wrap;color:#5a7a8a;padding:4px 0">' + escapeHtml(pd.healthConcerns) + '</div></details>';
    }
    html += '</div>';
  }
  html += '</div>';

  // ── 2. Chart Scan (collapsible) ──
  html += '<div style="border:1px solid #dde8f2;border-radius:8px;margin-bottom:8px;overflow:hidden">';
  html += '<button id="toggle-chartscan" style="display:flex;align-items:center;gap:8px;width:100%;padding:10px 12px;background:#f0f4f9;border:none;cursor:pointer;text-align:left;font-size:13px;font-weight:600;color:#1e3a4f">';
  html += '<span style="transform:rotate(' + (state.chartScanOpen ? '90' : '0') + 'deg);transition:transform 0.2s;font-size:10px">▶</span>';
  html += 'Chart Scan';
  if (state.clinicalSnapshot) html += '<span style="width:8px;height:8px;border-radius:50%;background:#2e7d32;margin-left:auto;flex-shrink:0"></span>';
  html += '</button>';

  if (state.chartScanOpen) {
    html += '<div style="padding:8px 12px">';

    if (state.clinicalSnapshot) {
      // Scan complete summary
      const fromDate = state.scanStartDate ? new Date(state.scanStartDate).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : 'All';
      const toDate = state.scanEndDate ? new Date(state.scanEndDate).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : 'Present';
      html += '<div style="font-size:10px;color:#5a7a8a;margin-bottom:6px;line-height:1.5">';
      html += '<strong>Range:</strong> ' + fromDate + ' — ' + toDate + ' | ';
      html += '<strong>Encounters:</strong> ' + (pd?._encountersScanned || 0);
      html += '</div>';

      // Clinical Overview
      html += '<div style="font-size:12px;line-height:1.6;white-space:pre-wrap;word-break:break-word;max-height:300px;overflow-y:auto;margin-bottom:8px">' + escapeHtml(state.clinicalSnapshot) + '</div>';
      html += '<div style="display:flex;gap:4px;margin-bottom:8px">';
      html += '<button class="btn btn-primary btn-small" data-copy-snapshot>Copy</button>';
      html += '<button class="btn btn-secondary btn-small" data-push-snapshot>Push to Ticket</button>';
      html += '<button class="btn btn-secondary btn-small" id="rescan-btn">Rescan</button>';
      html += '</div>';
    } else {
      // Date picker
      html += '<div style="display:flex;gap:4px;margin-bottom:6px">';
      html += '<div style="flex:1"><label style="font-size:9px;color:#8a9fb0">From</label><input type="date" id="scan-start" value="' + state.scanStartDate + '" style="width:100%;padding:4px 6px;border:1px solid #c0d0e4;border-radius:4px;font-size:11px"></div>';
      html += '<div style="flex:1"><label style="font-size:9px;color:#8a9fb0">To</label><input type="date" id="scan-end" value="' + state.scanEndDate + '" style="width:100%;padding:4px 6px;border:1px solid #c0d0e4;border-radius:4px;font-size:11px"></div>';
      html += '</div>';
      html += '<button class="btn btn-primary btn-small" id="chart-scan-btn" style="width:100%;background:#3d8ba8">Start Chart Scan</button>';
    }
    html += '</div>';
  }
  html += '</div>';

  // ── 3. AI Chat (always visible, knows everything) ──
  html += '<div class="card">';
  html += '<div class="card-title" style="display:flex;align-items:center;gap:6px"><img src="icons/icon128.jpg" style="width:16px;height:16px;border-radius:3px;object-fit:contain">Ask about this patient</div>';
  html += '<div id="chart-ai-messages" style="max-height:250px;overflow-y:auto;margin-bottom:8px">';
  if (!state.chartAiMessages?.length && !state.chartAiLoading) {
    html += '<div style="font-size:11px;color:#8a9fb0;padding:8px 0">Ask anything — the AI knows the patient\'s demographics, medications, diagnoses, insurance, encounters, and chart scan results.</div>';
  }
  if (state.chartAiMessages?.length > 0) {
    for (const m of state.chartAiMessages) {
      const isUser = m.role === 'user';
      html += '<div style="display:flex;gap:6px;padding:4px 0;align-items:flex-start">';
      html += '<div style="width:20px;height:20px;border-radius:' + (isUser ? '50%' : '3px') + ';background:' + (isUser ? '#1a5e9a' : '#52a8c7') + ';display:flex;align-items:center;justify-content:center;color:#fff;font-size:9px;font-weight:700;flex-shrink:0">' + (isUser ? (state.user?.name?.[0] || 'U') : '<img src="icons/icon128.jpg" style="width:14px;height:14px;border-radius:2px">') + '</div>';
      html += '<div style="flex:1;min-width:0"><div style="font-size:9px;font-weight:700;color:' + (isUser ? '#1e3a4f' : '#3d8ba8') + '">' + (isUser ? 'You' : 'Seniority AI') + '</div>';
      html += '<div style="font-size:11px;line-height:1.5;white-space:pre-wrap;word-break:break-word">' + escapeHtml(m.content) + '</div></div></div>';
    }
  }
  if (state.chartAiLoading) {
    html += '<div style="display:flex;gap:6px;padding:4px 0;align-items:center">';
    html += '<img src="icons/icon128.jpg" style="width:20px;height:20px;border-radius:3px;animation:pulse 1.5s ease-in-out infinite">';
    html += '<span style="font-size:11px;color:#8a9fb0;font-style:italic">Thinking...</span></div>';
  }
  html += '</div>';
  html += '<div style="display:flex;gap:4px"><input type="text" id="chart-ai-input" placeholder="What insurance does this patient have?" style="flex:1;padding:6px 10px;border:1px solid #c0d0e4;border-radius:16px;font-size:11px;outline:none">';
  html += '<button class="btn btn-primary btn-small" id="chart-ai-send" style="background:#52a8c7;border-radius:16px;padding:6px 12px">Ask</button></div>';
  html += '</div>';

  return html;
}

function renderTicketsTab() {
  let html = '<div style="margin-bottom:8px"><input type="text" id="ticket-search" placeholder="Search tickets..." style="width:100%;padding:8px 12px;border:1px solid #c0d0e4;border-radius:8px;font-size:12px;outline:none"></div>';

  if (state.tickets.length === 0) {
    html += '<div class="loading">No tickets found</div>';
    return html;
  }

  for (const t of state.tickets) {
    const sc = t.status === 'OPEN' ? 'open' : t.status === 'WAITING_ON_EXTERNAL' ? 'waiting' : 'closed';
    const label = t.status === 'OPEN' ? 'Open' : t.status === 'WAITING_ON_EXTERNAL' ? 'Waiting' : 'Closed';
    html += `<div class="ticket-row" data-ticket="${t.id}">
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:4px;margin-bottom:2px">
          <span class="ticket-id">${t.id.toUpperCase()}</span>
          <span class="status-badge status-${sc}">${label}</span>
        </div>
        <div class="ticket-subject">${t.subject || '(no subject)'}</div>
        <div style="font-size:10px;color:#8a9fb0">${(t.external_participants || [])[0] || ''}</div>
      </div>
    </div>`;
  }
  return html;
}

function renderAITab() {
  let html = '<div style="display:flex;flex-direction:column;height:100%">';

  // Messages
  html += '<div class="ai-messages" id="ai-messages">';
  if (state.aiMessages.length === 0) {
    html += '<div style="text-align:center;padding:24px;color:#8a9fb0">';
    html += '<img src="icons/icon128.jpg" style="width:40px;height:40px;border-radius:4px;object-fit:contain;margin-bottom:8px">';
    html += '<div style="font-size:12px">Ask me about the patient on screen, or anything about CareCoord.</div>';
    html += '</div>';
  }
  for (const m of state.aiMessages) {
    html += `<div class="ai-msg">
      <div class="ai-avatar ${m.role === 'user' ? 'user' : 'bot'}">
        ${m.role === 'user' ? (state.user?.name?.[0] || 'U') : '<img src="icons/icon128.jpg">'}
      </div>
      <div style="flex:1;min-width:0">
        <div class="ai-name" style="color:${m.role === 'user' ? '#1e3a4f' : '#3d8ba8'}">${m.role === 'user' ? (state.user?.name || 'You') : 'Seniority AI'}</div>
        <div class="ai-text">${escapeHtml(m.content)}</div>
        ${m.role === 'assistant' ? '<button class="btn btn-secondary btn-small" data-copy="' + state.aiMessages.indexOf(m) + '" style="margin-top:4px">Copy</button>' : ''}
      </div>
    </div>`;
  }
  if (state.aiLoading) {
    html += '<div class="ai-msg thinking"><div class="ai-avatar bot"><img src="icons/icon128.jpg"></div><span style="font-size:12px;color:#8a9fb0;font-style:italic">Thinking...</span></div>';
  }
  html += '</div>';

  // Quick actions
  if (state.aiMessages.length === 0) {
    html += '<div class="action-bar" style="margin-top:8px">';
    if (state.patientData?.patientName) {
      html += `<button class="btn btn-primary btn-small" data-ai-quick="Summarize what we know about ${state.patientData.patientName} across all CareCoord tickets">Summarize Patient</button>`;
      html += `<button class="btn btn-primary btn-small" data-ai-quick="What open tickets do we have for ${state.patientData.patientName}?">Find Tickets</button>`;
    }
    html += '<button class="btn btn-primary btn-small" data-ai-quick="What should I focus on right now based on my queue?">What\'s Priority?</button>';
    html += '</div>';
  }

  // Input
  html += '<div class="ai-input-row"><input type="text" id="ai-input" placeholder="Ask about this patient..."><button class="btn btn-primary btn-small" id="ai-send">Ask</button></div>';

  html += '</div>';
  return html;
}

function renderSettingsTab() {
  let html = '<div class="card"><div class="card-title">Connection</div>';
  html += `<div class="field"><div class="field-label">Server</div><div class="field-value">${state.serverUrl}</div></div>`;
  html += `<div class="field"><div class="field-label">User</div><div class="field-value">${state.user?.name || '?'} (${state.user?.role || '?'})</div></div>`;
  html += `<div class="field"><div class="field-label">Email</div><div class="field-value">${state.user?.email || '?'}</div></div>`;
  html += '<button class="btn btn-secondary btn-small" id="logout-btn" style="margin-top:8px">Log Out</button>';
  html += '</div>';

  html += '<div class="card"><div class="card-title">Server URL</div>';
  html += `<div class="server-url"><input type="text" id="settings-url" value="${state.serverUrl}"><button class="btn btn-primary btn-small" id="settings-save-url">Save</button></div>`;
  html += '</div>';

  return html;
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}

// ── Event Binding ──
function bindEvents() {
  // Tab switching
  document.querySelectorAll('.tab[data-tab]').forEach(t => {
    t.addEventListener('click', () => { state.tab = t.dataset.tab; render(); });
  });
  // Collapsible toggles
  const toggleOverview = document.getElementById('toggle-overview');
  if (toggleOverview) toggleOverview.addEventListener('click', () => { state.overviewOpen = !state.overviewOpen; render(); });
  const toggleChartScan = document.getElementById('toggle-chartscan');
  if (toggleChartScan) toggleChartScan.addEventListener('click', () => { state.chartScanOpen = !state.chartScanOpen; render(); });
  // Rescan
  const rescanBtn = document.getElementById('rescan-btn');
  if (rescanBtn) rescanBtn.addEventListener('click', () => {
    state.clinicalSnapshot = null;
    state.chartAiMessages = [];
    savePatientData();
    render();
  });

  // Scrape buttons
  const scrapeBtn = document.getElementById('scrape-btn');
  if (scrapeBtn) scrapeBtn.addEventListener('click', scrapePatient);

  const chartScanBtn = document.getElementById('chart-scan-btn');
  if (chartScanBtn) chartScanBtn.addEventListener('click', () => {
    state.scanStartDate = document.getElementById('scan-start')?.value || '';
    state.scanEndDate = document.getElementById('scan-end')?.value || '';
    startChartScan();
  });

  const refreshBtn = document.getElementById('refresh-btn');
  if (refreshBtn) refreshBtn.addEventListener('click', () => { loadTickets(); scrapePatient(); });

  // Chart AI
  const chartAiInput = document.getElementById('chart-ai-input');
  const chartAiSend = document.getElementById('chart-ai-send');
  if (chartAiInput && chartAiSend) {
    chartAiSend.addEventListener('click', () => { chartAiChat(chartAiInput.value); });
    chartAiInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') chartAiChat(chartAiInput.value); });
  }

  // Snapshot actions
  document.querySelectorAll('[data-copy-snapshot]').forEach(el => {
    el.addEventListener('click', () => { if (state.clinicalSnapshot) { navigator.clipboard.writeText(state.clinicalSnapshot); showToast('Snapshot copied'); } });
  });
  document.querySelectorAll('[data-push-snapshot]').forEach(el => {
    el.addEventListener('click', () => {
      if (state.clinicalSnapshot && state.tickets.length > 0) {
        pushSnapshotToTicket(state.tickets[0].id);
      } else { showToast('No tickets to push to'); }
    });
  });

  // Push to ticket
  document.querySelectorAll('[data-push]').forEach(el => {
    el.addEventListener('click', () => pushToTicket(el.dataset.push));
  });

  // Ticket search
  const searchInput = document.getElementById('ticket-search');
  if (searchInput) {
    let timer;
    searchInput.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (searchInput.value.trim()) searchTickets(searchInput.value.trim());
        else loadTickets();
      }, 500);
    });
  }

  // Ticket click — open in CareCoord
  document.querySelectorAll('[data-ticket]').forEach(el => {
    el.addEventListener('click', () => {
      window.open(state.serverUrl + '/#ticket-' + el.dataset.ticket, '_blank');
    });
  });

  // AI input
  const aiInput = document.getElementById('ai-input');
  const aiSend = document.getElementById('ai-send');
  if (aiInput && aiSend) {
    aiSend.addEventListener('click', () => { aiChat(aiInput.value); });
    aiInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { aiChat(aiInput.value); } });
  }

  // AI quick actions
  document.querySelectorAll('[data-ai-quick]').forEach(el => {
    el.addEventListener('click', () => aiChat(el.dataset.aiQuick));
  });

  // AI copy
  document.querySelectorAll('[data-copy]').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.copy);
      if (state.aiMessages[idx]) {
        navigator.clipboard.writeText(state.aiMessages[idx].content);
        showToast('Copied');
      }
    });
  });

  // Settings
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) logoutBtn.addEventListener('click', async () => {
    try { await apiRequest('/auth/logout', { method: 'POST' }); } catch(e) {}
    state.loggedIn = false; state.user = null;
    statusText.textContent = 'Not connected';
    render();
  });

  const saveUrlBtn = document.getElementById('settings-save-url');
  if (saveUrlBtn) saveUrlBtn.addEventListener('click', () => {
    state.serverUrl = document.getElementById('settings-url').value.replace(/\/$/, '');
    saveSettings();
    showToast('Saved — reconnecting...');
    checkAuth().then(() => render());
  });

  // Scroll AI to bottom
  const aiMsgs = document.getElementById('ai-messages');
  if (aiMsgs) aiMsgs.scrollTop = aiMsgs.scrollHeight;
}

// ── Listen for messages from content script ──
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'PATIENT_DATA_UPDATE' || msg.type === 'PATIENT_DATA') {
    state.patientData = msg.data;
    savePatientData();
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
    state.patientData = msg.data;
    savePatientData();
    if (msg.data.patientName) searchTickets(msg.data.patientName);
    const enc = msg.data._encountersScanned || 0;
    const errs = msg.data._errors || [];
    if (errs.length > 0) {
      showToast('Scan finished with ' + errs.length + ' error(s)');
      state.scrapeLog.push('--- ERRORS ---');
      errs.forEach(e => state.scrapeLog.push('ERROR: ' + e));
    } else {
      showToast('Chart scan complete — ' + enc + ' encounters read');
    }
    if (enc > 0 || msg.data.patientName) {
      generateSnapshot(msg.data);
    } else {
      state.chartScanning = false;
      state.scrapeProgress = 'No data found — check that a patient chart is open';
      render();
    }
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
