// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// Enable side panel on Practice Fusion pages
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.url && (tab.url.includes('practicefusion.com'))) {
    chrome.sidePanel.setOptions({
      tabId,
      path: 'sidepanel.html',
      enabled: true,
    });
  }
});

// Listen for messages from content script and side panel
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'PATIENT_DATA') {
    // Forward scraped patient data to the side panel
    chrome.runtime.sendMessage({ type: 'PATIENT_DATA_UPDATE', data: msg.data });
  }
  if (msg.type === 'SCRAPE_PATIENT') {
    // Tell content script to scrape patient data
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'SCRAPE_PATIENT' }, (response) => {
          sendResponse(response);
        });
      }
    });
    return true; // Keep channel open for async response
  }
  if (msg.type === 'FILL_FIELD') {
    // Tell content script to fill a field
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'FILL_FIELD', selector: msg.selector, value: msg.value });
      }
    });
  }
});
