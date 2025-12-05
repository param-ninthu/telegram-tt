/**
 * Telegram Disappearing Photos - Background Service Worker
 * Manifest V3 background script
 */

// Extension installed/updated
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[TelegramDisappearingPhotos] Extension installed');
  } else if (details.reason === 'update') {
    console.log('[TelegramDisappearingPhotos] Extension updated to', chrome.runtime.getManifest().version);
  }
});

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'LOG') {
    console.log('[TelegramDisappearingPhotos]', message.data);
  } else if (message.type === 'GET_TAB_ID') {
    sendResponse({ tabId: sender.tab?.id });
  }
  return true;
});

// Keep service worker alive during active operations
let keepAliveInterval;

function startKeepAlive() {
  if (keepAliveInterval) return;
  keepAliveInterval = setInterval(() => {
    // Ping to keep service worker active
  }, 20000);
}

function stopKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = undefined;
  }
}

// Listen for tab updates to detect when Telegram is opened
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url?.includes('web.telegram.org/a')) {
    startKeepAlive();
  }
});

// Clean up when tab is closed
chrome.tabs.onRemoved.addListener(() => {
  chrome.tabs.query({ url: 'https://web.telegram.org/a/*' }, (tabs) => {
    if (tabs.length === 0) {
      stopKeepAlive();
    }
  });
});
