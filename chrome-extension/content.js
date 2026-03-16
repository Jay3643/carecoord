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

  // ── Chart Scan — reads Summary + all encounter info ──
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
    report('Summary: ' + (chart.patientName || 'no name') + ' | ' + (chart.medications?.length || 0) + ' meds | ' + (chart.diagnoses?.length || 0) + ' dx');

    // Step 2: Read encounter details from Summary page
    report('Step 2: Reading encounters from Summary...');
    const encounterItems = selAll('[data-element^="encounter-item-"]');
    report('Found ' + encounterItems.length + ' encounters on Summary');

    chart.encounterDetails = [];
    let scanned = 0;
    let skipped = 0;

    for (const item of encounterItems) {
      const dateMatch = item.textContent.match(/(\d{2}\/\d{2}\/\d{4})/);
      const dateText = dateMatch ? dateMatch[1] : null;
      const encounterDate = parseDate(dateText);

      // Date range filter
      if (encounterDate && startDate && encounterDate < new Date(startDate)) { skipped++; continue; }
      if (encounterDate && endDate && encounterDate > new Date(endDate)) { skipped++; continue; }

      // Extract all text from this encounter item
      const title = item.getAttribute('title') || '';
      const type = txt(item.querySelector('[data-element="encounter-type"]')) || '';
      const code = txt(item.querySelector('[data-element="code-type-and-code-value"]')) || '';
      const cc = txt(item.querySelector('.chief-complaint')) || '';
      const fullText = item.textContent.trim().replace(/\s+/g, ' ');

      chart.encounterDetails.push({
        date: dateText,
        type: title || type,
        code: code,
        chiefComplaint: cc.replace('CC:', '').trim(),
        summary: fullText,
      });
      scanned++;
      report('  ' + (dateText || '?') + ' — ' + (title || type || 'encounter') + (cc ? ' | CC: ' + cc.replace('CC:','').trim() : ''));
    }

    // Step 3: Click "View all encounters in timeline" to get full list
    const viewAllLink = Array.from(document.querySelectorAll('a')).find(a =>
      a.textContent.includes('View all encounters') && a.href && a.href.includes('timeline/encounter')
    );
    if (viewAllLink && encounterItems.length < 10) {
      report('Step 3: Loading all encounters from timeline...');
      viewAllLink.click();
      await sleep(3000);

      // Read all encounters from the full timeline list
      const timelineItems = selAll('[data-element^="encounter-item-"]');
      report('Timeline has ' + timelineItems.length + ' total encounters');

      for (const item of timelineItems) {
        const dateMatch = item.textContent.match(/(\d{2}\/\d{2}\/\d{4})/);
        const dateText = dateMatch ? dateMatch[1] : null;
        const encounterDate = parseDate(dateText);

        if (encounterDate && startDate && encounterDate < new Date(startDate)) continue;
        if (encounterDate && endDate && encounterDate > new Date(endDate)) continue;

        // Skip if we already have this date
        if (chart.encounterDetails.some(e => e.date === dateText)) continue;

        const title = item.getAttribute('title') || '';
        const type = txt(item.querySelector('[data-element="encounter-type"]')) || '';
        const cc = txt(item.querySelector('.chief-complaint')) || '';

        chart.encounterDetails.push({
          date: dateText,
          type: title || type,
          chiefComplaint: cc.replace('CC:', '').trim(),
          summary: item.textContent.trim().replace(/\s+/g, ' '),
        });
        scanned++;
      }

      report('Total encounters after timeline: ' + chart.encounterDetails.length);

      // Return to Summary
      const sumTab = sel('[data-element="patient-header-tab-Summary"]');
      if (sumTab) { sumTab.click(); await sleep(1500); }
    }

    report('Done: ' + scanned + ' encounters, ' + skipped + ' skipped');

    chart._scanComplete = true;
    chart._encountersScanned = chart.encounterDetails.length;
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

  // ── Navigate to a PF section and read it ──
  async function navigateAndRead(section) {
    const sectionMap = {
      'summary': 'patient-header-tab-Summary',
      'timeline': 'patient-header-tab-Timeline',
      'documents': 'patient-header-tab-Documents',
      'profile': 'patient-header-tab-Profile',
      'payment': 'patient-header-tab-Payment collection',
      'ledger': 'patient-header-tab-Patient ledger',
    };

    const tabAttr = sectionMap[section.toLowerCase()];
    if (tabAttr) {
      const tab = sel('[data-element="' + tabAttr + '"]');
      if (tab) {
        report('Navigating to ' + section + '...');
        tab.click();
        await sleep(2500);

        // For Timeline: also read encounter details from the Summary page encounter list
        if (section.toLowerCase() === 'timeline') {
          // Click "Encounters" filter if available
          const encFilter = Array.from(document.querySelectorAll('a, button')).find(el =>
            el.textContent.trim().toLowerCase() === 'encounters' || el.textContent.trim().toLowerCase() === 'encounter'
          );
          if (encFilter) { encFilter.click(); await sleep(2000); }

          // Also try "View all encounters" link
          const viewAll = Array.from(document.querySelectorAll('a')).find(a =>
            a.textContent.includes('View all encounters') || (a.href && a.href.includes('timeline/encounter'))
          );
          if (viewAll) { viewAll.click(); await sleep(2000); }

          // Read the full encounter list with more text
          const text = document.body.innerText.substring(0, 10000);

          // Also build structured encounter data
          const encounterItems = selAll('[data-element^="encounter-item-"]');
          let encounterText = '\n\nSTRUCTURED ENCOUNTERS (' + encounterItems.length + ' total):\n';
          for (const item of encounterItems) {
            encounterText += item.textContent.trim().replace(/\s+/g, ' ') + '\n';
          }

          const sumTab = sel('[data-element="patient-header-tab-Summary"]');
          if (sumTab) { sumTab.click(); await sleep(1000); }
          return text + encounterText;
        }

        const text = document.body.innerText.substring(0, 8000);
        const sumTab = sel('[data-element="patient-header-tab-Summary"]');
        if (sumTab && section.toLowerCase() !== 'summary') { sumTab.click(); await sleep(1000); }
        return text;
      }
    }
    return null;
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'NAVIGATE_AND_READ') {
      navigateAndRead(msg.section).then(text => {
        sendResponse({ success: true, text: text });
      });
      return true;
    }
  });

  report('Ready on ' + location.hostname);
})();
