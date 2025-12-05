/**
 * Telegram Disappearing Photos - Injected Script
 *
 * Hooks into Telegram Web A's webpack modules to access internal APIs.
 * Uses known module IDs from production build analysis.
 */

(function() {
  'use strict';

  const LOG_PREFIX = '[TelegramDisappearingPhotos]';
  const VIEW_ONCE_TTL = 2147483647;

  // Known module IDs from production build analysis
  const KNOWN_MODULES = {
    // Module 13439 exports: mS=getGlobal, UF=setGlobal, ko=getActions
    GLOBAL_MODULE_ID: '13439',
    // Module 37932 exports: cl=typify
    TEACTN_MODULE_ID: '37932'
  };

  const TelegramApi = {
    _initialized: false,
    _webpackRequire: null,
    _getGlobal: null,
    _getActions: null,
    _setGlobal: null,
  };

  function log(...args) { console.log(LOG_PREFIX, ...args); }
  function warn(...args) { console.warn(LOG_PREFIX, ...args); }
  function error(...args) { console.error(LOG_PREFIX, ...args); }

  /**
   * Check window globals (DEBUG mode)
   */
  function checkWindowGlobals() {
    if (typeof window.getGlobal === 'function') {
      TelegramApi._getGlobal = window.getGlobal;
      log('Found window.getGlobal');
    }
    if (typeof window.getActions === 'function') {
      TelegramApi._getActions = window.getActions;
      log('Found window.getActions');
    }
    if (typeof window.setGlobal === 'function') {
      TelegramApi._setGlobal = window.setGlobal;
    }
    return TelegramApi._getGlobal && TelegramApi._getActions;
  }

  /**
   * Hook webpack to get require function
   */
  function hookWebpack() {
    return new Promise((resolve) => {
      // Try self.webpackChunktelegram_t (production) or window variants
      const chunkName = 'webpackChunktelegram_t';
      const chunk = self[chunkName] || window[chunkName];

      if (!chunk) {
        // Try to find any webpack chunk
        for (const key of Object.keys(self)) {
          if (key.startsWith('webpackChunk') && Array.isArray(self[key])) {
            log(`Found chunk: ${key}`);
            hookChunkArray(self[key], resolve);
            return;
          }
        }
        warn('No webpack chunk found');
        resolve(false);
        return;
      }

      log(`Found ${chunkName}`);
      hookChunkArray(chunk, resolve);
    });
  }

  /**
   * Hook into chunk array to capture require
   */
  function hookChunkArray(chunk, resolve) {
    const origPush = chunk.push.bind(chunk);

    // Inject our module to capture require
    const hookId = `__tdp_${Date.now()}__`;
    try {
      origPush([
        [hookId],
        { [hookId]: function(module, exports, require) {
          captureRequire(require);
        }},
        function(require) {
          captureRequire(require);
          try { require(hookId); } catch(e) {}
        }
      ]);
    } catch(e) {
      warn('Hook failed:', e.message);
    }

    setTimeout(() => resolve(!!TelegramApi._getGlobal), 3000);
  }

  /**
   * Capture webpack require and extract functions
   */
  function captureRequire(require) {
    if (!require || TelegramApi._webpackRequire) return;
    TelegramApi._webpackRequire = require;
    log('Captured webpack require');

    // Method 1: Try known module ID directly
    tryKnownModules(require);

    // Method 2: Search all modules if Method 1 failed
    if (!TelegramApi._getGlobal || !TelegramApi._getActions) {
      searchModules(require);
    }
  }

  /**
   * Try to load known module IDs
   */
  function tryKnownModules(require) {
    try {
      // Try module 13439 (global/index.ts in production)
      const globalModule = require(KNOWN_MODULES.GLOBAL_MODULE_ID);
      if (globalModule) {
        log('Found module 13439');
        // Check for minified export names: mS, ko, UF
        if (typeof globalModule.mS === 'function') {
          TelegramApi._getGlobal = globalModule.mS;
          log('Found getGlobal as mS');
        }
        if (typeof globalModule.ko === 'function') {
          TelegramApi._getActions = globalModule.ko;
          log('Found getActions as ko');
        }
        if (typeof globalModule.UF === 'function') {
          TelegramApi._setGlobal = globalModule.UF;
        }
      }
    } catch(e) {
      log('Module 13439 not found, searching...');
    }

    // Try teactn module to get typify
    try {
      const teactnModule = require(KNOWN_MODULES.TEACTN_MODULE_ID);
      if (teactnModule && typeof teactnModule.cl === 'function') {
        log('Found teactn module 37932');
        const typed = teactnModule.cl();
        if (typed) {
          if (!TelegramApi._getGlobal && typed.getGlobal) {
            TelegramApi._getGlobal = typed.getGlobal;
            log('Found getGlobal via typify');
          }
          if (!TelegramApi._getActions && typed.getActions) {
            TelegramApi._getActions = typed.getActions;
            log('Found getActions via typify');
          }
        }
      }
    } catch(e) {}
  }

  /**
   * Search all modules for getGlobal/getActions
   */
  function searchModules(require) {
    if (!require.c) return;
    log(`Searching ${Object.keys(require.c).length} modules...`);

    for (const [id, module] of Object.entries(require.c)) {
      if (TelegramApi._getGlobal && TelegramApi._getActions) break;
      if (!module || !module.exports) continue;

      const exp = module.exports;

      // Look for exports that look like getGlobal (returns object with byTabId/chats)
      for (const key of Object.keys(exp)) {
        if (typeof exp[key] !== 'function') continue;
        try {
          const result = exp[key]();
          if (result && typeof result === 'object') {
            // Check for global state shape
            if (!TelegramApi._getGlobal &&
                (result.byTabId || (result.chats && result.users))) {
              TelegramApi._getGlobal = exp[key];
              log(`Found getGlobal: module ${id}, export ${key}`);
            }
            // Check for actions shape (many functions, including openChat/loadChats)
            if (!TelegramApi._getActions) {
              const fns = Object.values(result).filter(v => typeof v === 'function');
              if (fns.length > 50) {
                TelegramApi._getActions = exp[key];
                log(`Found getActions: module ${id}, export ${key}`);
              }
            }
          }
        } catch(e) {}
      }
    }
  }

  function getCurrentChatId() {
    if (!TelegramApi._getGlobal) return null;
    try {
      const global = TelegramApi._getGlobal();
      if (global.byTabId) {
        const tabs = Object.values(global.byTabId);
        for (const tab of tabs) {
          if (tab.currentChat?.id) return tab.currentChat.id;
        }
      }
      return null;
    } catch(e) { return null; }
  }

  function getChat(chatId) {
    if (!TelegramApi._getGlobal) return null;
    try {
      return TelegramApi._getGlobal().chats?.byId?.[chatId] || null;
    } catch(e) { return null; }
  }

  async function downloadImage(url) {
    log(`Downloading: ${url}`);
    const resp = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    let blob = await resp.blob();
    if (!blob.type.startsWith('image/')) {
      blob = new Blob([blob], { type: 'image/jpeg' });
    }
    log(`Downloaded: ${blob.size} bytes`);
    return blob;
  }

  function getImageDimensions(blob) {
    return new Promise(resolve => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve({ width: img.naturalWidth, height: img.naturalHeight }); };
      img.onerror = () => { URL.revokeObjectURL(url); resolve({ width: 512, height: 512 }); };
      img.src = url;
    });
  }

  async function buildAttachment(blob, filename, ttlSeconds) {
    const blobUrl = URL.createObjectURL(blob);
    const dims = await getImageDimensions(blob);
    return {
      blob, blobUrl, filename,
      mimeType: blob.type || 'image/jpeg',
      size: blob.size,
      quick: { width: dims.width, height: dims.height },
      ttlSeconds,
      shouldSendAsFile: false,
      shouldSendAsSpoiler: false,
    };
  }

  async function sendDisappearingPhoto(url, ttlSeconds = VIEW_ONCE_TTL, chatId = null) {
    log('========================================');
    log('  TelegramSendDisappearingPhoto');
    log('========================================');

    if (!TelegramApi._getActions) {
      throw new Error('getActions not found. Cannot send messages.');
    }

    const targetChatId = chatId || getCurrentChatId();
    if (!targetChatId) {
      throw new Error('No chat open. Open a chat or provide chatId.');
    }

    log(`URL: ${url}`);
    log(`TTL: ${ttlSeconds}${ttlSeconds === VIEW_ONCE_TTL ? ' (view once)' : 's'}`);
    log(`Chat: ${targetChatId}`);

    const blob = await downloadImage(url);
    const filename = `photo_${Date.now()}.jpg`;
    const attachment = await buildAttachment(blob, filename, ttlSeconds);

    const actions = TelegramApi._getActions();

    // Find sendMessage action - it might be minified
    let sendFn = actions.sendMessage;
    if (!sendFn) {
      // Search for a function that takes chatId and attachments
      for (const [key, fn] of Object.entries(actions)) {
        if (typeof fn === 'function') {
          const fnStr = fn.toString();
          if (fnStr.includes('attachments') || fnStr.includes('chatId')) {
            sendFn = fn;
            log(`Using action: ${key}`);
            break;
          }
        }
      }
    }

    if (!sendFn) {
      throw new Error('sendMessage action not found');
    }

    log('Sending...');
    sendFn({
      chatId: targetChatId,
      attachments: [attachment],
    });

    URL.revokeObjectURL(attachment.blobUrl);
    log('SUCCESS!');
    return true;
  }

  async function initialize() {
    log('========================================');
    log('  Telegram Disappearing Photos');
    log('========================================');

    if (document.readyState !== 'complete') {
      await new Promise(r => window.addEventListener('load', r));
    }

    log('Waiting for Telegram...');
    await new Promise(r => setTimeout(r, 4000));

    // Check DEBUG mode globals first
    if (checkWindowGlobals()) {
      log('Using DEBUG mode globals');
    } else {
      // Hook webpack
      await hookWebpack();
    }

    // Retry a few times
    for (let i = 0; i < 3 && (!TelegramApi._getGlobal || !TelegramApi._getActions); i++) {
      log(`Retry ${i + 1}...`);
      await new Promise(r => setTimeout(r, 2000));
      if (TelegramApi._webpackRequire) {
        tryKnownModules(TelegramApi._webpackRequire);
        if (!TelegramApi._getGlobal || !TelegramApi._getActions) {
          searchModules(TelegramApi._webpackRequire);
        }
      }
    }

    // Expose API
    window.TelegramApi = {
      getGlobal: () => TelegramApi._getGlobal?.() || null,
      getActions: () => TelegramApi._getActions?.() || null,
      setGlobal: TelegramApi._setGlobal,
      getCurrentChatId,
      getChat,
      _internal: TelegramApi,
    };

    window.TelegramSendDisappearingPhoto = sendDisappearingPhoto;

    log('');
    log('========================================');
    log('  READY');
    log('========================================');
    log('');
    log('Status:');
    log('  getGlobal:', !!TelegramApi._getGlobal);
    log('  getActions:', !!TelegramApi._getActions);
    log('');
    log('Usage:');
    log('  await TelegramSendDisappearingPhoto("https://picsum.photos/400", 5)');
    log('');

    if (!TelegramApi._getGlobal || !TelegramApi._getActions) {
      warn('Could not find required functions.');
      warn('The module IDs may have changed in this build.');
    }
  }

  initialize().catch(e => error('Init failed:', e));
})();
