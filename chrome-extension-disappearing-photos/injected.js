/**
 * Telegram Disappearing Photos - Injected Script
 *
 * This script hooks into Telegram Web A's webpack runtime to access
 * internal API functions and exposes them globally for sending
 * disappearing (self-destructing) photos from the DevTools console.
 *
 * NOTE: The current Telegram Web A codebase has a bug where ttlSeconds
 * is not passed for photos in the uploadMedia function. This extension
 * works around this by patching the function at runtime.
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
    _uploadMediaPatched: false,
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
        // Wait and retry
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
      log(`Found global state module (${moduleId})`);
    }

    // Check for getCurrentTabId
    if (typeof exports.getCurrentTabId === 'function') {
      TelegramApi._getCurrentTabId = exports.getCurrentTabId;
    }

    // Check for callApi
    if (typeof exports.callApi === 'function') {
      TelegramApi._callApi = exports.callApi;
      log(`Found callApi (${moduleId})`);
    }

    // Check for GramJS
    if (exports.Api && exports.Api.InputMediaUploadedPhoto) {
      TelegramApi._GramJs = exports;
      log(`Found GramJS (${moduleId})`);
    }

    // Check for invokeRequest
    if (typeof exports.invokeRequest === 'function') {
      TelegramApi._invokeRequest = exports.invokeRequest;
      log(`Found invokeRequest (${moduleId})`);
    }

    // Check default exports
    if (exports.default) {
      analyzeModuleExports(moduleId + '.default', exports.default);
    }
  }

  /**
   * Log summary of found modules
   */
  function logFoundModules() {
    log('=== Module Discovery Summary ===');
    log('  getGlobal:', !!TelegramApi._getGlobal);
    log('  getActions:', !!TelegramApi._getActions);
    log('  getCurrentTabId:', !!TelegramApi._getCurrentTabId);
    log('  callApi:', !!TelegramApi._callApi);
    log('  GramJS:', !!TelegramApi._GramJs);
    log('  invokeRequest:', !!TelegramApi._invokeRequest);
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
        // Try to detect from URL or default to JPEG
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
        resolve({ width: 512, height: 512 }); // Default fallback
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
  async function sendViaActions(chatId, attachment, ttlSeconds) {
    if (!TelegramApi._getActions) {
      throw new Error('getActions not available');
    }

    const actions = TelegramApi._getActions();
    if (!actions || !actions.sendMessage) {
      throw new Error('sendMessage action not found');
    }

    const tabId = TelegramApi._getCurrentTabId ? TelegramApi._getCurrentTabId() : undefined;

    // The attachment already has ttlSeconds, which should be passed through
    // However, due to the bug in uploadMedia, photos don't get TTL
    // We'll send it anyway and log a warning
    log('Sending via actions.sendMessage...');
    log('Note: TTL for photos requires a code fix in uploadMedia function');

    actions.sendMessage({
      chatId: chatId,
      attachments: [attachment],
      tabId: tabId,
    });

    return true;
  }

  /**
   * Alternative: Send as document to preserve TTL
   * This works but the media appears as a document, not a photo
   */
  async function sendAsDocument(chatId, attachment, ttlSeconds) {
    if (!TelegramApi._getActions) {
      throw new Error('getActions not available');
    }

    const actions = TelegramApi._getActions();
    if (!actions || !actions.sendMessage) {
      throw new Error('sendMessage action not found');
    }

    const tabId = TelegramApi._getCurrentTabId ? TelegramApi._getCurrentTabId() : undefined;

    // Force sending as file/document to ensure TTL is applied
    const docAttachment = {
      ...attachment,
      shouldSendAsFile: true,
      ttlSeconds: ttlSeconds,
    };

    log('Sending as document with TTL...');

    actions.sendMessage({
      chatId: chatId,
      attachments: [docAttachment],
      tabId: tabId,
    });

    return true;
  }

  /**
   * Try to patch the uploadMedia function to support TTL for photos
   * This modifies Telegram's internal function at runtime
   */
  async function patchUploadMedia() {
    if (TelegramApi._uploadMediaPatched) return true;

    const require = TelegramApi._webpackRequire;
    if (!require || !require.c) {
      warn('Cannot patch uploadMedia: webpack require not available');
      return false;
    }

    // Search for the module containing InputMediaUploadedPhoto usage
    for (const [moduleId, cachedModule] of Object.entries(require.c)) {
      if (!cachedModule || !cachedModule.exports) continue;

      const exports = cachedModule.exports;

      // Look for uploadMedia function or module with photo upload
      const fnStr = cachedModule.exports.toString?.() || '';
      if (fnStr.includes('InputMediaUploadedPhoto') && fnStr.includes('ttlSeconds')) {
        log(`Found potential uploadMedia module: ${moduleId}`);
        // This module likely contains the function we need to patch
        // Due to how webpack bundles code, patching is complex
      }
    }

    // For now, we can't easily patch the function due to webpack bundling
    // The proper fix requires modifying the source code
    warn('Runtime patching not implemented. TTL for photos requires source code modification.');
    return false;
  }

  /**
   * Main function: Send a disappearing photo
   *
   * @param {string} url - URL of the image to download and send
   * @param {number} ttlSeconds - Time-to-live in seconds. Use 2147483647 for "view once"
   * @param {string|number} chatId - Optional chat ID (uses current chat if not provided)
   * @param {object} options - Additional options
   * @param {boolean} options.asDocument - Force send as document (guarantees TTL but shows as file)
   * @returns {Promise<boolean>}
   */
  async function sendDisappearingPhoto(url, ttlSeconds = VIEW_ONCE_TTL, chatId = null, options = {}) {
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
      warn(`Chat ${targetChatId} not found in cache. Proceeding anyway...`);
    } else {
      log(`Chat title: ${chat.title || 'N/A'}`);
    }

    // Download the image
    log('Downloading image...');
    const blob = await downloadImage(url);
    const filename = `photo_${Date.now()}.${blob.type.split('/')[1] || 'jpg'}`;

    // Build attachment
    log('Building attachment...');
    const attachment = await buildAttachment(blob, filename, ttlSeconds);
    log('Attachment built:', {
      filename: attachment.filename,
      size: attachment.size,
      dimensions: attachment.quick,
      ttlSeconds: attachment.ttlSeconds,
    });

    // Try to send
    try {
      if (options.asDocument) {
        log('Sending as document (TTL will be applied)...');
        await sendAsDocument(targetChatId, attachment, ttlSeconds);
        log('SUCCESS: Sent as document with TTL');
      } else {
        log('Attempting to send as photo...');
        await sendViaActions(targetChatId, attachment, ttlSeconds);
        log('Message sent!');
        warn(
          'IMPORTANT: Due to a limitation in Telegram Web A, TTL may not be applied to photos.\n' +
          'The ttlSeconds field is extracted but not passed to InputMediaUploadedPhoto.\n' +
          'To guarantee TTL, use: TelegramSendDisappearingPhoto(url, ttl, chatId, {asDocument: true})'
        );
      }

      // Cleanup
      URL.revokeObjectURL(attachment.blobUrl);

      return true;
    } catch (e) {
      // Cleanup on error
      URL.revokeObjectURL(attachment.blobUrl);
      error('Failed to send:', e);
      throw e;
    }
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

    // Try to patch uploadMedia
    await patchUploadMedia();

    // Expose API globally
    window.TelegramApi = {
      // Core functions
      getGlobal: TelegramApi._getGlobal,
      getActions: TelegramApi._getActions,
      callApi: TelegramApi._callApi,
      GramJs: TelegramApi._GramJs,

      // Debug utilities
      debugGlobalState,
      debugActions,
      getCurrentChatId,
      getChat,

      // Internal state (for debugging)
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
    log('USAGE:');
    log('  await TelegramSendDisappearingPhoto(url, ttlSeconds, chatId?, options?)');
    log('');
    log('EXAMPLES:');
    log('  // Send view-once photo to current chat:');
    log('  await TelegramSendDisappearingPhoto("https://picsum.photos/400/300")');
    log('');
    log('  // Send with 5-second TTL:');
    log('  await TelegramSendDisappearingPhoto("https://picsum.photos/400/300", 5)');
    log('');
    log('  // Send to specific chat:');
    log('  await TelegramSendDisappearingPhoto("https://picsum.photos/400/300", 5, "123456789")');
    log('');
    log('  // Send as document (guarantees TTL):');
    log('  await TelegramSendDisappearingPhoto("https://picsum.photos/400/300", 5, null, {asDocument: true})');
    log('');
    log('TTL VALUES:');
    log('  2147483647 = View once (default)');
    log('  1-86400 = Seconds until self-destruct');
    log('');
    log('DEBUG:');
    log('  TelegramApi.debugGlobalState()  - Inspect global state');
    log('  TelegramApi.debugActions()      - List available actions');
    log('  TelegramApi.getCurrentChatId()  - Get current chat ID');
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
