// Content script — Practice Fusion Ember.js app
// Uses exact data-element selectors from PF's DOM

(function() {
  'use strict';

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  function txt(el) { return el ? el.textContent.trim() : null; }
  function sel(s) { return document.querySelector(s); }
  function selAll(s) { return Array.from(document.querySelectorAll(s)); }

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

    // Allergies
    const allergyCard = sel('[data-element="allergies-list"]');
    if (allergyCard) {
      data.allergies = [];
      if (allergyCard.textContent.includes('no known drug allergies')) data.allergies.push('NKDA');
      selAll('[data-element="drug"] .list li').forEach(li => { const t = txt(li); if (t) data.allergies.push('Drug: ' + t); });
      if (allergyCard.textContent.includes('No food allergies')) data.allergies.push('No food allergies');
      if (allergyCard.textContent.includes('No environmental allergies')) data.allergies.push('No environmental allergies');
    }

    // Medications
    data.medications = selAll('[data-element^="medication-summary-list-item"]').map(li => li.textContent.trim().replace(/\s+/g, ' ')).filter(Boolean);

    // Diagnoses
    data.diagnoses = selAll('[data-element^="diagnosis-item-text"]').map(el => txt(el)).filter(Boolean);

    // Health concerns
    const hcNote = sel('[data-element="current-health-concern-note"]');
    if (hcNote) data.healthConcerns = hcNote.innerHTML.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').trim();

    // Encounters (summary list)
    data.encounters = selAll('[data-element^="encounter-item-"]').map(li => txt(li)?.replace(/\s+/g, ' ')).filter(Boolean);

    // Social history
    const shCard = sel('[data-element="social-history-card"]');
    if (shCard) {
      data.socialHistory = {};
      const tobacco = shCard.querySelector('[data-element="tobaccoUse-section"] a');
      if (tobacco) data.socialHistory.tobacco = txt(tobacco);
      const socialFree = shCard.querySelector('[data-element="socialHistory-section"] a');
      if (socialFree) data.socialHistory.freeText = socialFree.innerHTML.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').trim();
      const genderEl = shCard.querySelector('[data-element="genderIdentity-section"] a');
      if (genderEl) data.socialHistory.genderIdentity = txt(genderEl);
    }

    // Past medical history
    const pmhCard = sel('[data-element="past-medical-history-card"]');
    if (pmhCard) {
      data.pastMedicalHistory = {};
      const ev = pmhCard.querySelector('[data-element="events-section"] a');
      if (ev) data.pastMedicalHistory.majorEvents = txt(ev);
      const ongoing = pmhCard.querySelector('[data-element="ongoingMedicalProblems-section"] a');
      if (ongoing) data.pastMedicalHistory.ongoingProblems = txt(ongoing);
      const prev = pmhCard.querySelector('[data-element="preventativeCare-section"] a');
      if (prev) data.pastMedicalHistory.preventiveCare = prev.innerHTML.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').trim();
    }

    // Family history, advance directives
    data.familyHistory = txt(sel('[data-element="family-history-text"]'));
    data.advanceDirectives = txt(sel('[data-element="advanced-directive-comments"]'));

    // Screenings
    data.screenings = selAll('[data-element^="sia-name-"]').map((el, i) => {
      return [txt(el), txt(sel(`[data-element="sia-start-date-${i}"]`)), txt(sel(`[data-element="sia-status-${i}"]`))].filter(Boolean).join(' | ');
    }).filter(Boolean);

    // Flowsheets
    data.flowsheets = selAll('[data-element="summary-flowsheet-list-item"] a').map(a => txt(a)).filter(Boolean);

    return data;
  }

  // ── Patient Overview (quick read) ──
  function scrapePatientData() {
    const data = { ...parseBanner(), ...scrapeSummary() };
    data._pageContext = document.body.innerText.substring(0, 12000);
    return data;
  }

  // ── Parse a date string like "03/31/2026" to a Date ──
  function parseDate(str) {
    if (!str) return null;
    const m = str.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    return m ? new Date(parseInt(m[3]), parseInt(m[1]) - 1, parseInt(m[2])) : null;
  }

  // ── Chart Scan: Summary + encounters within date range ──
  async function chartScan(startDate, endDate, progressCallback) {
    const chart = {};

    // Step 1: Scrape Summary
    progressCallback?.('Reading Summary page...');
    // Make sure we're on Summary tab
    const summaryTab = sel('[data-element="patient-header-tab-Summary"]');
    if (summaryTab && !summaryTab.classList.contains('active')) { summaryTab.click(); await sleep(2000); }
    Object.assign(chart, scrapePatientData());

    // Step 2: Go to Timeline to find encounters
    progressCallback?.('Opening Timeline...');
    const timelineTab = sel('[data-element="patient-header-tab-Timeline"]');
    if (timelineTab) {
      timelineTab.click();
      await sleep(2500);

      // Look for "View all encounters" link first
      const viewAll = Array.from(document.querySelectorAll('a')).find(a => a.textContent.includes('View all encounters'));
      if (viewAll) { viewAll.click(); await sleep(2000); }

      // Find all encounter rows in the timeline
      const encounterLinks = selAll('[data-element^="encounter-item-"] .text-color-link, .encounter-list a.text-color-link, [data-element^="encounter-item-"] span.text-color-link');

      // Also try broader selector for timeline items
      let encounterItems = selAll('[data-element^="encounter-item-"]');
      if (encounterItems.length === 0) {
        encounterItems = selAll('.encounter-list li, .timeline-item');
      }

      chart.encounterDetails = [];
      let scanned = 0;

      for (const item of encounterItems) {
        const dateText = item.querySelector('.text-color-link, span')?.textContent?.trim();
        const encounterDate = parseDate(dateText);

        // Check if within date range
        if (encounterDate) {
          const start = startDate ? new Date(startDate) : new Date(0);
          const end = endDate ? new Date(endDate) : new Date();
          if (encounterDate < start || encounterDate > end) continue;
        }

        // Click into the encounter
        const clickable = item.querySelector('.text-color-link, a') || item;
        progressCallback?.('Reading encounter ' + (dateText || '') + '...');

        try {
          clickable.click();
          await sleep(2500);

          // Scrape the encounter content
          const encounterContent = document.body.innerText.substring(0, 8000);
          const encounterSummary = item.textContent.trim().replace(/\s+/g, ' ');

          chart.encounterDetails.push({
            date: dateText,
            summary: encounterSummary,
            content: encounterContent,
          });

          scanned++;

          // Go back to timeline
          const backBtn = sel('.composable-header__back-button, [data-element="encounter-back-button"]')
            || Array.from(document.querySelectorAll('button, a')).find(el => el.textContent.trim() === 'Back' || el.textContent.includes('←'));

          if (backBtn) {
            backBtn.click();
            await sleep(2000);
          } else {
            // Try browser back or re-click timeline tab
            const tl = sel('[data-element="patient-header-tab-Timeline"]');
            if (tl) { tl.click(); await sleep(2000); }
          }

          // Cap at 10 encounters to avoid excessive scanning
          if (scanned >= 10) {
            progressCallback?.('Reached 10 encounter limit');
            break;
          }
        } catch(e) {
          console.log('[CareCoord] Error reading encounter:', e);
        }
      }

      progressCallback?.('Scanned ' + scanned + ' encounters');
    }

    // Step 3: Return to Summary
    progressCallback?.('Returning to Summary...');
    const sumTab = sel('[data-element="patient-header-tab-Summary"]');
    if (sumTab) { sumTab.click(); await sleep(1500); }

    chart._scanComplete = true;
    chart._encountersScanned = chart.encounterDetails?.length || 0;
    progressCallback?.('Done — ' + chart._encountersScanned + ' encounters scanned');

    return chart;
  }

  // ── Message Handling ──
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'SCRAPE_PATIENT') {
      sendResponse({ success: true, data: scrapePatientData() });
    }
    if (msg.type === 'CHART_SCAN') {
      chartScan(msg.startDate, msg.endDate, (status) => {
        chrome.runtime.sendMessage({ type: 'SCRAPE_PROGRESS', status });
      }).then(data => {
        chrome.runtime.sendMessage({ type: 'CHART_SCAN_COMPLETE', data });
      });
      sendResponse({ success: true, started: true });
    }
    if (msg.type === 'GET_PAGE_TEXT') {
      sendResponse({ success: true, text: document.body.innerText.substring(0, msg.maxLength || 15000) });
    }
    return true;
  });

  // Auto-scrape on page load
  setTimeout(() => {
    const data = scrapePatientData();
    if (data.patientName) chrome.runtime.sendMessage({ type: 'PATIENT_DATA', data });
  }, 3000);

  // Watch for SPA navigation
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

  console.log('[CareCoord] Content script loaded — chart scan ready');
})();
