// Injected script - runs in page context to access Telegram's APIs
(function() {
  'use strict';

  console.log('[Disappearing Photos] Initializing...');

  let cachedAPI = null;

  // Find Telegram's getGlobal and getActions from webpack modules
  function findTelegramAPI() {
    if (cachedAPI) return cachedAPI;

    let getGlobal, getActions;

    // Method 1: Search webpack chunks
    const webpackChunkName = Object.keys(window).find(key =>
      key.startsWith('webpackChunk')
    );

    if (webpackChunkName) {
      const chunks = window[webpackChunkName];
      const moduleCache = {};

      for (const chunk of chunks) {
        if (!chunk[1]) continue;

        for (const moduleId in chunk[1]) {
          try {
            const module = { exports: {} };
            moduleCache[moduleId] = module;

            const webpackRequire = (id) => {
              if (moduleCache[id]) return moduleCache[id].exports;
              return {};
            };

            chunk[1][moduleId](module, module.exports, webpackRequire);

            if (module.exports.getGlobal && module.exports.getActions) {
              getGlobal = module.exports.getGlobal;
              getActions = module.exports.getActions;
              break;
            }
          } catch (e) {
            // Continue
          }
        }
        if (getGlobal && getActions) break;
      }
    }

    if (getGlobal && getActions) {
      cachedAPI = { getGlobal, getActions };
      console.log('[Disappearing Photos] ✅ Found Telegram API!');
    } else {
      console.log('[Disappearing Photos] ❌ Could not find Telegram API');
    }

    return { getGlobal, getActions };
  }

  // Wait for Telegram to load
  function waitForTelegram(callback, attempts = 0) {
    if (attempts > 100) {
      console.error('[Disappearing Photos] Timeout waiting for Telegram');
      return;
    }

    const api = findTelegramAPI();
    if (api.getGlobal && api.getActions) {
      callback(api);
    } else {
      setTimeout(() => waitForTelegram(callback, attempts + 1), 200);
    }
  }

  // Main API
  waitForTelegram(({ getGlobal, getActions }) => {
    window.TelegramDisappearing = {
      /**
       * Send a photo with disappearing timer
       * @param {File} imageFile - The image file to send
       * @param {number} ttlSeconds - Time to live in seconds (default: 10)
       */
      send: async function(imageFile, ttlSeconds = 10) {
        try {
          const global = getGlobal();
          const actions = getActions();

          // Get current chat from tab state
          const tabState = global.byTabId?.[1];
          if (!tabState) {
            throw new Error('No active tab found');
          }

          const messageLists = tabState.messageLists || [];
          if (messageLists.length === 0) {
            throw new Error('No chat is open. Please open a chat first.');
          }

          const messageList = messageLists[messageLists.length - 1];
          const { chatId, threadId, type } = messageList;

          console.log('[Send] Chat info:', { chatId, threadId, type });

          // Create blob URL
          const blob = imageFile instanceof Blob ? imageFile : new Blob([imageFile]);
          const blobUrl = URL.createObjectURL(blob);

          // Get image dimensions
          const img = new Image();
          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = blobUrl;
          });

          // Create attachment with TTL
          const attachment = {
            blob: blob,
            blobUrl: blobUrl,
            filename: imageFile.name || 'photo.jpg',
            mimeType: blob.type || 'image/jpeg',
            size: blob.size,
            quick: {
              width: img.width,
              height: img.height
            },
            ttlSeconds: ttlSeconds,  // ← This makes it disappear!
            uniqueId: `${Date.now()}_${Math.random()}`
          };

          console.log('[Send] Attachment:', attachment);

          // Call sendMessage action
          actions.sendMessage({
            attachments: [attachment],
            messageList: { chatId, threadId, type }
          });

          console.log('[Send] ✅ Photo sent with TTL:', ttlSeconds);
          return true;

        } catch (error) {
          console.error('[Send] ❌ Error:', error);
          throw error;
        }
      },

      /**
       * Send from file picker
       */
      selectAndSend: function(ttlSeconds = 10) {
        return new Promise((resolve, reject) => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/*';
          input.onchange = async (e) => {
            try {
              const file = e.target.files[0];
              if (!file) {
                reject(new Error('No file selected'));
                return;
              }
              await this.send(file, ttlSeconds);
              resolve(true);
            } catch (error) {
              reject(error);
            }
          };
          input.click();
        });
      },

      /**
       * Send from URL
       */
      sendFromUrl: async function(url, ttlSeconds = 10) {
        try {
          const response = await fetch(url);
          const blob = await response.blob();
          const filename = url.split('/').pop() || 'photo.jpg';
          const file = new File([blob], filename, { type: blob.type });
          return await this.send(file, ttlSeconds);
        } catch (error) {
          console.error('[SendFromUrl] Error:', error);
          throw error;
        }
      },

      /**
       * Get current chat info
       */
      getCurrentChat: function() {
        try {
          const global = getGlobal();
          const tabState = global.byTabId?.[1];
          if (!tabState) return null;

          const messageLists = tabState.messageLists || [];
          if (messageLists.length === 0) return null;

          return messageLists[messageLists.length - 1];
        } catch (error) {
          console.error('[GetCurrentChat] Error:', error);
          return null;
        }
      },

      /**
       * Test - send a generated image
       */
      sendTest: async function(ttlSeconds = 10) {
        const canvas = document.createElement('canvas');
        canvas.width = 800;
        canvas.height = 600;
        const ctx = canvas.getContext('2d');

        // Gradient background
        const gradient = ctx.createLinearGradient(0, 0, 800, 600);
        gradient.addColorStop(0, '#667eea');
        gradient.addColorStop(1, '#764ba2');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 800, 600);

        // Text
        ctx.fillStyle = 'white';
        ctx.font = 'bold 48px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('🔥 Disappearing Photo', 400, 280);

        ctx.font = '24px Arial';
        ctx.fillText(`TTL: ${ttlSeconds} seconds`, 400, 330);

        ctx.font = '16px Arial';
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.fillText(new Date().toLocaleString(), 400, 370);

        const blob = await new Promise(resolve => {
          canvas.toBlob(resolve, 'image/png');
        });

        const file = new File([blob], 'test-disappearing.png', { type: 'image/png' });
        return await this.send(file, ttlSeconds);
      }
    };

    console.log('%c🔥 Telegram Disappearing Photos Ready!', 'color: #0088cc; font-size: 16px; font-weight: bold;');
    console.log('%cUsage:', 'color: #0088cc; font-size: 14px;');
    console.log('%c  TelegramDisappearing.selectAndSend(10)  - Pick image file', 'color: #666; font-size: 12px;');
    console.log('%c  TelegramDisappearing.sendTest(10)       - Send test image', 'color: #666; font-size: 12px;');
    console.log('%c  TelegramDisappearing.sendFromUrl(url, 10) - From URL', 'color: #666; font-size: 12px;');
    console.log('');
    console.log('%c⚡ Open a chat, then try: TelegramDisappearing.sendTest(10)', 'color: #ff6b6b; font-size: 12px; font-weight: bold;');
  });

})();
