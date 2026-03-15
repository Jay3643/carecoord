// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// Enable side panel on Practice Fusion pages
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.url && tab.url.includes('practicefusion.com')) {
    chrome.sidePanel.setOptions({ tabId, path: 'sidepanel.html', enabled: true });
  }
});

// Message routing between content script and side panel
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Forward patient data updates to side panel
  if (msg.type === 'PATIENT_DATA' || msg.type === 'SCRAPE_PROGRESS' || msg.type === 'DEEP_SCRAPE_COMPLETE') {
    // Re-broadcast to all extension pages (side panel will pick it up)
    chrome.runtime.sendMessage(msg).catch(() => {});
  }

  // Forward scrape requests to the active tab's content script
  if (msg.type === 'SCRAPE_PATIENT' || msg.type === 'DEEP_SCRAPE' || msg.type === 'FILL_FIELD' || msg.type === 'CLICK_TEXT' || msg.type === 'GET_PAGE_TEXT' || msg.type === 'GET_CLICKABLE') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, msg, (response) => {
          if (sendResponse) sendResponse(response);
        });
      }
    });
    return true;
  }
});
