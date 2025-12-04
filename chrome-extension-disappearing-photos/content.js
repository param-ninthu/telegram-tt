/**
 * Content Script for Telegram Disappearing Photos Extension
 *
 * This script runs in the content script context and injects the main
 * injected.js file into the page's MAIN world to access Telegram's
 * internal webpack modules and API functions.
 */

(function() {
  'use strict';

  // Only run on Telegram Web A
  if (!window.location.href.startsWith('https://web.telegram.org/a')) {
    return;
  }

  console.log('[TelegramDisappearingPhotos] Content script loaded');

  // Create and inject the script element
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('injected.js');
  script.type = 'text/javascript';

  script.onload = function() {
    console.log('[TelegramDisappearingPhotos] Injected script loaded successfully');
    // Remove the script element after it loads (cleanup)
    script.remove();
  };

  script.onerror = function() {
    console.error('[TelegramDisappearingPhotos] Failed to load injected script');
  };

  // Inject as early as possible
  (document.head || document.documentElement).appendChild(script);

  // Listen for messages from the injected script (if needed for debugging)
  window.addEventListener('message', function(event) {
    if (event.source !== window) return;
    if (event.data && event.data.type === 'TELEGRAM_DISAPPEARING_PHOTOS_LOG') {
      console.log('[TelegramDisappearingPhotos]', event.data.message);
    }
  });
})();
