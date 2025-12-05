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

  /**
   * Validate that the blob is an image
   */
  function validateImageBlob(blob) {
    if (!(blob instanceof Blob)) {
      throw new Error('Input must be a Blob');
    }

    const validImageTypes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/bmp'
    ];

    if (!blob.type || !validImageTypes.includes(blob.type)) {
      throw new Error(`Invalid image type: ${blob.type || 'unknown'}. Supported: ${validImageTypes.join(', ')}`);
    }

    return true;
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

  /**
   * Convert an image blob to a video blob (single frame).
   * This is needed because the production Worker only supports ttlSeconds for videos,
   * not for photos. By converting to video, we can enable disappearing functionality.
   */
  async function convertImageToVideo(imageBlob) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(imageBlob);

      img.onload = () => {
        URL.revokeObjectURL(url);

        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);

        // Create preview image for thumbnail
        const previewDataUrl = canvas.toDataURL('image/jpeg', 0.8);

        // Create a video stream from the canvas
        const stream = canvas.captureStream(30); // 30 FPS for smoother encoding
        const mediaRecorder = new MediaRecorder(stream, {
          mimeType: 'video/webm;codecs=vp8',
          videoBitsPerSecond: 2500000, // 2.5 Mbps for good quality
        });

        const chunks = [];
        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        };

        mediaRecorder.onstop = () => {
          const videoBlob = new Blob(chunks, { type: 'video/webm' });
          log(`Converted image to video: ${videoBlob.size} bytes`);
          resolve({
            videoBlob,
            width: img.naturalWidth,
            height: img.naturalHeight,
            previewDataUrl,
          });
        };

        mediaRecorder.onerror = (e) => {
          reject(new Error('MediaRecorder error: ' + e.error));
        };

        // Record for 500ms to ensure we have valid video frames
        mediaRecorder.start();
        setTimeout(() => {
          mediaRecorder.stop();
          stream.getTracks().forEach(track => track.stop());
        }, 500);
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load image'));
      };

      img.src = url;
    });
  }

  /**
   * Convert data URL to Blob
   */
  function dataUrlToBlob(dataUrl) {
    const parts = dataUrl.split(',');
    const mime = parts[0].match(/:(.*?);/)[1];
    const bstr = atob(parts[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
  }

  /**
   * Build attachment for photo (no ttlSeconds support in production)
   */
  async function buildPhotoAttachment(blob, filename) {
    const blobUrl = URL.createObjectURL(blob);
    const dims = await getImageDimensions(blob);
    return {
      blob,
      blobUrl,
      filename,
      mimeType: blob.type || 'image/jpeg',
      size: blob.size,
      quick: { width: dims.width, height: dims.height },
      uniqueId: `photo_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    };
  }

  /**
   * Build attachment for video with ttlSeconds support.
   * Production Worker supports ttlSeconds for videos (InputMediaUploadedDocument).
   */
  async function buildVideoAttachment(videoBlob, filename, ttlSeconds, width, height, previewDataUrl) {
    const blobUrl = URL.createObjectURL(videoBlob);

    // Create preview blob URL if we have preview data
    let previewBlobUrl;
    if (previewDataUrl) {
      const previewBlob = dataUrlToBlob(previewDataUrl);
      previewBlobUrl = URL.createObjectURL(previewBlob);
    }

    return {
      blob: videoBlob,
      blobUrl,
      filename,
      mimeType: 'video/webm',
      size: videoBlob.size,
      quick: {
        width,
        height,
        duration: 1, // 1 second duration (minimal but valid)
      },
      previewBlobUrl,
      ttlSeconds,
      uniqueId: `video_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    };
  }

  /**
   * Send a disappearing photo (as a single-frame video to enable TTL support)
   *
   * NOTE: Due to production Worker limitations, photos don't support ttlSeconds.
   * This function converts the image to a minimal video to enable disappearing functionality.
   * The recipient will see it as a very short video (essentially a still frame).
   *
   * @param {Blob} imageBlob - Image blob (must be image/jpeg, image/png, image/gif, image/webp, or image/bmp)
   * @param {number} ttlSeconds - Time to live in seconds (default: 2147483647 for view-once)
   * @param {string|number|null} chatId - Chat ID (default: current open chat)
   */
  async function sendDisappearingPhoto(imageBlob, ttlSeconds = VIEW_ONCE_TTL, chatId = null) {
    log('========================================');
    log('  TelegramSendDisappearingPhoto');
    log('========================================');

    // Validate input is an image blob
    validateImageBlob(imageBlob);

    if (!TelegramApi._getActions) {
      throw new Error('getActions not found. Cannot send messages.');
    }

    const targetChatId = chatId || getCurrentChatId();
    if (!targetChatId) {
      throw new Error('No chat open. Open a chat or provide chatId.');
    }

    log(`Image: ${imageBlob.size} bytes, ${imageBlob.type}`);
    log(`TTL: ${ttlSeconds}${ttlSeconds === VIEW_ONCE_TTL ? ' (view once)' : 's'}`);
    log(`Chat: ${targetChatId}`);

    // Convert image to video for ttlSeconds support
    // (Production Worker only supports ttlSeconds for videos/documents)
    log('Converting image to video for TTL support...');
    const { videoBlob, width, height, previewDataUrl } = await convertImageToVideo(imageBlob);

    const filename = `disappearing_${Date.now()}.webm`;
    const attachment = await buildVideoAttachment(videoBlob, filename, ttlSeconds, width, height, previewDataUrl);
    log(`Built video attachment: ${JSON.stringify({ size: attachment.size, width, height, hasTtl: !!attachment.ttlSeconds })}`);

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

    // sendMessage expects messageList: { chatId, threadId, type }
    // threadId -1 = MAIN_THREAD_ID, type 'thread' = regular chat
    const MAIN_THREAD_ID = -1;

    log('Sending disappearing video (converted from image)...');
    try {
      sendFn({
        messageList: {
          chatId: String(targetChatId),
          threadId: MAIN_THREAD_ID,
          type: 'thread',
        },
        attachments: [attachment],
      });

      log('Message dispatched!');
      log('Note: Sent as a short video due to production TTL limitations for photos.');
      return true;
    } catch (e) {
      error('Failed to send:', e.message);
      URL.revokeObjectURL(attachment.blobUrl);
      return false;
    }
  }

  /**
   * Send a regular photo (without disappearing/TTL)
   * @param {Blob} imageBlob - Image blob
   * @param {string|number|null} chatId - Chat ID (default: current open chat)
   */
  async function sendPhoto(imageBlob, chatId = null) {
    log('========================================');
    log('  TelegramSendPhoto (regular)');
    log('========================================');

    validateImageBlob(imageBlob);

    if (!TelegramApi._getActions) {
      throw new Error('getActions not found. Cannot send messages.');
    }

    const targetChatId = chatId || getCurrentChatId();
    if (!targetChatId) {
      throw new Error('No chat open. Open a chat or provide chatId.');
    }

    const ext = imageBlob.type.split('/')[1] || 'jpg';
    const filename = `photo_${Date.now()}.${ext}`;
    const attachment = await buildPhotoAttachment(imageBlob, filename);

    const actions = TelegramApi._getActions();
    const sendFn = actions.sendMessage;

    if (!sendFn) {
      throw new Error('sendMessage action not found');
    }

    const MAIN_THREAD_ID = -1;

    try {
      sendFn({
        messageList: {
          chatId: String(targetChatId),
          threadId: MAIN_THREAD_ID,
          type: 'thread',
        },
        attachments: [attachment],
      });
      log('Photo sent!');
      return true;
    } catch (e) {
      error('Failed to send:', e.message);
      URL.revokeObjectURL(attachment.blobUrl);
      return false;
    }
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
    window.TelegramSendPhoto = sendPhoto;

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
    log('  // Send disappearing photo (view-once):');
    log('  const resp = await fetch("https://picsum.photos/400");');
    log('  const blob = await resp.blob();');
    log('  await TelegramSendDisappearingPhoto(blob);');
    log('');
    log('  // With custom TTL (in seconds):');
    log('  await TelegramSendDisappearingPhoto(blob, 10);');
    log('');
    log('  // Send regular photo:');
    log('  await TelegramSendPhoto(blob);');
    log('');
    log('Note: Disappearing photos are sent as short videos');
    log('      due to production Worker TTL limitations.');
    log('');

    if (!TelegramApi._getGlobal || !TelegramApi._getActions) {
      warn('Could not find required functions.');
      warn('The module IDs may have changed in this build.');
    }
  }

  initialize().catch(e => error('Init failed:', e));
})();
