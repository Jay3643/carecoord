// ── Seniority CareCoord Side Panel ──

let state = {
  loggedIn: false,
  user: null,
  serverUrl: '',
  tab: 'patient',
  patientData: null,
  clinicalSnapshot: null,
  tickets: [],
  aiMessages: [],
  aiLoading: false,
  loading: false,
  chartScanning: false,
  scrapeProgress: '',
  scanStartDate: '',
  scanEndDate: '',
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
      // Auto-search for matching tickets
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
  state.scrapeProgress = 'Starting chart scan...';
  render();
  chrome.runtime.sendMessage({
    type: 'CHART_SCAN',
    startDate: state.scanStartDate || null,
    endDate: state.scanEndDate || null,
  });
}

// ── Generate clinical snapshot from chart data ──
async function generateSnapshot(chartData) {
  state.scrapeProgress = 'Generating clinical snapshot...';
  render();
  try {
    const d = await apiRequest('/ai/clinical-snapshot', { method: 'POST', body: { chartData } });
    state.clinicalSnapshot = d.snapshot;
    // Also inject into AI context
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
  html += '<div class="action-bar">';
  html += '<button class="btn btn-primary btn-small" id="scrape-btn">Patient Overview</button>';
  html += '<button class="btn btn-secondary btn-small" id="refresh-btn">Refresh</button>';
  html += '</div>';

  // Chart Scan section
  html += '<div class="card" style="margin-bottom:8px">';
  html += '<div class="card-title">Chart Scan</div>';
  html += '<div style="display:flex;gap:4px;margin-bottom:6px">';
  html += '<div style="flex:1"><label style="font-size:9px;color:#8a9fb0">From</label><input type="date" id="scan-start" value="' + state.scanStartDate + '" style="width:100%;padding:4px 6px;border:1px solid #c0d0e4;border-radius:4px;font-size:11px"></div>';
  html += '<div style="flex:1"><label style="font-size:9px;color:#8a9fb0">To</label><input type="date" id="scan-end" value="' + state.scanEndDate + '" style="width:100%;padding:4px 6px;border:1px solid #c0d0e4;border-radius:4px;font-size:11px"></div>';
  html += '</div>';
  html += '<button class="btn btn-primary btn-small" id="chart-scan-btn" style="width:100%;background:#3d8ba8">Chart Scan</button>';
  html += '<div style="font-size:9px;color:#8a9fb0;margin-top:4px">Reads summary + clicks into each encounter within the date range. Generates an AI clinical snapshot.</div>';
  html += '</div>';

  if (state.loading) {
    html += '<div class="loading">Reading patient data...</div>';
    return html;
  }

  if (state.chartScanning) {
    html += '<div class="card" style="text-align:center;padding:24px">';
    html += '<img src="icons/icon128.jpg" style="width:40px;height:40px;border-radius:50%;animation:pulse 1.5s ease-in-out infinite;margin-bottom:8px">';
    html += '<div style="font-size:13px;font-weight:600;color:#3d8ba8">Chart Scan in Progress</div>';
    html += '<div style="font-size:11px;color:#6b8299;margin-top:4px">' + (state.scrapeProgress || 'Working...') + '</div>';
    html += '<div style="font-size:10px;color:#8a9fb0;margin-top:8px">Reading encounters — please don\'t navigate away.</div>';
    html += '</div>';
    return html;
  }

  // Clinical Snapshot
  if (state.clinicalSnapshot) {
    html += '<div class="card" style="border-color:#52a8c7;border-width:2px">';
    html += '<div class="card-title" style="display:flex;align-items:center;gap:6px"><img src="icons/icon128.jpg" style="width:16px;height:16px;border-radius:50%">Clinical Snapshot</div>';
    html += '<div style="font-size:12px;line-height:1.6;white-space:pre-wrap;word-break:break-word">' + escapeHtml(state.clinicalSnapshot) + '</div>';
    html += '<div style="margin-top:8px;display:flex;gap:4px">';
    html += '<button class="btn btn-primary btn-small" data-copy-snapshot>Copy</button>';
    html += '<button class="btn btn-secondary btn-small" data-push-snapshot>Push to Ticket</button>';
    html += '</div>';
    html += '</div>';
  }

  const pd = state.patientData;
  if (!pd) {
    html += '<div class="card"><div style="text-align:center;color:#8a9fb0;padding:20px">';
    html += '<div style="margin-bottom:8px">Navigate to a patient chart in Practice Fusion, then:</div>';
    html += '<div style="font-size:12px"><strong>Quick Read</strong> — reads the current screen</div>';
    html += '<div style="font-size:12px"><strong>Full Chart Scan</strong> — navigates through every section and pulls the complete chart</div>';
    html += '</div></div>';
    return html;
  }

  // Sections found indicator
  if (pd._sectionsFound !== undefined) {
    html += '<div style="font-size:10px;color:#3d8ba8;font-weight:600;margin-bottom:6px;display:flex;align-items:center;gap:4px">';
    html += '<span style="background:#e8f6fa;padding:2px 8px;border-radius:4px">Chart scan: ' + pd._sectionsFound + '/' + pd._sectionsTotal + ' sections</span>';
    html += '</div>';
  }

  html += '<div class="card"><div class="card-title">Patient Information</div>';
  const fields = [
    ['Name', pd.patientName], ['DOB', pd.dob], ['Age', pd.age], ['Gender', pd.gender],
    ['Phone', pd.phone], ['Email', pd.email], ['Address', pd.address], ['SSN (last 4)', pd.ssnLast4],
    ['Insurance', pd.insurance], ['Member ID', pd.memberId], ['Group #', pd.groupNumber],
    ['PCP', pd.pcp], ['Pharmacy', pd.pharmacy], ['Smoking', pd.smokingStatus],
  ];
  for (const [label, val] of fields) {
    if (val) html += `<div class="field"><div class="field-label">${label}</div><div class="field-value">${val}</div></div>`;
  }
  // Show "not found" only for critical fields
  if (!pd.patientName) html += '<div class="field"><div class="field-label">Name</div><div class="field-value empty">Not found</div></div>';
  html += '</div>';

  if (pd.medications && pd.medications.length) {
    html += '<div class="card"><div class="card-title">Medications</div>';
    html += pd.medications.map(m => `<div style="font-size:12px;padding:2px 0;border-bottom:1px solid #f0f4f9">${m}</div>`).join('');
    html += '</div>';
  }
  if (pd.allergies && pd.allergies.length) {
    html += '<div class="card"><div class="card-title">Allergies</div>';
    html += pd.allergies.map(a => `<div style="font-size:12px;padding:2px 0;color:#d94040">${a}</div>`).join('');
    html += '</div>';
  }
  if (pd.diagnoses && pd.diagnoses.length) {
    html += '<div class="card"><div class="card-title">Diagnoses / Problems</div>';
    html += pd.diagnoses.map(d => `<div style="font-size:12px;padding:2px 0;border-bottom:1px solid #f0f4f9">${d}</div>`).join('');
    html += '</div>';
  }

  // Push to ticket
  if (state.tickets.length > 0) {
    html += '<div class="card"><div class="card-title">Push to Ticket</div>';
    html += '<div style="font-size:11px;color:#6b8299;margin-bottom:6px">Send this patient data as a note:</div>';
    for (const t of state.tickets.slice(0, 5)) {
      html += `<div class="ticket-row" data-push="${t.id}">
        <span class="ticket-id">${t.id.toUpperCase()}</span>
        <span class="ticket-subject">${t.subject || '(no subject)'}</span>
      </div>`;
    }
    html += '</div>';
  }

  // Vitals
  if (pd.vitals && Object.keys(pd.vitals).length > 0) {
    html += '<div class="card"><div class="card-title">Latest Vitals</div>';
    const vitalLabels = { bp: 'Blood Pressure', hr: 'Heart Rate', temp: 'Temperature', weight: 'Weight', height: 'Height', bmi: 'BMI', o2: 'O2 Sat' };
    for (const [k, v] of Object.entries(pd.vitals)) {
      html += `<div class="field"><div class="field-label">${vitalLabels[k] || k}</div><div class="field-value">${v}</div></div>`;
    }
    html += '</div>';
  }

  // Chart sections (from deep scrape)
  if (pd._sections) {
    const sectionNames = Object.keys(pd._sections).filter(k => pd._sections[k]);
    if (sectionNames.length > 0) {
      html += '<div class="card"><div class="card-title">Chart Sections Retrieved</div>';
      for (const name of sectionNames) {
        html += `<details style="margin-bottom:4px"><summary style="cursor:pointer;font-size:12px;font-weight:500;color:#1e3a4f;padding:4px 0">${name}</summary>`;
        html += `<div style="font-size:11px;white-space:pre-wrap;color:#6b8299;max-height:200px;overflow:auto;padding:4px 8px;background:#f8fafc;border-radius:4px;margin-top:4px">${escapeHtml(pd._sections[name].substring(0, 3000))}</div>`;
        html += '</details>';
      }
      html += '</div>';
    }
  }

  if (pd._rawBanner && !pd.patientName) {
    html += '<div class="card"><div class="card-title">Raw Page Data (AI can analyze)</div>';
    html += `<div style="font-size:11px;white-space:pre-wrap;color:#6b8299;max-height:200px;overflow:auto">${escapeHtml(pd._rawBanner)}</div>`;
    html += '</div>';
  }

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
    html += '<img src="icons/icon128.jpg" style="width:40px;height:40px;border-radius:50%;margin-bottom:8px">';
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
  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => { state.tab = t.dataset.tab; render(); });
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
    if (state.tab === 'patient') render();
    if (msg.data.patientName) searchTickets(msg.data.patientName);
  }
  if (msg.type === 'SCRAPE_PROGRESS') {
    state.scrapeProgress = msg.status;
    render();
  }
  if (msg.type === 'CHART_SCAN_COMPLETE') {
    state.patientData = msg.data;
    if (msg.data.patientName) searchTickets(msg.data.patientName);
    showToast('Chart scan complete — ' + (msg.data._encountersScanned || 0) + ' encounters read');
    // Generate clinical snapshot via AI
    generateSnapshot(msg.data);
  }
});

// ── Init ──
(async function init() {
  await loadSettings();
  const authed = await checkAuth();
  render();
  if (authed) loadTickets();
})();
