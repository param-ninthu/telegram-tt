/**
 * Telegram Disappearing Photos - Injected Script
 *
 * This script hooks into Telegram Web A's webpack runtime to access
 * internal API functions and exposes them globally for sending
 * disappearing (self-destructing) photos from the DevTools console.
 *
 * ARCHITECTURE NOTE:
 * Telegram Web A uses a web worker for API calls. The actual functions
 * like `sendApiMessage` and `uploadMedia` run inside the worker.
 * From the main thread (where this extension runs), we can only access:
 * - getActions().sendMessage() - dispatches the send action
 * - callApi('sendMessage', ...) - sends message to worker
 *
 * The source code fixes in messages.ts and messageContent.ts enable
 * proper TTL support when using these interfaces.
 */

(function() {
  'use strict';

  const LOG_PREFIX = '[TelegramDisappearingPhotos]';
  const VIEW_ONCE_TTL = 2147483647; // Max 32-bit signed int = "view once"

  // Store for extracted modules and functions
  const TelegramApi = {
    _initialized: false,
    _webpackRequire: null,
    _modules: new Map(),
    _GramJs: null,
    _invokeRequest: null,
    _getGlobal: null,
    _getActions: null,
    _getCurrentTabId: null,
    _callApi: null,
    _cancelApiProgress: null,
    _messagesModule: null,
    _buildAttachment: null,
  };

  /**
   * Logging utilities
   */
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
   * Find all webpack chunk arrays
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
   * Hook into webpack to capture the require function
   */
  function hookWebpack() {
    return new Promise((resolve) => {
      const chunkArrays = findWebpackChunkArrays();

      if (chunkArrays.length === 0) {
        warn('No webpack chunk arrays found, waiting...');
        setTimeout(() => {
          const retryArrays = findWebpackChunkArrays();
          if (retryArrays.length > 0) {
            hookWebpackArray(retryArrays[0], resolve);
          } else {
            warn('Still no webpack arrays found. Will try alternative methods.');
            resolve(null);
          }
        }, 2000);
        return;
      }

      log(`Found ${chunkArrays.length} webpack chunk array(s): ${chunkArrays.map(c => c.name).join(', ')}`);
      hookWebpackArray(chunkArrays[0], resolve);
    });
  }

  /**
   * Hook a specific webpack chunk array
   */
  function hookWebpackArray(chunkInfo, resolve) {
    const { name, array } = chunkInfo;
    const originalPush = array.push.bind(array);

    // Intercept future chunk loads
    array.push = function(chunk) {
      const result = originalPush(chunk);
      extractFromChunk(chunk);
      return result;
    };

    // Process existing chunks
    for (const chunk of array) {
      extractFromChunk(chunk);
    }

    // Inject our own chunk to capture require
    const hookId = `__tdp_hook_${Date.now()}__`;
    try {
      originalPush([
        [hookId],
        {
          [hookId]: function(module, exports, require) {
            if (require && typeof require === 'function') {
              captureWebpackRequire(require);
              if (TelegramApi._webpackRequire) {
                resolve(TelegramApi._webpackRequire);
              }
            }
          }
        },
        function(require) {
          captureWebpackRequire(require);
          try { require(hookId); } catch (e) { /* ignore */ }
          if (TelegramApi._webpackRequire) {
            resolve(TelegramApi._webpackRequire);
          }
        }
      ]);
    } catch (e) {
      warn('Failed to inject hook chunk:', e.message);
    }

    // Timeout fallback
    setTimeout(() => {
      if (!TelegramApi._webpackRequire) {
        log('Timeout waiting for webpack require, using collected modules');
        resolve(null);
      }
    }, 5000);
  }

  /**
   * Extract modules from a webpack chunk
   */
  function extractFromChunk(chunk) {
    if (!chunk || !Array.isArray(chunk)) return;

    const [, modules] = chunk;
    if (modules && typeof modules === 'object') {
      for (const [id, moduleFn] of Object.entries(modules)) {
        if (typeof moduleFn === 'function') {
          TelegramApi._modules.set(id, moduleFn);
        }
      }
    }
  }

  /**
   * Capture and store webpack require function
   */
  function captureWebpackRequire(require) {
    if (!require || !require.m || !require.c) return;

    if (!TelegramApi._webpackRequire) {
      TelegramApi._webpackRequire = require;
      log('Captured webpack require function');
      searchAllModules(require);
    }
  }

  /**
   * Search all loaded modules for needed functions
   */
  function searchAllModules(require) {
    if (!require || !require.c) return;

    const cache = require.c;
    log(`Searching ${Object.keys(cache).length} cached modules...`);

    for (const [moduleId, cachedModule] of Object.entries(cache)) {
      if (!cachedModule || !cachedModule.exports) continue;
      analyzeModuleExports(moduleId, cachedModule.exports);
    }

    // Also try to require and analyze uncached modules
    if (require.m) {
      for (const moduleId of Object.keys(require.m)) {
        if (!cache[moduleId]) {
          try {
            const exports = require(moduleId);
            if (exports) {
              analyzeModuleExports(moduleId, exports);
            }
          } catch (e) {
            // Module couldn't be loaded, skip
          }
        }
      }
    }

    logFoundModules();
  }

  /**
   * Analyze module exports to find needed functions
   */
  function analyzeModuleExports(moduleId, exports) {
    if (!exports || typeof exports !== 'object') return;

    // Check for getGlobal/getActions (global state)
    if (typeof exports.getGlobal === 'function' && typeof exports.getActions === 'function') {
      TelegramApi._getGlobal = exports.getGlobal;
      TelegramApi._getActions = exports.getActions;
      log(`Found global state module (${moduleId}): getGlobal, getActions`);
    }

    // Check for getCurrentTabId
    if (typeof exports.getCurrentTabId === 'function' && !TelegramApi._getCurrentTabId) {
      TelegramApi._getCurrentTabId = exports.getCurrentTabId;
      log(`Found getCurrentTabId (${moduleId})`);
    }

    // Check for callApi from worker/connector
    if (typeof exports.callApi === 'function') {
      TelegramApi._callApi = exports.callApi;
      log(`Found callApi (${moduleId})`);
    }

    // Check for cancelApiProgress
    if (typeof exports.cancelApiProgress === 'function') {
      TelegramApi._cancelApiProgress = exports.cancelApiProgress;
    }

    // Check for GramJS
    if (exports.Api && exports.Api.InputMediaUploadedPhoto) {
      TelegramApi._GramJs = exports;
      log(`Found GramJS (${moduleId})`);
    }

    // Check for buildAttachment utility
    if (typeof exports.default === 'function') {
      const fnStr = exports.default.toString();
      if (fnStr.includes('blobUrl') && fnStr.includes('filename') && fnStr.includes('mimeType')) {
        TelegramApi._buildAttachment = exports.default;
        log(`Found buildAttachment (${moduleId})`);
      }
    }

    // Check for message-related exports (sendMessage, sendApiMessage, etc.)
    if (exports.sendMessage || exports.sendApiMessage || exports.sendMessageLocal) {
      TelegramApi._messagesModule = exports;
      log(`Found messages module (${moduleId}):`, Object.keys(exports).filter(k => typeof exports[k] === 'function').slice(0, 10));
    }

    // Check default exports
    if (exports.default && typeof exports.default === 'object') {
      analyzeModuleExports(moduleId + '.default', exports.default);
    }
  }

  /**
   * Log summary of found modules
   */
  function logFoundModules() {
    log('');
    log('=== Module Discovery Summary ===');
    log('  getGlobal:', !!TelegramApi._getGlobal);
    log('  getActions:', !!TelegramApi._getActions);
    log('  getCurrentTabId:', !!TelegramApi._getCurrentTabId);
    log('  callApi:', !!TelegramApi._callApi);
    log('  GramJS:', !!TelegramApi._GramJs);
    log('  messagesModule:', !!TelegramApi._messagesModule);
    log('  buildAttachment:', !!TelegramApi._buildAttachment);

    if (TelegramApi._messagesModule) {
      const fns = Object.keys(TelegramApi._messagesModule).filter(k => typeof TelegramApi._messagesModule[k] === 'function');
      log('  Messages module functions:', fns);
    }
  }

  /**
   * Download image from URL
   */
  async function downloadImage(url) {
    log(`Downloading image from: ${url}`);

    try {
      const response = await fetch(url, {
        mode: 'cors',
        credentials: 'omit',
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const blob = await response.blob();
      log(`Downloaded: ${blob.size} bytes, type: ${blob.type}`);

      // Ensure it's an image type
      if (!blob.type.startsWith('image/')) {
        const ext = url.split('.').pop()?.toLowerCase();
        const mimeTypes = {
          'jpg': 'image/jpeg',
          'jpeg': 'image/jpeg',
          'png': 'image/png',
          'gif': 'image/gif',
          'webp': 'image/webp',
        };
        const mimeType = mimeTypes[ext] || 'image/jpeg';
        return new Blob([blob], { type: mimeType });
      }

      return blob;
    } catch (e) {
      error('Failed to download image:', e);
      throw e;
    }
  }

  /**
   * Get image dimensions from blob
   */
  function getImageDimensions(blob) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();

      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve({ width: 512, height: 512 });
      };

      img.src = url;
    });
  }

  /**
   * Get current active chat ID from global state
   */
  function getCurrentChatId() {
    if (!TelegramApi._getGlobal) {
      error('getGlobal not available');
      return null;
    }

    try {
      const global = TelegramApi._getGlobal();
      const tabId = TelegramApi._getCurrentTabId ? TelegramApi._getCurrentTabId() : 0;

      // Try current tab first
      if (global.byTabId && global.byTabId[tabId]) {
        const tabState = global.byTabId[tabId];
        if (tabState.currentChat && tabState.currentChat.id) {
          return tabState.currentChat.id;
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
   * Get chat info from global state
   */
  function getChat(chatId) {
    if (!TelegramApi._getGlobal) return null;

    try {
      const global = TelegramApi._getGlobal();
      return global.chats?.byId?.[chatId] || null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Build attachment object compatible with Telegram Web A
   */
  async function buildAttachment(blob, filename, ttlSeconds) {
    // Try to use Telegram's own buildAttachment if available
    if (TelegramApi._buildAttachment) {
      try {
        const attachment = await TelegramApi._buildAttachment(filename, blob, { ttlSeconds });
        log('Built attachment using Telegram buildAttachment');
        return attachment;
      } catch (e) {
        warn('Failed to use Telegram buildAttachment, using custom:', e.message);
      }
    }

    // Fallback to custom implementation
    const blobUrl = URL.createObjectURL(blob);
    const dimensions = await getImageDimensions(blob);

    return {
      blob: blob,
      blobUrl: blobUrl,
      filename: filename,
      mimeType: blob.type || 'image/jpeg',
      size: blob.size,
      quick: {
        width: dimensions.width,
        height: dimensions.height,
      },
      ttlSeconds: ttlSeconds,
      shouldSendAsFile: false,
      shouldSendAsSpoiler: false,
    };
  }

  /**
   * Send disappearing photo using getActions().sendMessage
   */
  async function sendViaActions(chatId, attachment) {
    if (!TelegramApi._getActions) {
      throw new Error('getActions not available');
    }

    const actions = TelegramApi._getActions();
    if (!actions || !actions.sendMessage) {
      throw new Error('sendMessage action not found');
    }

    const tabId = TelegramApi._getCurrentTabId ? TelegramApi._getCurrentTabId() : undefined;

    log('Sending via actions.sendMessage...');
    log('Attachment ttlSeconds:', attachment.ttlSeconds);

    actions.sendMessage({
      chatId: chatId,
      attachments: [attachment],
      tabId: tabId,
    });

    return true;
  }

  /**
   * Send via callApi (direct worker communication)
   */
  async function sendViaCallApi(chatId, attachment) {
    if (!TelegramApi._callApi) {
      throw new Error('callApi not available');
    }

    const chat = getChat(chatId);
    if (!chat) {
      throw new Error(`Chat ${chatId} not found in global state`);
    }

    log('Sending via callApi...');

    // callApi('sendMessage', params) - this goes to the worker
    const result = await TelegramApi._callApi('sendMessage', {
      chat: chat,
      attachment: attachment,
    });

    return !!result;
  }

  /**
   * Main function: Send a disappearing photo
   *
   * @param {string} url - URL of the image to download and send
   * @param {number} ttlSeconds - Time-to-live in seconds. Use 2147483647 for "view once"
   * @param {string|number} chatId - Optional chat ID (uses current chat if not provided)
   * @returns {Promise<boolean>}
   */
  async function sendDisappearingPhoto(url, ttlSeconds = VIEW_ONCE_TTL, chatId = null) {
    log('========================================');
    log('  TelegramSendDisappearingPhoto');
    log('========================================');
    log(`URL: ${url}`);
    log(`TTL: ${ttlSeconds} seconds${ttlSeconds === VIEW_ONCE_TTL ? ' (view once)' : ''}`);

    // Validate inputs
    if (!url || typeof url !== 'string') {
      throw new Error('URL is required and must be a string');
    }

    if (typeof ttlSeconds !== 'number' || ttlSeconds < 1) {
      throw new Error('ttlSeconds must be a positive number');
    }

    // Determine target chat
    const targetChatId = chatId || getCurrentChatId();
    if (!targetChatId) {
      throw new Error(
        'No chat specified and no active chat found.\n' +
        'Please either:\n' +
        '  1. Open a chat in Telegram Web A first, or\n' +
        '  2. Provide chatId as the third parameter'
      );
    }
    log(`Target chat: ${targetChatId}`);

    // Verify chat exists
    const chat = getChat(targetChatId);
    if (!chat) {
      warn(`Chat ${targetChatId} not found in cache. This may cause issues.`);
    } else {
      log(`Chat title: ${chat.title || 'N/A'}`);
    }

    // Download the image
    log('Downloading image...');
    const blob = await downloadImage(url);
    const filename = `photo_${Date.now()}.${blob.type.split('/')[1] || 'jpg'}`;

    // Build attachment with TTL
    log('Building attachment with TTL...');
    const attachment = await buildAttachment(blob, filename, ttlSeconds);
    log('Attachment:', {
      filename: attachment.filename,
      size: attachment.size,
      dimensions: attachment.quick,
      ttlSeconds: attachment.ttlSeconds,
    });

    // Try to send
    let success = false;
    let lastError = null;

    // Method 1: Use getActions().sendMessage()
    if (TelegramApi._getActions) {
      try {
        log('Attempting Method 1: getActions().sendMessage()');
        success = await sendViaActions(targetChatId, attachment);
        if (success) {
          log('SUCCESS via getActions().sendMessage()');
        }
      } catch (e) {
        warn('Method 1 failed:', e.message);
        lastError = e;
      }
    }

    // Method 2: Use callApi('sendMessage', ...)
    if (!success && TelegramApi._callApi) {
      try {
        log('Attempting Method 2: callApi("sendMessage", ...)');
        success = await sendViaCallApi(targetChatId, attachment);
        if (success) {
          log('SUCCESS via callApi()');
        }
      } catch (e) {
        warn('Method 2 failed:', e.message);
        lastError = e;
      }
    }

    // Cleanup
    if (attachment.blobUrl) {
      URL.revokeObjectURL(attachment.blobUrl);
    }

    if (!success) {
      throw lastError || new Error('All send methods failed');
    }

    log('========================================');
    log('  Message sent successfully!');
    log('========================================');

    return true;
  }

  /**
   * Wrapper for callApi - allows direct API calls
   */
  function callApi(methodName, ...args) {
    if (!TelegramApi._callApi) {
      throw new Error('callApi not available. Make sure Telegram is fully loaded.');
    }
    return TelegramApi._callApi(methodName, ...args);
  }

  /**
   * Debug function to inspect global state
   */
  function debugGlobalState() {
    if (!TelegramApi._getGlobal) {
      error('getGlobal not available');
      return null;
    }

    const global = TelegramApi._getGlobal();
    log('Global state keys:', Object.keys(global));

    if (global.chats) {
      log('Number of chats:', Object.keys(global.chats.byId || {}).length);
    }

    if (global.byTabId) {
      log('Tabs:', Object.keys(global.byTabId));
      for (const [tabId, state] of Object.entries(global.byTabId)) {
        if (state.currentChat) {
          log(`  Tab ${tabId} current chat:`, state.currentChat.id);
        }
      }
    }

    return global;
  }

  /**
   * Debug function to list available actions
   */
  function debugActions() {
    if (!TelegramApi._getActions) {
      error('getActions not available');
      return null;
    }

    const actions = TelegramApi._getActions();
    const actionNames = Object.keys(actions).filter(k => typeof actions[k] === 'function');
    log('Available actions:', actionNames.length);
    return actionNames;
  }

  /**
   * Initialize the extension
   */
  async function initialize() {
    log('========================================');
    log('  Initializing Telegram Disappearing');
    log('  Photos Extension');
    log('========================================');

    // Wait for page to be ready
    if (document.readyState !== 'complete') {
      log('Waiting for page load...');
      await new Promise(resolve => window.addEventListener('load', resolve));
    }

    // Give Telegram more time to initialize its modules
    log('Waiting for Telegram to initialize...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Hook into webpack
    log('Hooking into webpack...');
    await hookWebpack();

    // Expose API globally
    window.TelegramApi = {
      // Direct access to internal functions (main thread only)
      getGlobal: TelegramApi._getGlobal,
      getActions: TelegramApi._getActions,
      getCurrentTabId: TelegramApi._getCurrentTabId,

      // API communication (sends messages to worker)
      callApi: callApi,

      // GramJS classes (for reference)
      GramJs: TelegramApi._GramJs,

      // Messages module (exported functions from messages.ts)
      // Note: These run in worker context when called via callApi
      messages: TelegramApi._messagesModule,

      // Utilities
      buildAttachment: buildAttachment,
      downloadImage: downloadImage,
      getCurrentChatId: getCurrentChatId,
      getChat: getChat,

      // Debug utilities
      debugGlobalState,
      debugActions,

      // Internal state (for advanced debugging)
      _internal: TelegramApi,
    };

    // Expose main helper function
    window.TelegramSendDisappearingPhoto = sendDisappearingPhoto;

    // Mark as initialized
    TelegramApi._initialized = true;

    // Print usage instructions
    log('');
    log('========================================');
    log('  INITIALIZATION COMPLETE');
    log('========================================');
    log('');
    log('EXPOSED GLOBALS:');
    log('');
    log('  window.TelegramSendDisappearingPhoto(url, ttlSeconds?, chatId?)');
    log('    - Main helper function for sending disappearing photos');
    log('');
    log('  window.TelegramApi.getGlobal()');
    log('    - Get the current global state');
    log('');
    log('  window.TelegramApi.getActions()');
    log('    - Get all action dispatchers (sendMessage, etc.)');
    log('');
    log('  window.TelegramApi.callApi(methodName, ...args)');
    log('    - Call any API method directly (communicates with worker)');
    log('');
    log('  window.TelegramApi.messages');
    log('    - Messages module with exported functions');
    if (TelegramApi._messagesModule) {
      const fns = Object.keys(TelegramApi._messagesModule).filter(k => typeof TelegramApi._messagesModule[k] === 'function');
      log('    - Available:', fns.slice(0, 5).join(', '), fns.length > 5 ? `... (${fns.length} total)` : '');
    }
    log('');
    log('USAGE EXAMPLES:');
    log('');
    log('  // Send view-once photo:');
    log('  await TelegramSendDisappearingPhoto("https://picsum.photos/400/300")');
    log('');
    log('  // Send with 5-second TTL:');
    log('  await TelegramSendDisappearingPhoto("https://picsum.photos/400/300", 5)');
    log('');
    log('  // Get current chat:');
    log('  TelegramApi.getCurrentChatId()');
    log('');
    log('  // Call API directly:');
    log('  await TelegramApi.callApi("fetchMessages", { chat, ... })');
    log('');
    log('NOTE: sendApiMessage and uploadMedia are internal worker functions.');
    log('      They cannot be called directly from the main thread.');
    log('      Use TelegramSendDisappearingPhoto or getActions().sendMessage() instead.');
    log('');

    // Status check
    if (!TelegramApi._getActions) {
      warn('WARNING: getActions not found. Sending may not work.');
      warn('Try refreshing the page and waiting for full load.');
    }
  }

  // Start initialization
  initialize().catch(e => {
    error('Initialization failed:', e);
    error('Try refreshing the page.');
  });

})();
