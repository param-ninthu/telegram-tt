/**
 * Telegram Disappearing Photos - Injected Script
 *
 * This script hooks into Telegram Web A's webpack runtime to access
 * internal API functions and exposes them globally for sending
 * disappearing (self-destructing) photos from the DevTools console.
 */

(function() {
  'use strict';

  const LOG_PREFIX = '[TelegramDisappearingPhotos]';
  const VIEW_ONCE_TTL = 2147483647;

  // Store for extracted modules and functions
  const TelegramApi = {
    _initialized: false,
    _webpackRequire: null,
    _modules: new Map(),
    _getGlobal: null,
    _getActions: null,
    _setGlobal: null,
    _getCurrentTabId: null,
    _callApi: null,
  };

  function log(...args) {
    console.log(LOG_PREFIX, ...args);
  }

  function warn(...args) {
    console.warn(LOG_PREFIX, ...args);
  }

  function error(...args) {
    console.error(LOG_PREFIX, ...args);
  }

  /**
   * Check if functions are already exposed on window (DEBUG mode)
   */
  function checkWindowGlobals() {
    if (typeof window.getGlobal === 'function') {
      TelegramApi._getGlobal = window.getGlobal;
      log('Found window.getGlobal (DEBUG mode)');
    }
    if (typeof window.getActions === 'function') {
      TelegramApi._getActions = window.getActions;
      log('Found window.getActions (DEBUG mode)');
    }
    if (typeof window.setGlobal === 'function') {
      TelegramApi._setGlobal = window.setGlobal;
      log('Found window.setGlobal (DEBUG mode)');
    }
  }

  /**
   * Find webpack chunk arrays
   */
  function findWebpackChunkArrays() {
    const arrays = [];
    for (const key of Object.keys(window)) {
      if (key.startsWith('webpackChunk') && Array.isArray(window[key])) {
        arrays.push({ name: key, array: window[key] });
      }
    }
    return arrays;
  }

  /**
   * Hook into webpack
   */
  function hookWebpack() {
    return new Promise((resolve) => {
      const chunkArrays = findWebpackChunkArrays();

      if (chunkArrays.length === 0) {
        warn('No webpack chunk arrays found, retrying...');
        setTimeout(() => {
          const retryArrays = findWebpackChunkArrays();
          if (retryArrays.length > 0) {
            hookWebpackArray(retryArrays[0], resolve);
          } else {
            resolve(null);
          }
        }, 2000);
        return;
      }

      log(`Found webpack: ${chunkArrays.map(c => c.name).join(', ')}`);
      hookWebpackArray(chunkArrays[0], resolve);
    });
  }

  /**
   * Hook a webpack chunk array
   */
  function hookWebpackArray(chunkInfo, resolve) {
    const { array } = chunkInfo;
    const originalPush = array.push.bind(array);

    array.push = function(chunk) {
      const result = originalPush(chunk);
      extractFromChunk(chunk);
      return result;
    };

    // Process existing chunks
    for (const chunk of array) {
      extractFromChunk(chunk);
    }

    // Inject hook chunk
    const hookId = `__tdp_${Date.now()}__`;
    try {
      originalPush([
        [hookId],
        { [hookId]: function(m, e, r) { captureWebpackRequire(r); } },
        function(r) {
          captureWebpackRequire(r);
          try { r(hookId); } catch(e) {}
          resolve(TelegramApi._webpackRequire);
        }
      ]);
    } catch (e) {
      warn('Hook injection failed:', e.message);
    }

    setTimeout(() => resolve(TelegramApi._webpackRequire), 5000);
  }

  /**
   * Extract modules from chunk
   */
  function extractFromChunk(chunk) {
    if (!chunk || !Array.isArray(chunk)) return;
    const [, modules] = chunk;
    if (modules && typeof modules === 'object') {
      for (const [id, fn] of Object.entries(modules)) {
        if (typeof fn === 'function') {
          TelegramApi._modules.set(id, fn);
        }
      }
    }
  }

  /**
   * Capture webpack require
   */
  function captureWebpackRequire(require) {
    if (!require || !require.m || !require.c) return;
    if (TelegramApi._webpackRequire) return;

    TelegramApi._webpackRequire = require;
    log('Captured webpack require');
    searchAllModules(require);
  }

  /**
   * Search modules for needed functions
   */
  function searchAllModules(require) {
    if (!require || !require.c) return;

    const cache = require.c;
    log(`Searching ${Object.keys(cache).length} modules...`);

    for (const [moduleId, module] of Object.entries(cache)) {
      if (!module || !module.exports) continue;
      analyzeExports(moduleId, module.exports);
    }

    // Try loading uncached modules
    if (require.m) {
      for (const moduleId of Object.keys(require.m)) {
        if (!cache[moduleId]) {
          try {
            const exports = require(moduleId);
            if (exports) analyzeExports(moduleId, exports);
          } catch (e) {}
        }
      }
    }

    logStatus();
  }

  /**
   * Analyze module exports
   */
  function analyzeExports(moduleId, exports) {
    if (!exports || typeof exports !== 'object') return;

    // Look for teactn module (has getGlobal, setGlobal, getActions together)
    if (typeof exports.getGlobal === 'function' &&
        typeof exports.setGlobal === 'function' &&
        typeof exports.getActions === 'function') {
      TelegramApi._getGlobal = exports.getGlobal;
      TelegramApi._setGlobal = exports.setGlobal;
      TelegramApi._getActions = exports.getActions;
      log(`Found teactn module (${moduleId})`);
    }

    // Look for global state module (has getGlobal, getActions but also addActionHandler)
    if (!TelegramApi._getGlobal &&
        typeof exports.getGlobal === 'function' &&
        typeof exports.getActions === 'function') {
      TelegramApi._getGlobal = exports.getGlobal;
      TelegramApi._getActions = exports.getActions;
      if (exports.setGlobal) TelegramApi._setGlobal = exports.setGlobal;
      log(`Found global module (${moduleId})`);
    }

    // Look for getCurrentTabId
    if (typeof exports.getCurrentTabId === 'function') {
      TelegramApi._getCurrentTabId = exports.getCurrentTabId;
    }

    // Look for callApi
    if (typeof exports.callApi === 'function') {
      TelegramApi._callApi = exports.callApi;
      log(`Found callApi (${moduleId})`);
    }

    // Check default export
    if (exports.default && typeof exports.default === 'object') {
      analyzeExports(moduleId + '.default', exports.default);
    }
  }

  /**
   * Alternative: Find global state by searching for characteristic properties
   */
  function findGlobalStateAlternative() {
    if (TelegramApi._getGlobal) return;

    log('Trying alternative global state detection...');

    // The global state has specific structure with byTabId, chats, users, etc.
    const require = TelegramApi._webpackRequire;
    if (!require || !require.c) return;

    for (const [moduleId, module] of Object.entries(require.c)) {
      if (!module || !module.exports) continue;

      const exports = module.exports;

      // Look for modules that export functions returning objects with 'byTabId'
      for (const key of Object.keys(exports)) {
        if (typeof exports[key] === 'function') {
          try {
            const result = exports[key]();
            if (result && typeof result === 'object' && result.byTabId) {
              TelegramApi._getGlobal = exports[key];
              log(`Found getGlobal via byTabId detection (${moduleId}.${key})`);
              return;
            }
          } catch (e) {}
        }
      }
    }
  }

  /**
   * Log current status
   */
  function logStatus() {
    log('');
    log('=== Detection Status ===');
    log('  getGlobal:', !!TelegramApi._getGlobal);
    log('  getActions:', !!TelegramApi._getActions);
    log('  setGlobal:', !!TelegramApi._setGlobal);
    log('  getCurrentTabId:', !!TelegramApi._getCurrentTabId);
    log('  callApi:', !!TelegramApi._callApi);
  }

  /**
   * Get current chat ID
   */
  function getCurrentChatId() {
    const getGlobal = TelegramApi._getGlobal;
    if (!getGlobal) {
      error('getGlobal not available');
      return null;
    }

    try {
      const global = getGlobal();
      const tabId = TelegramApi._getCurrentTabId ? TelegramApi._getCurrentTabId() : 0;

      if (global.byTabId && global.byTabId[tabId]) {
        const state = global.byTabId[tabId];
        if (state.currentChat && state.currentChat.id) {
          return state.currentChat.id;
        }
      }

      // Fallback: search all tabs
      if (global.byTabId) {
        for (const tid of Object.keys(global.byTabId)) {
          const state = global.byTabId[tid];
          if (state && state.currentChat && state.currentChat.id) {
            return state.currentChat.id;
          }
        }
      }

      return null;
    } catch (e) {
      error('Error getting chat ID:', e);
      return null;
    }
  }

  /**
   * Get chat by ID
   */
  function getChat(chatId) {
    const getGlobal = TelegramApi._getGlobal;
    if (!getGlobal) return null;

    try {
      const global = getGlobal();
      return global.chats?.byId?.[chatId] || null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Download image from URL
   */
  async function downloadImage(url) {
    log(`Downloading: ${url}`);
    const response = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    let blob = await response.blob();

    if (!blob.type.startsWith('image/')) {
      const ext = url.split('.').pop()?.toLowerCase();
      const types = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
      blob = new Blob([blob], { type: types[ext] || 'image/jpeg' });
    }

    log(`Downloaded: ${blob.size} bytes, ${blob.type}`);
    return blob;
  }

  /**
   * Get image dimensions
   */
  function getImageDimensions(blob) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve({ width: img.naturalWidth, height: img.naturalHeight }); };
      img.onerror = () => { URL.revokeObjectURL(url); resolve({ width: 512, height: 512 }); };
      img.src = url;
    });
  }

  /**
   * Build attachment
   */
  async function buildAttachment(blob, filename, ttlSeconds) {
    const blobUrl = URL.createObjectURL(blob);
    const dims = await getImageDimensions(blob);

    return {
      blob,
      blobUrl,
      filename,
      mimeType: blob.type || 'image/jpeg',
      size: blob.size,
      quick: { width: dims.width, height: dims.height },
      ttlSeconds,
      shouldSendAsFile: false,
      shouldSendAsSpoiler: false,
    };
  }

  /**
   * Send via actions
   */
  async function sendViaActions(chatId, attachment) {
    const getActions = TelegramApi._getActions;
    if (!getActions) throw new Error('getActions not available');

    const actions = getActions();
    if (!actions || !actions.sendMessage) throw new Error('sendMessage action not found');

    const tabId = TelegramApi._getCurrentTabId ? TelegramApi._getCurrentTabId() : undefined;

    log('Sending via actions.sendMessage...');
    log('TTL:', attachment.ttlSeconds);

    actions.sendMessage({
      chatId,
      attachments: [attachment],
      tabId,
    });

    return true;
  }

  /**
   * Main function: Send disappearing photo
   */
  async function sendDisappearingPhoto(url, ttlSeconds = VIEW_ONCE_TTL, chatId = null) {
    log('========================================');
    log('  TelegramSendDisappearingPhoto');
    log('========================================');
    log(`URL: ${url}`);
    log(`TTL: ${ttlSeconds}${ttlSeconds === VIEW_ONCE_TTL ? ' (view once)' : ' seconds'}`);

    if (!url || typeof url !== 'string') throw new Error('URL required');
    if (typeof ttlSeconds !== 'number' || ttlSeconds < 1) throw new Error('ttlSeconds must be positive');

    const targetChatId = chatId || getCurrentChatId();
    if (!targetChatId) {
      throw new Error('No chat open. Open a chat first or provide chatId.');
    }
    log(`Chat: ${targetChatId}`);

    const chat = getChat(targetChatId);
    if (chat) log(`Chat title: ${chat.title || 'N/A'}`);

    const blob = await downloadImage(url);
    const filename = `photo_${Date.now()}.${blob.type.split('/')[1] || 'jpg'}`;
    const attachment = await buildAttachment(blob, filename, ttlSeconds);

    log('Attachment:', { filename: attachment.filename, size: attachment.size, ttlSeconds: attachment.ttlSeconds });

    const success = await sendViaActions(targetChatId, attachment);
    URL.revokeObjectURL(attachment.blobUrl);

    if (success) {
      log('SUCCESS! Message sent.');
    }

    return success;
  }

  /**
   * Debug global state
   */
  function debugGlobalState() {
    const getGlobal = TelegramApi._getGlobal;
    if (!getGlobal) {
      error('getGlobal not available');
      return null;
    }

    const global = getGlobal();
    log('Global state keys:', Object.keys(global));
    log('Chats:', Object.keys(global.chats?.byId || {}).length);
    log('Users:', Object.keys(global.users?.byId || {}).length);

    if (global.byTabId) {
      for (const [tabId, state] of Object.entries(global.byTabId)) {
        if (state.currentChat) {
          log(`Tab ${tabId} -> Chat: ${state.currentChat.id}`);
        }
      }
    }

    return global;
  }

  /**
   * Debug actions
   */
  function debugActions() {
    const getActions = TelegramApi._getActions;
    if (!getActions) {
      error('getActions not available');
      return null;
    }

    const actions = getActions();
    const names = Object.keys(actions).filter(k => typeof actions[k] === 'function');
    log(`${names.length} actions available`);
    return names;
  }

  /**
   * Initialize
   */
  async function initialize() {
    log('========================================');
    log('  Telegram Disappearing Photos');
    log('========================================');

    // Wait for page
    if (document.readyState !== 'complete') {
      await new Promise(r => window.addEventListener('load', r));
    }

    log('Waiting for Telegram...');
    await new Promise(r => setTimeout(r, 3000));

    // Check window globals first (DEBUG mode)
    checkWindowGlobals();

    // Hook webpack if needed
    if (!TelegramApi._getGlobal || !TelegramApi._getActions) {
      log('Hooking webpack...');
      await hookWebpack();
    }

    // Try alternative detection
    if (!TelegramApi._getGlobal) {
      findGlobalStateAlternative();
    }

    // Expose API
    window.TelegramApi = {
      getGlobal: () => TelegramApi._getGlobal ? TelegramApi._getGlobal() : null,
      getActions: () => TelegramApi._getActions ? TelegramApi._getActions() : null,
      setGlobal: TelegramApi._setGlobal,
      callApi: TelegramApi._callApi,
      getCurrentChatId,
      getChat,
      buildAttachment,
      downloadImage,
      debugGlobalState,
      debugActions,
      _internal: TelegramApi,
    };

    window.TelegramSendDisappearingPhoto = sendDisappearingPhoto;

    TelegramApi._initialized = true;

    log('');
    log('========================================');
    log('  READY');
    log('========================================');
    log('');
    log('USAGE:');
    log('  await TelegramSendDisappearingPhoto("https://picsum.photos/400/300", 5)');
    log('');
    log('API:');
    log('  TelegramApi.getGlobal()      - Get global state');
    log('  TelegramApi.getActions()     - Get action dispatchers');
    log('  TelegramApi.debugGlobalState() - Debug state');
    log('  TelegramApi.debugActions()   - List actions');
    log('');

    logStatus();

    if (!TelegramApi._getGlobal || !TelegramApi._getActions) {
      warn('');
      warn('WARNING: Could not find getGlobal/getActions.');
      warn('This may happen if Telegram uses a production build.');
      warn('');
      warn('Try running in browser console:');
      warn('  Object.keys(window).filter(k => k.includes("webpack"))');
      warn('');
    }
  }

  initialize().catch(e => {
    error('Init failed:', e);
  });

})();
