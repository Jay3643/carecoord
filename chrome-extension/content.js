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

  // ── Parse patient banner ──
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

  // ── Scrape Summary page ──
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
    data._pageContext = document.body.innerText.substring(0, 12000);
    return data;
  }

  function parseDate(str) {
    if (!str) return null;
    const m = str.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    return m ? new Date(parseInt(m[3]), parseInt(m[1]) - 1, parseInt(m[2])) : null;
  }

  // ── Chart Scan ──
  async function chartScan(startDate, endDate) {
    const chart = {};
    const errors = [];

    // Step 1: Ensure we're on Summary
    report('Step 1: Reading Summary page...');
    const summaryTab = sel('[data-element="patient-header-tab-Summary"]');
    if (summaryTab) {
      summaryTab.click();
      await sleep(2000);
    } else {
      report('WARNING: Summary tab not found — reading current page');
    }

    // Scrape summary
    Object.assign(chart, scrapePatientData());
    const foundFields = Object.keys(chart).filter(k => !k.startsWith('_') && chart[k] && (Array.isArray(chart[k]) ? chart[k].length > 0 : true));
    report('Summary: found ' + foundFields.length + ' data fields (' + (chart.patientName || 'no name') + ')');

    if (!chart.patientName) {
      report('WARNING: No patient name found — are you on a patient chart?');
      errors.push('No patient name detected. Make sure a patient chart is open in Practice Fusion.');
    }

    // Step 2: Go to Timeline
    report('Step 2: Opening Timeline...');
    const timelineTab = sel('[data-element="patient-header-tab-Timeline"]');
    if (!timelineTab) {
      report('ERROR: Timeline tab not found');
      errors.push('Timeline tab not found in PF');
      chart._errors = errors;
      chart._scanComplete = true;
      chart._encountersScanned = 0;
      return chart;
    }

    timelineTab.click();
    await sleep(3000);
    report('Timeline loaded');

    // Look for encounter links
    const viewAll = Array.from(document.querySelectorAll('a')).find(a => a.textContent.includes('View all encounters'));
    if (viewAll) {
      report('Found "View all encounters" link — clicking...');
      viewAll.click();
      await sleep(2500);
    }

    // Find encounter items
    let encounterItems = selAll('[data-element^="encounter-item-"]');
    report('Found ' + encounterItems.length + ' encounters in Timeline');

    if (encounterItems.length === 0) {
      // Try broader selector
      encounterItems = selAll('.encounter-list li');
      report('Fallback: found ' + encounterItems.length + ' encounters');
    }

    chart.encounterDetails = [];
    let scanned = 0;
    let skipped = 0;

    for (let i = 0; i < encounterItems.length; i++) {
      const item = encounterItems[i];
      const dateSpan = item.querySelector('.text-color-link, span');
      const dateText = dateSpan ? dateSpan.textContent.trim() : null;
      const encounterDate = parseDate(dateText);

      // Date range filter
      if (encounterDate && startDate) {
        if (encounterDate < new Date(startDate)) { skipped++; continue; }
      }
      if (encounterDate && endDate) {
        if (encounterDate > new Date(endDate)) { skipped++; continue; }
      }

      const encounterLabel = item.textContent.trim().replace(/\s+/g, ' ').substring(0, 100);
      report('Step 3.' + (scanned + 1) + ': Opening encounter ' + (dateText || '') + '...');

      try {
        const clickTarget = item.querySelector('.text-color-link') || item.querySelector('a') || item;
        clickTarget.click();
        await sleep(3000);

        // Read encounter content
        const content = document.body.innerText.substring(0, 8000);
        chart.encounterDetails.push({
          date: dateText,
          summary: encounterLabel,
          content: content,
        });
        scanned++;
        report('Read encounter ' + scanned + ' (' + (dateText || '?') + ')');

        // Navigate back
        const backBtn = sel('[data-element="encounter-back-button"]')
          || Array.from(document.querySelectorAll('button, a')).find(el => {
            const t = el.textContent.trim().toLowerCase();
            return t === 'back' || t === '← back' || t === 'back to timeline';
          });

        if (backBtn) {
          backBtn.click();
          await sleep(2500);
        } else {
          report('No back button — clicking Timeline tab');
          const tl = sel('[data-element="patient-header-tab-Timeline"]');
          if (tl) { tl.click(); await sleep(2500); }
        }

        // Re-find encounter items (DOM may have changed)
        encounterItems = selAll('[data-element^="encounter-item-"]');
        if (encounterItems.length === 0) encounterItems = selAll('.encounter-list li');

      } catch(e) {
        report('ERROR reading encounter: ' + e.message);
        errors.push('Failed to read encounter ' + (dateText || i));
        // Try to recover
        const tl = sel('[data-element="patient-header-tab-Timeline"]');
        if (tl) { tl.click(); await sleep(2000); }
      }

      if (scanned >= 10) {
        report('Reached 10 encounter limit');
        break;
      }
    }

    report('Skipped ' + skipped + ' encounters outside date range');

    // Step 4: Return to Summary
    report('Step 4: Returning to Summary...');
    const sumTab = sel('[data-element="patient-header-tab-Summary"]');
    if (sumTab) { sumTab.click(); await sleep(1500); }

    chart._scanComplete = true;
    chart._encountersScanned = scanned;
    chart._encountersSkipped = skipped;
    chart._errors = errors;

    if (errors.length > 0) report('Completed with ' + errors.length + ' error(s)');
    else report('Chart scan complete — ' + scanned + ' encounters scanned');

    return chart;
  }

  // ── Message Handling ──
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'SCRAPE_PATIENT') {
      try {
        const data = scrapePatientData();
        const fields = Object.keys(data).filter(k => !k.startsWith('_') && data[k]);
        report('Patient overview: ' + fields.length + ' fields (' + (data.patientName || 'no name') + ')');
        sendResponse({ success: true, data });
      } catch(e) {
        report('ERROR: ' + e.message);
        sendResponse({ success: false, error: e.message });
      }
    }
    if (msg.type === 'CHART_SCAN') {
      report('Chart scan starting...');
      chartScan(msg.startDate, msg.endDate).then(data => {
        chrome.runtime.sendMessage({ type: 'CHART_SCAN_COMPLETE', data });
      }).catch(e => {
        report('FATAL ERROR: ' + e.message);
        chrome.runtime.sendMessage({ type: 'CHART_SCAN_COMPLETE', data: { _errors: [e.message], _scanComplete: true, _encountersScanned: 0 } });
      });
      sendResponse({ success: true, started: true });
    }
    return true;
  });

  // Auto-scrape on page load
  setTimeout(() => {
    const data = scrapePatientData();
    if (data.patientName) {
      report('Auto-detected patient: ' + data.patientName);
      chrome.runtime.sendMessage({ type: 'PATIENT_DATA', data });
    }
  }, 3000);

  // SPA navigation watcher
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(() => {
        const data = scrapePatientData();
        if (data.patientName) {
          report('Navigation detected — patient: ' + data.patientName);
          chrome.runtime.sendMessage({ type: 'PATIENT_DATA', data });
        }
      }, 2000);
    }
  }).observe(document.body, { childList: true, subtree: true });

  report('Content script loaded on ' + location.hostname);
})();
