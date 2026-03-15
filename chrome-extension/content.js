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

    // Fix date range if backwards
    if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
      report('Date range was backwards — swapping');
      const tmp = startDate; startDate = endDate; endDate = tmp;
    }

    // Step 1: Make sure we're on Summary
    report('Step 1: Reading Summary page...');
    const summaryTab = sel('[data-element="patient-header-tab-Summary"]');
    if (summaryTab) { summaryTab.click(); await sleep(2000); }

    Object.assign(chart, scrapePatientData());
    const foundFields = Object.keys(chart).filter(k => !k.startsWith('_') && chart[k] && (Array.isArray(chart[k]) ? chart[k].length > 0 : true));
    report('Summary: ' + foundFields.length + ' fields, ' + (chart.medications?.length || 0) + ' meds, ' + (chart.diagnoses?.length || 0) + ' dx');

    if (!chart.patientName) {
      report('WARNING: No patient name — are you on a patient chart?');
      errors.push('No patient name detected');
    }

    // Step 2: Go to Timeline
    report('Step 2: Opening Timeline...');
    const timelineTab = sel('[data-element="patient-header-tab-Timeline"]');
    if (!timelineTab) {
      report('ERROR: Timeline tab not found');
      errors.push('Timeline tab not found');
      chart._errors = errors;
      chart._scanComplete = true;
      chart._encountersScanned = 0;
      return chart;
    }

    timelineTab.click();
    await sleep(3000);

    // Discover what's on the Timeline page
    const pageText = document.body.innerText;
    report('Timeline page loaded (' + pageText.length + ' chars)');

    // Look for "View all encounters" link
    const viewAllLinks = Array.from(document.querySelectorAll('a')).filter(a =>
      a.textContent.toLowerCase().includes('view all encounters') ||
      a.textContent.toLowerCase().includes('view all') ||
      (a.href && a.href.includes('timeline/encounter'))
    );
    report('Found ' + viewAllLinks.length + ' "view all" links');
    if (viewAllLinks.length > 0) {
      viewAllLinks[0].click();
      await sleep(2500);
      report('Clicked "View all encounters"');
    }

    // Try multiple strategies to find encounters
    let encounterItems = selAll('[data-element^="encounter-item-"]');
    report('Strategy 1 [data-element^="encounter-item-"]: ' + encounterItems.length + ' items');

    if (encounterItems.length === 0) {
      encounterItems = selAll('.encounter-list li');
      report('Strategy 2 .encounter-list li: ' + encounterItems.length + ' items');
    }
    if (encounterItems.length === 0) {
      encounterItems = selAll('.timeline-item, [class*="timeline"] li, [class*="encounter"] li');
      report('Strategy 3 timeline/encounter classes: ' + encounterItems.length + ' items');
    }
    if (encounterItems.length === 0) {
      // Look for any list items with dates
      const allLis = selAll('li');
      encounterItems = allLis.filter(li => {
        const t = li.textContent;
        return t.match(/\d{2}\/\d{2}\/\d{4}/) && t.length > 20 && t.length < 500;
      });
      report('Strategy 4 (li with dates): ' + encounterItems.length + ' items');
    }
    if (encounterItems.length === 0) {
      // Last resort: find clickable elements with dates
      const allClickable = selAll('a, [role="link"], [role="button"]');
      encounterItems = allClickable.filter(el => {
        const t = el.textContent;
        return t.match(/\d{2}\/\d{2}\/\d{4}/) && t.length > 10;
      });
      report('Strategy 5 (clickable with dates): ' + encounterItems.length + ' items');
    }

    if (encounterItems.length === 0) {
      report('WARNING: No encounters found on Timeline page');
      report('Page snippet: ' + pageText.substring(0, 500).replace(/\n/g, ' | '));
      // Dump some DOM info for debugging
      const allDataElements = selAll('[data-element]').map(el => el.getAttribute('data-element')).slice(0, 30);
      report('data-elements found: ' + allDataElements.join(', '));
    }

    chart.encounterDetails = [];
    let scanned = 0;
    let skipped = 0;

    for (let i = 0; i < encounterItems.length; i++) {
      const item = encounterItems[i];
      // Find the date in this encounter
      const dateMatch = item.textContent.match(/(\d{2}\/\d{2}\/\d{4})/);
      const dateText = dateMatch ? dateMatch[1] : null;
      const encounterDate = parseDate(dateText);

      // Date range filter
      if (encounterDate && startDate) {
        if (encounterDate < new Date(startDate)) { skipped++; continue; }
      }
      if (encounterDate && endDate) {
        if (encounterDate > new Date(endDate)) { skipped++; continue; }
      }

      const encounterLabel = item.textContent.trim().replace(/\s+/g, ' ').substring(0, 120);
      report('Encounter ' + (scanned + 1) + ': ' + (dateText || '?') + ' — ' + encounterLabel.substring(0, 60));

      try {
        const urlBefore = location.href;

        // Click the encounter
        const clickTarget = item.querySelector('.text-color-link') || item.querySelector('a') || item;
        report('  Clicking: <' + clickTarget.tagName + '> "' + clickTarget.textContent.trim().substring(0, 30) + '"');
        clickTarget.click();
        await sleep(3000);

        const urlAfter = location.href;
        const navigated = urlAfter !== urlBefore;
        report('  URL changed: ' + (navigated ? 'YES' : 'NO'));

        // Read content
        const content = document.body.innerText.substring(0, 8000);
        const hasClinical = content.includes('Chief Complaint') || content.includes('Assessment') || content.includes('Plan') || content.includes('Subjective') || content.includes('HPI') || content.includes('Objective');

        chart.encounterDetails.push({
          date: dateText,
          summary: encounterLabel,
          content: content,
          navigated: navigated,
          hasClinicalContent: hasClinical,
        });
        scanned++;
        report('  Saved (' + content.length + ' chars, clinical: ' + (hasClinical ? 'YES' : 'no') + ')');

        // Go back
        if (navigated) {
          // Try back button or timeline tab
          const backBtn = Array.from(document.querySelectorAll('button, a')).find(el => {
            const t = el.textContent.trim().toLowerCase();
            return t === 'back' || t.includes('back to') || t === '←';
          });
          if (backBtn) { backBtn.click(); await sleep(2500); }
          else {
            const tl = sel('[data-element="patient-header-tab-Timeline"]');
            if (tl) { tl.click(); await sleep(2500); }
          }
          // Re-find encounters
          encounterItems = selAll('[data-element^="encounter-item-"]');
          if (encounterItems.length === 0) encounterItems = selAll('.encounter-list li');
          if (encounterItems.length === 0) {
            const allLis = selAll('li');
            encounterItems = allLis.filter(li => li.textContent.match(/\d{2}\/\d{2}\/\d{4}/) && li.textContent.length > 20 && li.textContent.length < 500);
          }
          report('  Back — re-found ' + encounterItems.length + ' encounters');
        }
      } catch(e) {
        report('ERROR: ' + e.message);
        errors.push('Encounter ' + (dateText || i) + ': ' + e.message);
        const tl = sel('[data-element="patient-header-tab-Timeline"]');
        if (tl) { tl.click(); await sleep(2000); }
      }

      if (scanned >= 10) { report('Reached 10 encounter limit'); break; }
    }

    report('Scanned: ' + scanned + ', Skipped: ' + skipped + ', Errors: ' + errors.length);

    // Return to Summary
    report('Returning to Summary...');
    const sumTab = sel('[data-element="patient-header-tab-Summary"]');
    if (sumTab) { sumTab.click(); await sleep(1500); }

    chart._scanComplete = true;
    chart._encountersScanned = scanned;
    chart._encountersSkipped = skipped;
    chart._errors = errors;
    report('Chart scan done');
    return chart;
  }

  // ── Message Handling ──
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'SCRAPE_PATIENT') {
      try {
        const data = scrapePatientData();
        report('Patient overview: ' + (data.patientName || 'no name') + ', ' + (data.medications?.length || 0) + ' meds');
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
        report('FATAL: ' + e.message);
        chrome.runtime.sendMessage({ type: 'CHART_SCAN_COMPLETE', data: { _errors: [e.message], _scanComplete: true, _encountersScanned: 0 } });
      });
      sendResponse({ success: true, started: true });
    }
    return true;
  });

  // Auto-scrape
  setTimeout(() => {
    const data = scrapePatientData();
    if (data.patientName) {
      report('Auto-detected: ' + data.patientName);
      chrome.runtime.sendMessage({ type: 'PATIENT_DATA', data });
    }
  }, 3000);

  // SPA navigation
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

  report('Content script ready on ' + location.hostname);
})();
