/**
 * Telegram Disappearing Photos - Injected Script
 *
 * Finds Telegram's internal functions by analyzing webpack modules
 * and checking function return values for expected structures.
 */

(function() {
  'use strict';

  const LOG_PREFIX = '[TelegramDisappearingPhotos]';
  const VIEW_ONCE_TTL = 2147483647;

  const TelegramApi = {
    _initialized: false,
    _webpackRequire: null,
    _getGlobal: null,
    _getActions: null,
    _getCurrentTabId: null,
  };

  function log(...args) { console.log(LOG_PREFIX, ...args); }
  function warn(...args) { console.warn(LOG_PREFIX, ...args); }
  function error(...args) { console.error(LOG_PREFIX, ...args); }

  /**
   * Check if object looks like Telegram's global state
   */
  function isGlobalState(obj) {
    if (!obj || typeof obj !== 'object') return false;
    // Global state has these characteristic properties
    return (
      'byTabId' in obj ||
      ('chats' in obj && 'users' in obj) ||
      ('settings' in obj && 'messages' in obj)
    );
  }

  /**
   * Check if object looks like Telegram's actions object
   */
  function isActionsObject(obj) {
    if (!obj || typeof obj !== 'object') return false;
    const keys = Object.keys(obj);
    if (keys.length < 10) return false;

    // Actions object has many functions including sendMessage
    const fnCount = keys.filter(k => typeof obj[k] === 'function').length;
    const hasCommonActions = (
      typeof obj.sendMessage === 'function' ||
      typeof obj.openChat === 'function' ||
      typeof obj.loadChats === 'function'
    );

    return fnCount > 20 && hasCommonActions;
  }

  /**
   * Find webpack chunk array
   */
  function findWebpackChunk() {
    for (const key of Object.keys(window)) {
      if (key.startsWith('webpackChunk') && Array.isArray(window[key])) {
        return window[key];
      }
    }
    return null;
  }

  /**
   * Hook webpack and capture require function
   */
  function hookWebpack() {
    return new Promise((resolve) => {
      // Check window globals first
      if (typeof window.getGlobal === 'function') {
        TelegramApi._getGlobal = window.getGlobal;
        log('Found window.getGlobal');
      }
      if (typeof window.getActions === 'function') {
        TelegramApi._getActions = window.getActions;
        log('Found window.getActions');
      }

      if (TelegramApi._getGlobal && TelegramApi._getActions) {
        resolve(true);
        return;
      }

      const chunk = findWebpackChunk();
      if (!chunk) {
        warn('No webpack chunk found');
        resolve(false);
        return;
      }

      log('Found webpack chunk, hooking...');
      const origPush = chunk.push.bind(chunk);

      // Inject to capture require
      const hookId = `__tdp_${Date.now()}__`;
      try {
        origPush([
          [hookId],
          { [hookId]: function(m, e, r) {
            if (r && r.c) searchModules(r);
          }},
          function(r) {
            if (r && r.c) searchModules(r);
            try { r(hookId); } catch(e) {}
          }
        ]);
      } catch (e) {}

      // Also search existing modules
      setTimeout(() => {
        if (TelegramApi._webpackRequire) {
          searchModules(TelegramApi._webpackRequire);
        }
        resolve(TelegramApi._getGlobal && TelegramApi._getActions);
      }, 1000);

      setTimeout(() => resolve(false), 5000);
    });
  }

  /**
   * Search all modules for getGlobal and getActions by behavior
   */
  function searchModules(require) {
    if (!require || !require.c) return;
    TelegramApi._webpackRequire = require;

    const cache = require.c;
    log(`Searching ${Object.keys(cache).length} modules by behavior...`);

    for (const [moduleId, module] of Object.entries(cache)) {
      if (TelegramApi._getGlobal && TelegramApi._getActions) break;
      if (!module || !module.exports) continue;

      const exports = module.exports;

      // Search all exported functions
      searchExports(exports, moduleId);

      // Check default export too
      if (exports.default) {
        searchExports(exports.default, moduleId + '.default');
      }
    }

    logStatus();
  }

  /**
   * Search exports for our target functions
   */
  function searchExports(exports, moduleId) {
    if (!exports || typeof exports !== 'object') return;

    for (const key of Object.keys(exports)) {
      if (typeof exports[key] !== 'function') continue;

      try {
        // Call the function with no args and check result
        const result = exports[key]();

        if (!TelegramApi._getGlobal && isGlobalState(result)) {
          TelegramApi._getGlobal = exports[key];
          log(`Found getGlobal: ${moduleId}.${key}`);
        }

        if (!TelegramApi._getActions && isActionsObject(result)) {
          TelegramApi._getActions = exports[key];
          log(`Found getActions: ${moduleId}.${key}`);
        }

        // Check for getCurrentTabId
        if (key.toLowerCase().includes('tab') && typeof result === 'number') {
          TelegramApi._getCurrentTabId = exports[key];
        }
      } catch (e) {
        // Function threw - not what we're looking for
      }
    }
  }

  function logStatus() {
    log('');
    log('=== Status ===');
    log('  getGlobal:', !!TelegramApi._getGlobal);
    log('  getActions:', !!TelegramApi._getActions);
  }

  function getCurrentChatId() {
    if (!TelegramApi._getGlobal) return null;
    try {
      const global = TelegramApi._getGlobal();
      const tabId = TelegramApi._getCurrentTabId ? TelegramApi._getCurrentTabId() : 0;

      if (global.byTabId) {
        const state = global.byTabId[tabId] || Object.values(global.byTabId)[0];
        if (state?.currentChat?.id) return state.currentChat.id;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  function getChat(chatId) {
    if (!TelegramApi._getGlobal) return null;
    try {
      const global = TelegramApi._getGlobal();
      return global.chats?.byId?.[chatId] || null;
    } catch (e) {
      return null;
    }
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
      throw new Error('getActions not found. Extension cannot send messages.');
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
    const tabId = TelegramApi._getCurrentTabId ? TelegramApi._getCurrentTabId() : undefined;

    log('Sending...');
    actions.sendMessage({
      chatId: targetChatId,
      attachments: [attachment],
      tabId,
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

    log('Waiting for Telegram to load...');
    await new Promise(r => setTimeout(r, 4000));

    await hookWebpack();

    // Retry search a few times
    for (let i = 0; i < 3 && (!TelegramApi._getGlobal || !TelegramApi._getActions); i++) {
      log(`Retry ${i + 1}...`);
      await new Promise(r => setTimeout(r, 2000));
      if (TelegramApi._webpackRequire) {
        searchModules(TelegramApi._webpackRequire);
      }
    }

    window.TelegramApi = {
      getGlobal: () => TelegramApi._getGlobal ? TelegramApi._getGlobal() : null,
      getActions: () => TelegramApi._getActions ? TelegramApi._getActions() : null,
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
    log('Usage:');
    log('  await TelegramSendDisappearingPhoto("https://picsum.photos/400", 5)');
    log('');

    logStatus();

    if (!TelegramApi._getGlobal || !TelegramApi._getActions) {
      warn('');
      warn('Could not find required functions.');
      warn('Make sure Telegram Web A is fully loaded.');
      warn('');
    }
  }

  initialize().catch(e => error('Init failed:', e));
})();
