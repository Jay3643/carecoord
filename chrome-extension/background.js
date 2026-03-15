// Track the Practice Fusion tab ID
let pfTabId = null;

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// Track PF tabs
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.url && tab.url.includes('practicefusion.com')) {
    pfTabId = tabId;
    chrome.sidePanel.setOptions({ tabId, path: 'sidepanel.html', enabled: true });
  }
});

// If PF tab closes, clear the reference
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === pfTabId) pfTabId = null;
});

// Find PF tab if we don't have one
async function findPFTab() {
  if (pfTabId) {
    try {
      const tab = await chrome.tabs.get(pfTabId);
      if (tab && tab.url && tab.url.includes('practicefusion.com')) return pfTabId;
    } catch(e) { pfTabId = null; }
  }
  // Search all tabs
  const tabs = await chrome.tabs.query({ url: ['*://*.practicefusion.com/*'] });
  if (tabs.length > 0) { pfTabId = tabs[0].id; return pfTabId; }
  return null;
}

// Message routing — always target the PF tab, not the active tab
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Forward updates from content script to side panel
  if (msg.type === 'PATIENT_DATA' || msg.type === 'SCRAPE_PROGRESS' || msg.type === 'CHART_SCAN_COMPLETE') {
    chrome.runtime.sendMessage(msg).catch(() => {});
    return;
  }

  // Forward commands to the PF tab (not active tab)
  if (msg.type === 'SCRAPE_PATIENT' || msg.type === 'CHART_SCAN' || msg.type === 'GET_PAGE_TEXT') {
    findPFTab().then(tabId => {
      if (!tabId) {
        // No PF tab found — notify side panel
        chrome.runtime.sendMessage({ type: 'SCRAPE_PROGRESS', status: 'ERROR: No Practice Fusion tab found. Open PF in a tab first.' }).catch(() => {});
        if (sendResponse) sendResponse({ success: false, error: 'No PF tab found' });
        return;
      }
      chrome.tabs.sendMessage(tabId, msg, (response) => {
        if (chrome.runtime.lastError) {
          chrome.runtime.sendMessage({ type: 'SCRAPE_PROGRESS', status: 'ERROR: Content script not loaded. Refresh the Practice Fusion tab.' }).catch(() => {});
          if (sendResponse) sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else {
          if (sendResponse) sendResponse(response);
        }
      });
    });
    return true; // Keep channel open
  }
});
