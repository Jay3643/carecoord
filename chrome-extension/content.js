// Content script — runs on Practice Fusion pages
// Reads patient data from the DOM and can fill fields

(function() {
  'use strict';

  // ── Patient Data Scraping ──
  // These selectors target Practice Fusion's DOM structure.
  // They may need updating if PF changes their UI.
  function scrapePatientData() {
    const data = {};

    // Try multiple selector strategies for patient name
    const nameSelectors = [
      '.patient-name', '.patient-header-name', '[data-qa="patient-name"]',
      '.demographics-name', '.chart-patient-name', 'h1.patient-name',
      '.patient-banner .name', '.patient-info .name',
      // Generic fallback: look for a prominent name-like element
      '.banner-container h1', '.banner-container h2',
    ];
    for (const sel of nameSelectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim()) { data.patientName = el.textContent.trim(); break; }
    }

    // DOB
    const dobSelectors = [
      '[data-qa="patient-dob"]', '.patient-dob', '.demographics-dob',
      '.patient-banner .dob', '.patient-info .dob',
    ];
    for (const sel of dobSelectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim()) { data.dob = el.textContent.trim().replace(/DOB:?\s*/i, ''); break; }
    }

    // If specific selectors fail, try to find DOB in nearby text
    if (!data.dob) {
      const allText = document.body.innerText;
      const dobMatch = allText.match(/(?:DOB|Date of Birth|Birth Date)[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
      if (dobMatch) data.dob = dobMatch[1];
    }

    // Gender
    const genderSelectors = [
      '[data-qa="patient-gender"]', '.patient-gender', '.demographics-gender',
    ];
    for (const sel of genderSelectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim()) { data.gender = el.textContent.trim(); break; }
    }

    // Phone
    const phoneSelectors = [
      '[data-qa="patient-phone"]', '.patient-phone', '.demographics-phone',
      '.contact-phone', '.phone-number',
    ];
    for (const sel of phoneSelectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim()) { data.phone = el.textContent.trim(); break; }
    }
    if (!data.phone) {
      const phoneMatch = document.body.innerText.match(/(?:Phone|Tel|Mobile)[:\s]*(\(?\d{3}\)?[\s\-\.]\d{3}[\s\-\.]\d{4})/i);
      if (phoneMatch) data.phone = phoneMatch[1];
    }

    // Insurance
    const insuranceSelectors = [
      '[data-qa="insurance-name"]', '.insurance-name', '.insurance-plan',
      '.coverage-name', '.payer-name',
    ];
    for (const sel of insuranceSelectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim()) { data.insurance = el.textContent.trim(); break; }
    }

    // Member ID
    const memberSelectors = [
      '[data-qa="member-id"]', '.member-id', '.subscriber-id', '.policy-number',
    ];
    for (const sel of memberSelectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim()) { data.memberId = el.textContent.trim(); break; }
    }

    // Address
    const addressSelectors = [
      '[data-qa="patient-address"]', '.patient-address', '.demographics-address',
      '.address-line', '.contact-address',
    ];
    for (const sel of addressSelectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim()) { data.address = el.textContent.trim(); break; }
    }

    // Medications — look for medication lists
    const medSelectors = [
      '.medication-list', '.medications-panel', '[data-qa="medications"]',
      '.med-list', '.active-medications',
    ];
    for (const sel of medSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const meds = Array.from(el.querySelectorAll('li, .medication-item, .med-item, tr'))
          .map(m => m.textContent.trim()).filter(Boolean).slice(0, 20);
        if (meds.length) { data.medications = meds; break; }
      }
    }

    // Allergies
    const allergySelectors = [
      '.allergy-list', '.allergies-panel', '[data-qa="allergies"]',
    ];
    for (const sel of allergySelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const allergies = Array.from(el.querySelectorAll('li, .allergy-item, tr'))
          .map(a => a.textContent.trim()).filter(Boolean).slice(0, 10);
        if (allergies.length) { data.allergies = allergies; break; }
      }
    }

    // Diagnoses / Problem list
    const diagSelectors = [
      '.problem-list', '.diagnoses-panel', '[data-qa="problems"]',
      '.active-problems', '.diagnosis-list',
    ];
    for (const sel of diagSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const diag = Array.from(el.querySelectorAll('li, .problem-item, .diagnosis-item, tr'))
          .map(d => d.textContent.trim()).filter(Boolean).slice(0, 20);
        if (diag.length) { data.diagnoses = diag; break; }
      }
    }

    // Fallback: grab all visible text from the patient banner area
    if (!data.patientName) {
      const banner = document.querySelector('.patient-banner, .patient-header, .chart-header, .patient-demographics');
      if (banner) {
        data._rawBanner = banner.innerText.substring(0, 1000);
      }
    }

    // Grab the full visible page text for AI analysis (truncated)
    data._pageContext = document.body.innerText.substring(0, 5000);

    return data;
  }

  // ── Field Filling ──
  function fillField(selector, value) {
    const el = document.querySelector(selector);
    if (!el) return false;
    el.focus();
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  // ── Message Handling ──
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'SCRAPE_PATIENT') {
      const data = scrapePatientData();
      sendResponse({ success: true, data });
    }
    if (msg.type === 'FILL_FIELD') {
      const ok = fillField(msg.selector, msg.value);
      sendResponse({ success: ok });
    }
    return true;
  });

  // Auto-scrape when page loads and notify
  setTimeout(() => {
    const data = scrapePatientData();
    if (data.patientName || data._rawBanner) {
      chrome.runtime.sendMessage({ type: 'PATIENT_DATA', data });
    }
  }, 3000);

  // Watch for navigation changes (PF is a SPA)
  let lastUrl = location.href;
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(() => {
        const data = scrapePatientData();
        if (data.patientName || data._rawBanner) {
          chrome.runtime.sendMessage({ type: 'PATIENT_DATA', data });
        }
      }, 2000);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  console.log('[CareCoord] Content script loaded on Practice Fusion');
})();
