// Content script — Practice Fusion Ember.js app
(function() {
  'use strict';

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  function txt(el) { return el ? el.textContent.trim() : null; }
  function sel(s) { try { return document.querySelector(s); } catch(e) { return null; } }
  function selAll(s) { try { return Array.from(document.querySelectorAll(s)); } catch(e) { return []; } }

  function report(msg) {
    console.log('[CareCoord]', msg);
    try { chrome.runtime.sendMessage({ type: 'SCRAPE_PROGRESS', status: msg }); } catch(e) {}
  }

  function parseBanner() {
    const data = {};
    data.patientName = txt(sel('[data-element="patient-ribbon-patient-name"]'));
    data.prn = txt(sel('[data-element="patient-ribbon-prn"]'));
    data.dob = txt(sel('[data-element="patient-ribbon-dob"]'));
    data.insurance = txt(sel('[data-element="patient-ribbon-plan-name"]'));
    const ageGender = txt(sel('[data-element="patient-ribbon-age-gender"]'));
    if (ageGender) {
      const m = ageGender.match(/(\d+)\s*yrs?\s*([MF])/i);
      if (m) { data.age = m[1] + ' yrs'; data.gender = m[2] === 'M' ? 'Male' : 'Female'; }
    }
    const phoneEl = sel('[data-element="patient-ribbon-mobile-phone"]');
    if (phoneEl) { const p = phoneEl.textContent.replace(/M:\s*/i, '').trim(); if (p) data.phone = p; }
    return data;
  }

  function scrapeSummary() {
    const data = {};
    const allergyCard = sel('[data-element="allergies-list"]');
    if (allergyCard) {
      data.allergies = [];
      if (allergyCard.textContent.includes('no known drug allergies')) data.allergies.push('NKDA');
      if (allergyCard.textContent.includes('No food allergies')) data.allergies.push('No food allergies');
      if (allergyCard.textContent.includes('No environmental allergies')) data.allergies.push('No environmental allergies');
    }
    data.medications = selAll('[data-element^="medication-summary-list-item"]').map(li => li.textContent.trim().replace(/\s+/g, ' ')).filter(Boolean);
    data.diagnoses = selAll('[data-element^="diagnosis-item-text"]').map(el => txt(el)).filter(Boolean);
    const hcNote = sel('[data-element="current-health-concern-note"]');
    if (hcNote) data.healthConcerns = hcNote.innerHTML.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').trim();
    data.encounters = selAll('[data-element^="encounter-item-"]').map(li => txt(li)?.replace(/\s+/g, ' ')).filter(Boolean);
    const shCard = sel('[data-element="social-history-card"]');
    if (shCard) {
      data.socialHistory = {};
      const t = shCard.querySelector('[data-element="tobaccoUse-section"] a');
      if (t) data.socialHistory.tobacco = txt(t);
      const sf = shCard.querySelector('[data-element="socialHistory-section"] a');
      if (sf) data.socialHistory.freeText = sf.innerHTML.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').trim();
    }
    const pmhCard = sel('[data-element="past-medical-history-card"]');
    if (pmhCard) {
      data.pastMedicalHistory = {};
      const ev = pmhCard.querySelector('[data-element="events-section"] a');
      if (ev) data.pastMedicalHistory.majorEvents = txt(ev);
      const prev = pmhCard.querySelector('[data-element="preventativeCare-section"] a');
      if (prev) data.pastMedicalHistory.preventiveCare = prev.innerHTML.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').trim();
    }
    data.familyHistory = txt(sel('[data-element="family-history-text"]'));
    data.advanceDirectives = txt(sel('[data-element="advanced-directive-comments"]'));
    data.screenings = selAll('[data-element^="sia-name-"]').map((el, i) => {
      return [txt(el), txt(sel(`[data-element="sia-start-date-${i}"]`)), txt(sel(`[data-element="sia-status-${i}"]`))].filter(Boolean).join(' | ');
    }).filter(Boolean);
    data.flowsheets = selAll('[data-element="summary-flowsheet-list-item"] a').map(a => txt(a)).filter(Boolean);
    return data;
  }

  function scrapePatientData() {
    const data = { ...parseBanner(), ...scrapeSummary() };
    data._pageContext = document.body.innerText.substring(0, 15000);
    return data;
  }

  function parseDate(str) {
    if (!str) return null;
    const m = str.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    return m ? new Date(parseInt(m[3]), parseInt(m[1]) - 1, parseInt(m[2])) : null;
  }

  // ── Chart Scan — clicks encounters ON THE SUMMARY PAGE ──
  async function chartScan(startDate, endDate) {
    const chart = {};
    const errors = [];

    // Fix backwards dates
    if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
      const tmp = startDate; startDate = endDate; endDate = tmp;
    }

    // Step 1: Make sure we're on Summary
    report('Step 1: Reading Summary page...');
    const summaryTab = sel('[data-element="patient-header-tab-Summary"]');
    if (summaryTab) { summaryTab.click(); await sleep(2000); }

    // Scrape all summary data
    Object.assign(chart, scrapePatientData());
    report('Summary: ' + (chart.patientName || 'no name') + ' | ' + (chart.medications?.length || 0) + ' meds | ' + (chart.diagnoses?.length || 0) + ' dx | ' + (chart.encounters?.length || 0) + ' encounters listed');

    // Step 2: Click into encounters from the SUMMARY page encounter list
    report('Step 2: Reading encounters from Summary...');
    let encounterItems = selAll('[data-element^="encounter-item-"]');
    report('Found ' + encounterItems.length + ' encounters on Summary page');

    chart.encounterDetails = [];
    let scanned = 0;
    let skipped = 0;

    for (let i = 0; i < encounterItems.length; i++) {
      const item = encounterItems[i];
      const dateMatch = item.textContent.match(/(\d{2}\/\d{2}\/\d{4})/);
      const dateText = dateMatch ? dateMatch[1] : null;
      const encounterDate = parseDate(dateText);

      // Date range filter
      if (encounterDate && startDate && encounterDate < new Date(startDate)) { skipped++; continue; }
      if (encounterDate && endDate && encounterDate > new Date(endDate)) { skipped++; continue; }

      const label = item.textContent.trim().replace(/\s+/g, ' ').substring(0, 100);
      report('Encounter ' + (scanned + 1) + ': ' + (dateText || '?') + ' — ' + label.substring(0, 50));

      try {
        // Click the date link to open the encounter
        const dateLink = item.querySelector('.text-color-link');
        if (!dateLink) { report('  No clickable date link found — skipping'); continue; }

        const urlBefore = location.href;
        dateLink.click();
        await sleep(3000);

        const urlAfter = location.href;
        const navigated = urlAfter !== urlBefore;
        report('  Navigated: ' + (navigated ? 'YES' : 'NO') + ' | URL: ' + urlAfter.split('/').slice(-2).join('/'));

        // Read the encounter page content
        const content = document.body.innerText.substring(0, 10000);
        const hasClinical = content.includes('Chief Complaint') || content.includes('Assessment') || content.includes('Plan') || content.includes('Subjective') || content.includes('HPI') || content.includes('Objective') || content.includes('CC:');

        chart.encounterDetails.push({
          date: dateText,
          summary: label,
          content: content,
          navigated: navigated,
        });
        scanned++;
        report('  Read ' + content.length + ' chars (clinical notes: ' + (hasClinical ? 'YES' : 'summary only') + ')');

        // Go back to Summary
        if (navigated) {
          const sumTab = sel('[data-element="patient-header-tab-Summary"]');
          if (sumTab) { sumTab.click(); await sleep(2500); }

          // Re-find encounters after returning
          encounterItems = selAll('[data-element^="encounter-item-"]');
          report('  Returned to Summary — ' + encounterItems.length + ' encounters');
        }
      } catch(e) {
        report('ERROR: ' + e.message);
        errors.push(dateText + ': ' + e.message);
        const sumTab = sel('[data-element="patient-header-tab-Summary"]');
        if (sumTab) { sumTab.click(); await sleep(2000); }
        encounterItems = selAll('[data-element^="encounter-item-"]');
      }

      if (scanned >= 10) { report('Reached 10 encounter limit'); break; }
    }

    report('Done: ' + scanned + ' scanned, ' + skipped + ' skipped, ' + errors.length + ' errors');

    chart._scanComplete = true;
    chart._encountersScanned = scanned;
    chart._encountersSkipped = skipped;
    chart._errors = errors;
    return chart;
  }

  // ── Message Handling ──
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'SCRAPE_PATIENT') {
      try {
        const data = scrapePatientData();
        report('Overview: ' + (data.patientName || 'no name'));
        sendResponse({ success: true, data });
      } catch(e) { report('ERROR: ' + e.message); sendResponse({ success: false, error: e.message }); }
    }
    if (msg.type === 'CHART_SCAN') {
      chartScan(msg.startDate, msg.endDate).then(data => {
        chrome.runtime.sendMessage({ type: 'CHART_SCAN_COMPLETE', data });
      }).catch(e => {
        report('FATAL: ' + e.message);
        chrome.runtime.sendMessage({ type: 'CHART_SCAN_COMPLETE', data: { _errors: [e.message], _scanComplete: true, _encountersScanned: 0 } });
      });
      sendResponse({ success: true, started: true });
    }
    return true;
  });

  setTimeout(() => {
    const data = scrapePatientData();
    if (data.patientName) {
      report('Auto-detected: ' + data.patientName);
      chrome.runtime.sendMessage({ type: 'PATIENT_DATA', data });
    }
  }, 3000);

  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(() => {
        const data = scrapePatientData();
        if (data.patientName) chrome.runtime.sendMessage({ type: 'PATIENT_DATA', data });
      }, 2000);
    }
  }).observe(document.body, { childList: true, subtree: true });

  report('Ready on ' + location.hostname);
})();
