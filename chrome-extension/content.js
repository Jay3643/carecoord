// Content script — runs on Practice Fusion pages
// Scrapes patient chart data using PF's actual Ember.js DOM structure

(function() {
  'use strict';

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ── Try multiple selectors, return first match text ──
  function trySelectors(selectors) {
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el && el.textContent.trim()) return el.textContent.trim();
      } catch(e) {}
    }
    return null;
  }

  // ── Get list items from a container ──
  function getListItems(containerSel, itemSel) {
    try {
      const container = document.querySelector(containerSel);
      if (!container) return [];
      const items = Array.from(container.querySelectorAll(itemSel || 'li, a, .item'))
        .map(el => el.textContent.trim())
        .filter(t => t.length > 1 && t.length < 500);
      return items;
    } catch(e) { return []; }
  }

  // ── Extract from page text by regex ──
  function extractByRegex(text, pattern) {
    const match = text.match(pattern);
    return match ? match[1].trim() : null;
  }

  // ── Parse the patient banner (top bar) ──
  function parseBanner() {
    const data = {};
    const bannerText = document.body.innerText;

    // PF banner format: "Name | PRN: XX | Age Sex | Insurance | DOB: XX | Phone"
    // Patient name — the big heading in the banner
    const patientHeader = document.querySelector('.patient-summary h2, .patient-summary h1, .patient-summary .patient-name, [class*="patient-summary"] h2');
    if (patientHeader) data.patientName = patientHeader.textContent.trim();

    // Try the composable header area
    if (!data.patientName) {
      const header = document.querySelector('.composable-header__tool-bar, [class*="composable-header"]');
      if (header) {
        const text = header.textContent.trim();
        // First substantial text block is usually the name
        const parts = text.split(/\s*\|\s*|\s*PRN/);
        if (parts[0] && parts[0].length > 2 && parts[0].length < 60) data.patientName = parts[0].trim();
      }
    }

    // PRN (Practice Record Number)
    data.prn = extractByRegex(bannerText, /PRN[:\s]*([A-Z0-9]+)/i);

    // Age and gender — "85 yrs F" or "85 yrs M"
    const ageMatch = bannerText.match(/(\d{1,3})\s*(?:yrs?|years?)\s*([MF])/i);
    if (ageMatch) { data.age = ageMatch[1] + ' yrs'; data.gender = ageMatch[2] === 'M' ? 'Male' : 'Female'; }

    // DOB
    data.dob = extractByRegex(bannerText, /DOB[:\s]*(\d{1,2}\/\d{1,2}\/\d{2,4})/i);

    // Phone — "M: (516) 576-3330" or similar
    const phoneMatch = bannerText.match(/(?:M|H|W|C|Phone|Tel)[:\s]*(\(?\d{3}\)?[\s\-\.]\d{3}[\s\-\.]\d{4})/i);
    if (phoneMatch) data.phone = phoneMatch[1];

    // Insurance — often shown as a colored badge in the banner
    // Look for known insurance patterns or the banner badge
    const insuranceMatch = bannerText.match(/(?:United Healthcare|Aetna|Cigna|Blue Cross|BlueCross|BCBS|Humana|Medicare|Medicaid|Anthem|Kaiser|UHC|Oxford|WellCare|Molina|Centene|Fidelis|Healthfirst|Empire|Emblem|Amerigroup|Tricare|VA |Optum)[^\n]*/i);
    if (insuranceMatch) data.insurance = insuranceMatch[0].trim();

    // FMH Status
    data.fmhStatus = extractByRegex(bannerText, /FMH Status[:\s]*([^\n|]+)/i);

    return data;
  }

  // ── Scrape the Summary page (main dashboard view) ──
  function scrapeSummary() {
    const data = {};

    // ── Allergies section ──
    const allergySection = document.querySelector('[data-element="allergies-list"], .allergies');
    if (allergySection) {
      const text = allergySection.innerText;
      if (text.includes('no known drug allergies')) {
        data.allergies = ['No known drug allergies (NKDA)'];
      } else {
        data.allergies = [];
        // Drug allergies
        const drugItems = allergySection.querySelectorAll('li, .allergy-item, a');
        drugItems.forEach(el => {
          const t = el.textContent.trim();
          if (t.length > 1 && t.length < 200) data.allergies.push(t);
        });
      }
      // Food and environmental
      if (text.includes('No food allergies')) data.allergies.push('No food allergies');
      if (text.includes('No environmental allergies')) data.allergies.push('No environmental allergies');
    }

    // ── Medications section ──
    const medSection = document.querySelector('.medications, [data-qatest="dashboardpanel"].medications, [data-element="medication-summary-card"]');
    if (medSection) {
      data.medications = [];
      const medItems = medSection.querySelectorAll('li, a[href*="medication"], .medication-item');
      medItems.forEach(el => {
        const t = el.textContent.trim();
        if (t.length > 3 && t.length < 300 && !t.includes('View more') && !t.includes('View PDMP') && !t.includes('Prescription Drug')) {
          data.medications.push(t);
        }
      });
      // If list scraping missed them, parse the text
      if (data.medications.length === 0) {
        const lines = medSection.innerText.split('\n').filter(l => l.trim().length > 5 && l.includes('Tablet') || l.includes('Capsule') || l.includes('MG') || l.includes('mg') || l.includes('Cream') || l.includes('Suspension') || l.includes('Solution') || l.includes('Powder'));
        data.medications = lines.map(l => l.trim());
      }
    }

    // ── Diagnoses section ──
    const diagSection = document.querySelector('.diagnoses, [class*="diagnoses"]');
    if (!diagSection) {
      // Try finding by header text
      const headers = document.querySelectorAll('h3, h4, .card-title, header');
      for (const h of headers) {
        if (h.textContent.trim().toLowerCase().includes('diagnos')) {
          const parent = h.closest('.card, .panel, .section, div[class*="item"], div[class*="card"]') || h.parentElement;
          if (parent) {
            data.diagnoses = [];
            parent.querySelectorAll('li, a').forEach(el => {
              const t = el.textContent.trim();
              if (t.length > 3 && t.length < 300 && t.match(/[\(\[]?[A-Z]\d/)) {
                data.diagnoses.push(t);
              }
            });
            break;
          }
        }
      }
    } else {
      data.diagnoses = [];
      diagSection.querySelectorAll('li').forEach(el => {
        const t = el.textContent.trim();
        if (t.length > 3) data.diagnoses.push(t);
      });
    }

    // ── Health concerns (right sidebar) ──
    const healthConcerns = document.querySelector('[class*="health-concern"], [class*="healthConcern"]');
    if (healthConcerns) {
      data.healthConcerns = healthConcerns.innerText.split('\n').map(l => l.trim()).filter(l => l.length > 1 && l.length < 200);
    }
    // Fallback: search for the section by text
    if (!data.healthConcerns) {
      const allText = document.body.innerText;
      const hcMatch = allText.match(/Health concerns([\s\S]*?)(?:Goals|Encounters|Messages|$)/i);
      if (hcMatch) {
        data.healthConcerns = hcMatch[1].split('\n').map(l => l.trim()).filter(l => l.length > 1 && l.length < 200 && !l.startsWith('Health'));
      }
    }

    // ── Goals ──
    const goalsText = document.body.innerText;
    const goalsMatch = goalsText.match(/Goals([\s\S]*?)(?:Encounters|Messages|$)/i);
    if (goalsMatch) {
      const goalLines = goalsMatch[1].split('\n').map(l => l.trim()).filter(l => l.length > 3 && l.length < 200 && l !== 'Goals' && !l.includes('No patient goals'));
      if (goalLines.length > 0) data.goals = goalLines;
    }

    // ── Encounters ──
    const encounterSection = document.body.innerText;
    const encMatch = encounterSection.match(/Encounters([\s\S]*?)(?:Messages|View all encounters|$)/i);
    if (encMatch) {
      data.encounters = encMatch[1].split('\n').map(l => l.trim()).filter(l => l.length > 5 && l.length < 300 && l !== 'Encounters' && l.match(/\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2}/));
    }

    // ── Flowsheets / Labs ──
    const flowsheetSection = document.body.innerText;
    const flowMatch = flowsheetSection.match(/Flowsheets([\s\S]*?)(?:Launch SMART|Diagnoses|$)/i);
    if (flowMatch) {
      data.flowsheets = flowMatch[1].split('\n').map(l => l.trim()).filter(l => l.length > 2 && l.length < 100 && l !== 'Practice' && l !== 'Flowsheets');
    }

    // ── Vitals from text ──
    data.vitals = {};
    const vText = document.body.innerText;
    data.vitals.bp = extractByRegex(vText, /(?:BP|Blood Pressure)[:\s]*(\d{2,3}\/\d{2,3})/i);
    data.vitals.hr = extractByRegex(vText, /(?:HR|Heart Rate|Pulse)[:\s]*(\d{2,3})\s*(?:bpm)?/i);
    data.vitals.temp = extractByRegex(vText, /(?:Temp|Temperature)[:\s]*(\d{2,3}\.?\d?)\s*°?/i);
    data.vitals.weight = extractByRegex(vText, /(?:Weight|Wt)[:\s]*(\d{2,4}\.?\d?)\s*(?:lbs?|kg)?/i);
    data.vitals.height = extractByRegex(vText, /(?:Height|Ht)[:\s]*(\d['′]\s*\d{1,2}["″]?|\d{1,3}\s*(?:cm|in))/i);
    data.vitals.bmi = extractByRegex(vText, /(?:BMI)[:\s]*(\d{1,2}\.?\d?)/i);
    data.vitals.o2 = extractByRegex(vText, /(?:O2|SpO2|Oxygen|Sat)[:\s]*(\d{2,3})%?/i);
    Object.keys(data.vitals).forEach(k => { if (!data.vitals[k]) delete data.vitals[k]; });
    if (Object.keys(data.vitals).length === 0) delete data.vitals;

    return data;
  }

  // ── Quick scrape (current page only) ──
  function scrapePatientData() {
    const banner = parseBanner();
    const summary = scrapeSummary();

    const data = { ...banner, ...summary };

    // Full page text for AI
    data._pageContext = document.body.innerText.substring(0, 10000);

    // Raw banner for fallback
    const bannerEl = document.querySelector('.patient-summary, .composable-header__tool-bar, [class*="patient-summary"]');
    if (bannerEl) data._rawBanner = bannerEl.innerText.substring(0, 2000);

    return data;
  }

  // ── Deep Chart Scrape — clicks through chart tabs ──
  async function deepScrapeChart(progressCallback) {
    const fullChart = {};

    // Step 1: Scrape the Summary page first (it has most data)
    progressCallback?.('Reading Summary page...');
    Object.assign(fullChart, scrapePatientData());
    fullChart._sections = { Summary: document.body.innerText.substring(0, 8000) };

    // Step 2: Click through the chart tabs
    // PF tabs: Summary, Timeline, Documents, Profile, Payment collection, Patient ledger
    const chartTabs = [
      { label: 'Timeline', dataFields: ['encounters', 'timeline'] },
      { label: 'Documents', dataFields: ['documents'] },
      { label: 'Profile', dataFields: ['demographics', 'address', 'email', 'emergencyContact', 'employer'] },
    ];

    for (const tab of chartTabs) {
      progressCallback?.('Reading ' + tab.label + '...');

      // Find and click the tab — PF uses <a> tags in a tab bar
      const tabLinks = document.querySelectorAll('.composable-header a, [class*="tab"] a, a[class*="ember-view"]');
      let clicked = false;
      for (const link of tabLinks) {
        if (link.textContent.trim().toLowerCase() === tab.label.toLowerCase()) {
          link.click();
          await sleep(2500);
          clicked = true;
          break;
        }
      }

      if (clicked) {
        const sectionText = document.body.innerText.substring(0, 10000);
        fullChart._sections[tab.label] = sectionText;

        // Extract additional data from Profile page
        if (tab.label === 'Profile') {
          const text = sectionText;
          if (!fullChart.address) fullChart.address = extractByRegex(text, /(?:Address|Street)[:\s]*([^\n]+)/i);
          if (!fullChart.email) fullChart.email = extractByRegex(text, /(?:Email)[:\s]*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
          fullChart.emergencyContact = extractByRegex(text, /(?:Emergency Contact|Emergency)[:\s]*([^\n]+)/i);
          fullChart.employer = extractByRegex(text, /(?:Employer|Employment)[:\s]*([^\n]+)/i);
          fullChart.language = extractByRegex(text, /(?:Language|Preferred Language)[:\s]*([^\n]+)/i);
          fullChart.race = extractByRegex(text, /(?:Race|Ethnicity)[:\s]*([^\n]+)/i);
          fullChart.maritalStatus = extractByRegex(text, /(?:Marital|Marital Status)[:\s]*([^\n]+)/i);
          // SSN
          if (!fullChart.ssnLast4) fullChart.ssnLast4 = extractByRegex(text, /(?:SSN|Social)[:\s]*(?:XXX-XX-|[\*]+)?(\d{4})/i);
          // Pharmacy
          if (!fullChart.pharmacy) fullChart.pharmacy = extractByRegex(text, /(?:Pharmacy|Preferred Pharmacy)[:\s]*([^\n]+)/i);
        }

        // Extract timeline/encounters data
        if (tab.label === 'Timeline') {
          const encounters = [];
          const lines = sectionText.split('\n');
          for (const line of lines) {
            if (line.match(/\d{2}\/\d{2}\/\d{4}/) && line.length > 10 && line.length < 300) {
              encounters.push(line.trim());
            }
          }
          if (encounters.length > (fullChart.encounters?.length || 0)) {
            fullChart.encounters = encounters.slice(0, 50);
          }
        }

        // Extract documents list
        if (tab.label === 'Documents') {
          const docs = [];
          const docItems = document.querySelectorAll('tr, .document-item, .doc-row, li');
          docItems.forEach(el => {
            const t = el.textContent.trim();
            if (t.length > 5 && t.length < 300 && t.match(/\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}/)) {
              docs.push(t.replace(/\s+/g, ' '));
            }
          });
          if (docs.length > 0) fullChart.documents = docs.slice(0, 30);
        }
      } else {
        fullChart._sections[tab.label] = null;
      }
    }

    // Step 3: Navigate back to Summary
    progressCallback?.('Returning to Summary...');
    const summaryTab = Array.from(document.querySelectorAll('.composable-header a, [class*="tab"] a, a[class*="ember-view"]'))
      .find(a => a.textContent.trim().toLowerCase() === 'summary');
    if (summaryTab) { summaryTab.click(); await sleep(1500); }

    // Step 4: Build full context for AI
    let fullContext = '';
    for (const [name, text] of Object.entries(fullChart._sections)) {
      if (text) fullContext += '\n\n══ ' + name.toUpperCase() + ' ══\n' + text;
    }
    fullChart._fullChartContext = fullContext.substring(0, 40000);

    fullChart._sectionsFound = Object.values(fullChart._sections).filter(Boolean).length;
    fullChart._sectionsTotal = Object.keys(fullChart._sections).length;

    progressCallback?.('Done — pulled data from ' + fullChart._sectionsFound + ' sections');

    return fullChart;
  }

  // ── Field Filling ──
  function fillField(selector, value) {
    const el = document.querySelector(selector);
    if (!el) return false;
    el.focus();
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    if (el.tagName === 'TEXTAREA' && nativeTextAreaValueSetter) nativeTextAreaValueSetter.call(el, value);
    else if (nativeInputValueSetter) nativeInputValueSetter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  }

  // ── Message Handling ──
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'SCRAPE_PATIENT') {
      const data = scrapePatientData();
      sendResponse({ success: true, data });
    }
    if (msg.type === 'DEEP_SCRAPE') {
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
    if (msg.type === 'GET_PAGE_TEXT') {
      sendResponse({ success: true, text: document.body.innerText.substring(0, msg.maxLength || 15000) });
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

  console.log('[CareCoord] Content script loaded for Practice Fusion (Ember.js)');
})();
