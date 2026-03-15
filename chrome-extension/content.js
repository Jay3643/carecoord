// Content script — Practice Fusion Ember.js app
// Uses exact data-element selectors from PF's DOM

(function() {
  'use strict';

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  function txt(el) { return el ? el.textContent.trim() : null; }
  function sel(s) { return document.querySelector(s); }
  function selAll(s) { return Array.from(document.querySelectorAll(s)); }

  // ── Scrape patient banner ──
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
    if (phoneEl) {
      const phoneText = phoneEl.textContent.replace(/M:\s*/i, '').trim();
      if (phoneText) data.phone = phoneText;
    }

    return data;
  }

  // ── Scrape Summary page sections ──
  function scrapeSummary() {
    const data = {};

    // Allergies
    const allergyCard = sel('[data-element="allergies-list"]');
    if (allergyCard) {
      data.allergies = [];
      if (allergyCard.textContent.includes('no known drug allergies')) data.allergies.push('NKDA (No known drug allergies)');
      const drugList = allergyCard.querySelectorAll('[data-element="drug"] .list li');
      drugList.forEach(li => { const t = txt(li); if (t) data.allergies.push('Drug: ' + t); });
      const foodList = allergyCard.querySelectorAll('[data-element="food"] .list li');
      foodList.forEach(li => { const t = txt(li); if (t) data.allergies.push('Food: ' + t); });
      if (allergyCard.textContent.includes('No food allergies')) data.allergies.push('No food allergies');
      if (allergyCard.textContent.includes('No environmental allergies')) data.allergies.push('No environmental allergies');
    }

    // Medications
    data.medications = selAll('[data-element^="medication-summary-list-item"] [data-element="medication-name"]')
      .map(el => {
        const li = el.closest('li');
        return li ? li.textContent.trim().replace(/\s+/g, ' ') : txt(el);
      }).filter(Boolean);

    // Diagnoses
    data.diagnoses = selAll('[data-element^="diagnosis-item-text"]').map(el => txt(el)).filter(Boolean);

    // Health concerns
    const hcNote = sel('[data-element="current-health-concern-note"]');
    if (hcNote) {
      data.healthConcerns = hcNote.innerHTML.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').trim();
    }

    // Encounters
    data.encounters = selAll('[data-element^="encounter-item-"]').map(li => {
      return txt(li)?.replace(/\s+/g, ' ');
    }).filter(Boolean);

    // Social history
    const shCard = sel('[data-element="social-history-card"]');
    if (shCard) {
      data.socialHistory = {};
      const tobacco = shCard.querySelector('[data-element="tobaccoUse-section"]');
      if (tobacco) data.socialHistory.tobacco = txt(tobacco.querySelector('a')) || txt(tobacco);
      const socialFree = shCard.querySelector('[data-element="socialHistory-section"]');
      if (socialFree) data.socialHistory.freeText = socialFree.querySelector('a')?.innerHTML?.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').trim();
      const genderEl = shCard.querySelector('[data-element="genderIdentity-section"]');
      if (genderEl) data.socialHistory.genderIdentity = txt(genderEl.querySelector('a'));
      const nutrition = shCard.querySelector('[data-element="nutritionHistory-section"]');
      if (nutrition) data.socialHistory.nutrition = txt(nutrition.querySelector('a'));
    }

    // Past medical history
    const pmhCard = sel('[data-element="past-medical-history-card"]');
    if (pmhCard) {
      data.pastMedicalHistory = {};
      const events = pmhCard.querySelector('[data-element="events-section"]');
      if (events) data.pastMedicalHistory.majorEvents = txt(events.querySelector('a'));
      const ongoing = pmhCard.querySelector('[data-element="ongoingMedicalProblems-section"]');
      if (ongoing) data.pastMedicalHistory.ongoingProblems = txt(ongoing.querySelector('a'));
      const preventive = pmhCard.querySelector('[data-element="preventativeCare-section"]');
      if (preventive) data.pastMedicalHistory.preventiveCare = preventive.querySelector('a')?.innerHTML?.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').trim();
    }

    // Family health history
    data.familyHistory = txt(sel('[data-element="family-history-text"]'));

    // Advance directives
    data.advanceDirectives = txt(sel('[data-element="advanced-directive-comments"]'));
    const adDate = txt(sel('[data-element="advanced-directive-recorded-date"]'));
    if (adDate) data.advanceDirectivesDate = adDate;

    // Screenings/Interventions/Assessments
    const siaList = sel('[data-element="sia-list"]');
    if (siaList) {
      data.screenings = selAll('[data-element^="sia-name-"]').map((el, i) => {
        const name = txt(el);
        const date = txt(sel(`[data-element="sia-start-date-${i}"]`));
        const status = txt(sel(`[data-element="sia-status-${i}"]`));
        return [name, date, status].filter(Boolean).join(' | ');
      }).filter(Boolean);
    }

    // Flowsheets
    data.flowsheets = selAll('[data-element="summary-flowsheet-list-item"] a').map(a => txt(a)).filter(Boolean);

    // Implantable devices
    const devCard = sel('[data-element="implantable-devices-card"]');
    if (devCard) {
      if (devCard.textContent.includes('no implantable device')) data.implantableDevices = 'None';
    }

    // Messages
    const msgCard = sel('[data-element="messages-card"]');
    if (msgCard) data.messages = msgCard.textContent.includes('No messages') ? 'None' : txt(msgCard.querySelector('.card__content'));

    // Appointments
    const aptCard = sel('[data-element="appointment-list-card"]');
    if (aptCard) data.appointments = aptCard.textContent.includes('No appointments') ? 'None' : txt(aptCard.querySelector('.card__content'));

    // Patient risk score
    const riskEl = sel('[data-element="patient-risk-score-placeholder-text"]');
    if (riskEl) data.riskScore = txt(riskEl);

    return data;
  }

  // ── Quick scrape ──
  function scrapePatientData() {
    const banner = parseBanner();
    const summary = scrapeSummary();
    const data = { ...banner, ...summary };
    data._pageContext = document.body.innerText.substring(0, 12000);
    return data;
  }

  // ── Deep Chart Scrape ──
  async function deepScrapeChart(progressCallback) {
    const fullChart = {};

    // Step 1: Scrape Summary
    progressCallback?.('Reading Summary...');
    Object.assign(fullChart, scrapePatientData());
    fullChart._sections = { Summary: document.body.innerText.substring(0, 10000) };

    // Step 2: Click through tabs using exact PF selectors
    const tabs = [
      { name: 'Timeline', selector: '[data-element="patient-header-tab-Timeline"]' },
      { name: 'Documents', selector: '[data-element="patient-header-tab-Documents"]' },
      { name: 'Profile', selector: '[data-element="patient-header-tab-Profile"]' },
    ];

    for (const tab of tabs) {
      progressCallback?.('Reading ' + tab.name + '...');
      const link = sel(tab.selector);
      if (link) {
        link.click();
        await sleep(2500);
        fullChart._sections[tab.name] = document.body.innerText.substring(0, 10000);

        // Extract extra data from Profile
        if (tab.name === 'Profile') {
          const text = document.body.innerText;
          const extract = (pattern) => { const m = text.match(pattern); return m ? m[1].trim() : null; };
          if (!fullChart.address) fullChart.address = extract(/(?:Address|Street)[:\s]*([^\n]+)/i);
          if (!fullChart.email) fullChart.email = extract(/(?:Email)[:\s]*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
          fullChart.emergencyContact = extract(/(?:Emergency Contact|Emergency)[:\s]*([^\n]+)/i);
          fullChart.language = extract(/(?:Language|Preferred Language)[:\s]*([^\n]+)/i);
          fullChart.race = extract(/(?:Race|Ethnicity)[:\s]*([^\n]+)/i);
          fullChart.maritalStatus = extract(/(?:Marital|Marital Status)[:\s]*([^\n]+)/i);
          fullChart.pharmacy = extract(/(?:Pharmacy|Preferred Pharmacy)[:\s]*([^\n]+)/i);
        }

        // Extract encounters from Timeline
        if (tab.name === 'Timeline') {
          const lines = document.body.innerText.split('\n');
          const encounters = lines.filter(l => l.match(/\d{2}\/\d{2}\/\d{4}/) && l.length > 10 && l.length < 300).map(l => l.trim());
          if (encounters.length > (fullChart.encounters?.length || 0)) fullChart.encounters = encounters.slice(0, 50);
        }
      } else {
        fullChart._sections[tab.name] = null;
      }
    }

    // Step 3: Go back to Summary
    progressCallback?.('Returning to Summary...');
    const summaryTab = sel('[data-element="patient-header-tab-Summary"]');
    if (summaryTab) { summaryTab.click(); await sleep(1500); }

    // Build full context
    let ctx = '';
    for (const [name, text] of Object.entries(fullChart._sections)) {
      if (text) ctx += '\n\n== ' + name.toUpperCase() + ' ==\n' + text;
    }
    fullChart._fullChartContext = ctx.substring(0, 40000);
    fullChart._sectionsFound = Object.values(fullChart._sections).filter(Boolean).length;
    fullChart._sectionsTotal = Object.keys(fullChart._sections).length;

    progressCallback?.('Done — ' + fullChart._sectionsFound + ' sections read');
    return fullChart;
  }

  // ── Message Handling ──
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'SCRAPE_PATIENT') {
      sendResponse({ success: true, data: scrapePatientData() });
    }
    if (msg.type === 'DEEP_SCRAPE') {
      deepScrapeChart((status) => {
        chrome.runtime.sendMessage({ type: 'SCRAPE_PROGRESS', status });
      }).then(data => {
        chrome.runtime.sendMessage({ type: 'DEEP_SCRAPE_COMPLETE', data });
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
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(() => {
        const data = scrapePatientData();
        if (data.patientName) chrome.runtime.sendMessage({ type: 'PATIENT_DATA', data });
      }, 2000);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  console.log('[CareCoord] Content script loaded — PF data-element selectors active');
})();
