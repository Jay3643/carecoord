// Content script — runs on Practice Fusion pages
// Navigates through patient chart sections and scrapes full chart data

(function() {
  'use strict';

  // ── Utility: wait for element to appear ──
  function waitFor(selectorOrFn, timeout = 5000) {
    return new Promise((resolve) => {
      const check = typeof selectorOrFn === 'function' ? selectorOrFn : () => document.querySelector(selectorOrFn);
      const el = check();
      if (el) return resolve(el);
      const start = Date.now();
      const interval = setInterval(() => {
        const el = check();
        if (el || Date.now() - start > timeout) { clearInterval(interval); resolve(el || null); }
      }, 300);
    });
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ── Try multiple selectors, return first match ──
  function trySelectors(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim()) return el.textContent.trim();
    }
    return null;
  }

  // ── Try multiple selectors for list items ──
  function tryListSelectors(containerSelectors, itemSelectors) {
    for (const cSel of containerSelectors) {
      const container = document.querySelector(cSel);
      if (!container) continue;
      for (const iSel of itemSelectors) {
        const items = Array.from(container.querySelectorAll(iSel))
          .map(el => el.textContent.trim())
          .filter(t => t.length > 1 && t.length < 500);
        if (items.length > 0) return items;
      }
      // Fallback: get all text lines from container
      const lines = container.innerText.split('\n').map(l => l.trim()).filter(l => l.length > 1 && l.length < 500);
      if (lines.length > 0) return lines;
    }
    return [];
  }

  // ── Extract by regex from page text ──
  function extractByRegex(text, pattern) {
    const match = text.match(pattern);
    return match ? match[1].trim() : null;
  }

  // ── Navigate to a chart section by clicking tabs/links ──
  async function navigateToSection(sectionName) {
    // PF uses various navigation patterns — try them all
    const navSelectors = [
      // Tab-style navigation
      `[data-qa="${sectionName}"]`,
      `[data-section="${sectionName}"]`,
      `a[href*="${sectionName}"]`,
      `.nav-item[data-name="${sectionName}"]`,
      // Sidebar/menu links
      `.chart-nav a:contains("${sectionName}")`,
      `.sidebar-nav a:contains("${sectionName}")`,
    ];

    // Also try clicking by visible text
    const allLinks = Array.from(document.querySelectorAll('a, button, [role="tab"], [role="menuitem"], .nav-link, .nav-item, .tab, .menu-item, li[class*="nav"], div[class*="nav"] > *, .sidebar a, .sidebar button'));

    for (const el of allLinks) {
      const text = el.textContent.trim().toLowerCase();
      if (text === sectionName.toLowerCase() || text.includes(sectionName.toLowerCase())) {
        el.click();
        await sleep(1500); // Wait for section to load
        return true;
      }
    }

    // Try data-qa selectors
    for (const sel of navSelectors) {
      try {
        const el = document.querySelector(sel);
        if (el) { el.click(); await sleep(1500); return true; }
      } catch(e) {}
    }

    return false;
  }

  // ── Scrape current visible section ──
  function scrapeCurrentView() {
    return {
      text: document.body.innerText.substring(0, 15000),
      html: document.body.innerHTML.substring(0, 30000),
      url: location.href,
    };
  }

  // ── Quick scrape (just what's visible, no navigation) ──
  function scrapePatientData() {
    const data = {};
    const bodyText = document.body.innerText;

    // Patient name
    data.patientName = trySelectors([
      '.patient-name', '.patient-header-name', '[data-qa="patient-name"]',
      '.demographics-name', '.chart-patient-name', 'h1.patient-name',
      '.patient-banner .name', '.patient-info .name',
      '.banner-container h1', '.banner-container h2',
      '[class*="patientName"]', '[class*="patient-name"]',
      '[class*="PatientName"]', '[id*="patientName"]',
    ]);

    // DOB
    data.dob = trySelectors([
      '[data-qa="patient-dob"]', '.patient-dob', '.demographics-dob',
      '.patient-banner .dob', '.patient-info .dob',
      '[class*="dateOfBirth"]', '[class*="dob"]',
    ]);
    if (!data.dob) data.dob = extractByRegex(bodyText, /(?:DOB|Date of Birth|Birth Date)[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);

    // Age
    data.age = extractByRegex(bodyText, /(?:Age)[:\s]*(\d+\s*(?:yr|year|y\/o|yo)s?)/i);

    // Gender
    data.gender = trySelectors([ '[data-qa="patient-gender"]', '.patient-gender', '.demographics-gender', '[class*="gender"]' ]);
    if (!data.gender) data.gender = extractByRegex(bodyText, /(?:Sex|Gender)[:\s]*(Male|Female|M|F|Other|Non-binary)/i);

    // Phone
    data.phone = trySelectors([ '[data-qa="patient-phone"]', '.patient-phone', '.demographics-phone', '.contact-phone', '.phone-number', '[class*="phone"]' ]);
    if (!data.phone) data.phone = extractByRegex(bodyText, /(?:Phone|Tel|Cell|Mobile|Home)[:\s]*(\(?\d{3}\)?[\s\-\.]\d{3}[\s\-\.]\d{4})/i);

    // Email
    data.email = extractByRegex(bodyText, /(?:Email)[:\s]*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);

    // Address
    data.address = trySelectors([ '[data-qa="patient-address"]', '.patient-address', '.demographics-address', '.address-line', '.contact-address', '[class*="address"]' ]);

    // SSN (last 4)
    data.ssnLast4 = extractByRegex(bodyText, /(?:SSN|Social)[:\s]*(?:XXX-XX-)?(\d{4})/i);

    // Insurance
    data.insurance = trySelectors([ '[data-qa="insurance-name"]', '.insurance-name', '.insurance-plan', '.coverage-name', '.payer-name', '[class*="insurance"]', '[class*="payer"]' ]);

    // Member/Subscriber ID
    data.memberId = trySelectors([ '[data-qa="member-id"]', '.member-id', '.subscriber-id', '.policy-number', '[class*="memberId"]', '[class*="subscriberId"]' ]);
    if (!data.memberId) data.memberId = extractByRegex(bodyText, /(?:Member|Subscriber|Policy|ID#?)[:\s]*([A-Z0-9]{5,20})/i);

    // Group number
    data.groupNumber = extractByRegex(bodyText, /(?:Group|Grp)[:\s#]*([A-Z0-9]{3,15})/i);

    // PCP / Primary Care
    data.pcp = extractByRegex(bodyText, /(?:PCP|Primary Care|Primary Provider|Referring)[:\s]*(?:Dr\.?\s*)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/i);

    // Pharmacy
    data.pharmacy = extractByRegex(bodyText, /(?:Pharmacy|Preferred Pharmacy)[:\s]*([^\n]{5,80})/i);

    // Medications
    data.medications = tryListSelectors(
      ['.medication-list', '.medications-panel', '[data-qa="medications"]', '.med-list', '.active-medications', '[class*="medication"]', '[class*="Medication"]', '#medications'],
      ['li', '.medication-item', '.med-item', 'tr', '.row', '[class*="item"]']
    );

    // Allergies
    data.allergies = tryListSelectors(
      ['.allergy-list', '.allergies-panel', '[data-qa="allergies"]', '[class*="allergy"]', '[class*="Allergy"]', '#allergies'],
      ['li', '.allergy-item', 'tr', '.row', '[class*="item"]']
    );

    // Diagnoses / Problems
    data.diagnoses = tryListSelectors(
      ['.problem-list', '.diagnoses-panel', '[data-qa="problems"]', '.active-problems', '.diagnosis-list', '[class*="problem"]', '[class*="Problem"]', '[class*="diagnos"]', '#problems'],
      ['li', '.problem-item', '.diagnosis-item', 'tr', '.row', '[class*="item"]']
    );

    // Vitals (look for most recent)
    data.vitals = {};
    const vitalsText = bodyText;
    data.vitals.bp = extractByRegex(vitalsText, /(?:BP|Blood Pressure)[:\s]*(\d{2,3}\/\d{2,3})/i);
    data.vitals.hr = extractByRegex(vitalsText, /(?:HR|Heart Rate|Pulse)[:\s]*(\d{2,3})\s*(?:bpm)?/i);
    data.vitals.temp = extractByRegex(vitalsText, /(?:Temp|Temperature)[:\s]*(\d{2,3}\.?\d?)\s*°?/i);
    data.vitals.weight = extractByRegex(vitalsText, /(?:Weight|Wt)[:\s]*(\d{2,4}\.?\d?)\s*(?:lbs?|kg)?/i);
    data.vitals.height = extractByRegex(vitalsText, /(?:Height|Ht)[:\s]*(\d['′]\s*\d{1,2}["″]?|\d{1,3}\s*(?:cm|in))/i);
    data.vitals.bmi = extractByRegex(vitalsText, /(?:BMI)[:\s]*(\d{1,2}\.?\d?)/i);
    data.vitals.o2 = extractByRegex(vitalsText, /(?:O2|SpO2|Oxygen|Sat)[:\s]*(\d{2,3})%?/i);
    // Clean empty vitals
    Object.keys(data.vitals).forEach(k => { if (!data.vitals[k]) delete data.vitals[k]; });
    if (Object.keys(data.vitals).length === 0) delete data.vitals;

    // Smoking status
    data.smokingStatus = extractByRegex(bodyText, /(?:Smoking|Tobacco)[:\s]*(Never|Former|Current|Unknown|Every day|Some days|No)[^\n]*/i);

    // Banner/header raw text
    const banner = document.querySelector('.patient-banner, .patient-header, .chart-header, .patient-demographics, [class*="patientBanner"], [class*="patient-banner"], [class*="chartHeader"], header');
    if (banner) data._rawBanner = banner.innerText.substring(0, 2000);

    // Full page text for AI
    data._pageContext = bodyText.substring(0, 8000);

    return data;
  }

  // ── Deep Chart Scrape — navigates through all sections ──
  async function deepScrapeChart(progressCallback) {
    const fullChart = {};

    // Step 1: Scrape the current view (patient banner always visible)
    progressCallback?.('Reading patient header...');
    Object.assign(fullChart, scrapePatientData());
    fullChart._sections = {};

    // Step 2: Define chart sections to navigate through
    const sections = [
      { name: 'Demographics', keys: ['demographics', 'patient info', 'patient details'] },
      { name: 'Medications', keys: ['medications', 'meds', 'medication list'] },
      { name: 'Allergies', keys: ['allergies', 'allergy'] },
      { name: 'Problems', keys: ['problems', 'problem list', 'diagnoses', 'conditions'] },
      { name: 'Vitals', keys: ['vitals', 'vital signs'] },
      { name: 'Lab Results', keys: ['lab results', 'labs', 'lab', 'results'] },
      { name: 'Immunizations', keys: ['immunizations', 'vaccines', 'immunization'] },
      { name: 'Encounters', keys: ['encounters', 'visits', 'encounter history'] },
      { name: 'Documents', keys: ['documents', 'document', 'files'] },
      { name: 'Orders', keys: ['orders', 'referrals', 'order'] },
      { name: 'Insurance', keys: ['insurance', 'coverage', 'payer'] },
      { name: 'History', keys: ['history', 'medical history', 'past medical', 'surgical history', 'family history', 'social history'] },
    ];

    // Step 3: Find all clickable navigation elements on the page
    const navElements = Array.from(document.querySelectorAll(
      'a, button, [role="tab"], [role="menuitem"], .nav-link, .nav-item, .tab, .menu-item, ' +
      'li[class*="nav"], div[class*="nav"] > *, .sidebar a, .sidebar button, ' +
      '[class*="tab"], [class*="Tab"], [class*="menu"], [class*="Menu"], ' +
      '[class*="section"], [class*="Section"], [data-section], [data-tab]'
    ));

    // Build a map of clickable items by their text
    const clickableMap = {};
    for (const el of navElements) {
      const text = (el.textContent || '').trim().toLowerCase();
      if (text.length > 0 && text.length < 50) {
        clickableMap[text] = el;
      }
    }

    // Step 4: Navigate to each section and scrape
    for (const section of sections) {
      progressCallback?.('Reading ' + section.name + '...');

      // Find the best matching clickable element
      let clicked = false;
      for (const key of section.keys) {
        // Exact match
        if (clickableMap[key]) {
          try { clickableMap[key].click(); await sleep(2000); clicked = true; break; } catch(e) {}
        }
        // Partial match
        for (const [text, el] of Object.entries(clickableMap)) {
          if (text.includes(key) || key.includes(text)) {
            try { el.click(); await sleep(2000); clicked = true; break; } catch(e) {}
          }
        }
        if (clicked) break;
      }

      if (clicked) {
        // Scrape this section
        const sectionData = {
          text: document.body.innerText.substring(0, 10000),
          found: true,
        };

        // Re-scrape structured data now that we're on the section
        const fresh = scrapePatientData();

        // Merge medications, allergies, diagnoses if the section revealed them
        if (section.name === 'Medications' && fresh.medications?.length > (fullChart.medications?.length || 0)) {
          fullChart.medications = fresh.medications;
        }
        if (section.name === 'Allergies' && fresh.allergies?.length > (fullChart.allergies?.length || 0)) {
          fullChart.allergies = fresh.allergies;
        }
        if (section.name === 'Problems' && fresh.diagnoses?.length > (fullChart.diagnoses?.length || 0)) {
          fullChart.diagnoses = fresh.diagnoses;
        }
        if (section.name === 'Vitals' && fresh.vitals) {
          fullChart.vitals = { ...fullChart.vitals, ...fresh.vitals };
        }
        if (section.name === 'Insurance') {
          if (fresh.insurance) fullChart.insurance = fresh.insurance;
          if (fresh.memberId) fullChart.memberId = fresh.memberId;
          if (fresh.groupNumber) fullChart.groupNumber = fresh.groupNumber;
        }
        if (section.name === 'Demographics') {
          if (fresh.phone && !fullChart.phone) fullChart.phone = fresh.phone;
          if (fresh.email && !fullChart.email) fullChart.email = fresh.email;
          if (fresh.address && !fullChart.address) fullChart.address = fresh.address;
          if (fresh.ssnLast4 && !fullChart.ssnLast4) fullChart.ssnLast4 = fresh.ssnLast4;
          if (fresh.pharmacy && !fullChart.pharmacy) fullChart.pharmacy = fresh.pharmacy;
        }

        // Store raw section text for AI analysis
        fullChart._sections[section.name] = sectionData.text.substring(0, 5000);
      } else {
        fullChart._sections[section.name] = null; // Section not found
      }
    }

    // Step 5: Build comprehensive page context for AI
    let fullContext = '';
    for (const [name, text] of Object.entries(fullChart._sections)) {
      if (text) fullContext += '\n\n══ ' + name.toUpperCase() + ' ══\n' + text;
    }
    fullChart._fullChartContext = fullContext.substring(0, 30000);

    // Count what we found
    fullChart._sectionsFound = Object.values(fullChart._sections).filter(Boolean).length;
    fullChart._sectionsTotal = sections.length;

    progressCallback?.('Done — found data in ' + fullChart._sectionsFound + '/' + fullChart._sectionsTotal + ' sections');

    return fullChart;
  }

  // ── Field Filling ──
  function fillField(selector, value) {
    const el = document.querySelector(selector);
    if (!el) return false;
    el.focus();
    // Use native input setter to trigger React/Angular change detection
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    if (el.tagName === 'TEXTAREA' && nativeTextAreaValueSetter) {
      nativeTextAreaValueSetter.call(el, value);
    } else if (nativeInputValueSetter) {
      nativeInputValueSetter.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  }

  // ── Click an element by text ──
  function clickByText(text) {
    const all = Array.from(document.querySelectorAll('a, button, [role="button"], input[type="submit"], input[type="button"]'));
    for (const el of all) {
      if (el.textContent.trim().toLowerCase().includes(text.toLowerCase())) {
        el.click();
        return true;
      }
    }
    return false;
  }

  // ── Message Handling ──
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'SCRAPE_PATIENT') {
      const data = scrapePatientData();
      sendResponse({ success: true, data });
    }
    if (msg.type === 'DEEP_SCRAPE') {
      // Deep scrape is async — can't use sendResponse directly
      deepScrapeChart((status) => {
        chrome.runtime.sendMessage({ type: 'SCRAPE_PROGRESS', status });
      }).then(data => {
        chrome.runtime.sendMessage({ type: 'DEEP_SCRAPE_COMPLETE', data });
      });
      sendResponse({ success: true, started: true });
    }
    if (msg.type === 'FILL_FIELD') {
      const ok = fillField(msg.selector, msg.value);
      sendResponse({ success: ok });
    }
    if (msg.type === 'CLICK_TEXT') {
      const ok = clickByText(msg.text);
      sendResponse({ success: ok });
    }
    if (msg.type === 'GET_PAGE_TEXT') {
      sendResponse({ success: true, text: document.body.innerText.substring(0, msg.maxLength || 15000) });
    }
    if (msg.type === 'GET_CLICKABLE') {
      // Return list of all clickable elements for discovery
      const items = Array.from(document.querySelectorAll('a, button, [role="tab"], [role="menuitem"], .nav-link, .nav-item, .tab'))
        .map(el => ({ text: el.textContent.trim(), tag: el.tagName, classes: el.className?.substring?.(0, 100) || '' }))
        .filter(i => i.text.length > 0 && i.text.length < 60);
      sendResponse({ success: true, items });
    }
    return true;
  });

  // Auto-scrape when page loads
  setTimeout(() => {
    const data = scrapePatientData();
    if (data.patientName || data._rawBanner) {
      chrome.runtime.sendMessage({ type: 'PATIENT_DATA', data });
    }
  }, 3000);

  // Watch for SPA navigation
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

  console.log('[CareCoord] Content script loaded — deep chart scraping available');
})();
