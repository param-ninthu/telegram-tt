// This script runs in the page context and has access to Telegram's internal APIs
(function() {
  console.log('[Telegram Disappearing Photos] Injecting...');

  let cachedGetGlobal = null;
  let cachedGetActions = null;

  // Function to search webpack modules
  function findWebpackModules() {
    // Try multiple webpack chunk loaders
    const possibleChunks = [
      window.webpackChunkTelegram,
      window.webpackChunk,
      window.webpackJsonp
    ];

    for (const chunks of possibleChunks) {
      if (!chunks) continue;

      // Iterate through all loaded chunks
      if (Array.isArray(chunks)) {
        for (const chunk of chunks) {
          if (chunk && chunk[1]) {
            const modules = chunk[1];
            searchModules(modules);
            if (cachedGetGlobal && cachedGetActions) return true;
          }
        }
      }

      // Hook into future chunk loads
      if (chunks.push) {
        const originalPush = chunks.push;
        chunks.push = function(chunk) {
          if (chunk && chunk[1]) {
            searchModules(chunk[1]);
          }
          return originalPush.call(this, chunk);
        };
        chunks.push.bind(chunks);
      }
    }

    return false;
  }

  // Search through modules for getGlobal and getActions
  function searchModules(modules) {
    for (const [id, module] of Object.entries(modules)) {
      if (typeof module !== 'function') continue;

      try {
        const moduleStr = module.toString();

        // Check if this module exports what we need
        if (moduleStr.includes('getGlobal') && moduleStr.includes('getActions')) {
          // Try to execute the module
          const moduleExports = {};
          const require = (id) => ({ exports: {} });
          try {
            module(moduleExports, require, { d: () => {}, r: () => {}, n: (e) => e });
            if (typeof moduleExports.getGlobal === 'function') {
              cachedGetGlobal = moduleExports.getGlobal;
            }
            if (typeof moduleExports.getActions === 'function') {
              cachedGetActions = moduleExports.getActions;
            }
          } catch (e) {
            // Module execution failed, try alternative extraction
          }
        }
      } catch (e) {
        // Skip modules that throw errors
      }
    }
  }

  // Alternative: Search in window for exposed functions
  function searchWindow() {
    const searchKeys = (obj, depth = 0) => {
      if (depth > 3 || !obj || typeof obj !== 'object') return;

      for (const key in obj) {
        try {
          const value = obj[key];
          if (typeof value === 'function') {
            const funcStr = value.toString();
            if (funcStr.includes('currentTabId') && funcStr.includes('byTabId')) {
              cachedGetGlobal = value;
            }
            if (funcStr.includes('sendMessage') && !funcStr.includes('addEventListener')) {
              cachedGetActions = value;
            }
          } else if (typeof value === 'object') {
            searchKeys(value, depth + 1);
          }
        } catch (e) {
          // Skip inaccessible properties
        }
      }
    };

    searchKeys(window);
  }

  // Wait for app to load and try to find modules
  function init() {
    let attempts = 0;
    const maxAttempts = 50;

    const tryFind = setInterval(() => {
      attempts++;

      if (!cachedGetGlobal || !cachedGetActions) {
        findWebpackModules();
        if (!cachedGetGlobal || !cachedGetActions) {
          searchWindow();
        }
      }

      if ((cachedGetGlobal && cachedGetActions) || attempts >= maxAttempts) {
        clearInterval(tryFind);

        if (cachedGetGlobal && cachedGetActions) {
          setupAPI();
        } else {
          setupFallbackAPI();
        }
      }
    }, 200);
  }

  // Setup main API when we have access to internals
  function setupAPI() {
    console.log('[Telegram] Successfully hooked into internal APIs!');

    window.sendDisappearingPhoto = async function(imageFile, ttlSeconds = null) {
      try {
        console.log('[Telegram] Sending disappearing photo...');

        if (!imageFile || !(imageFile instanceof File || imageFile instanceof Blob)) {
          throw new Error('First parameter must be a File or Blob object');
        }

        const file = imageFile instanceof Blob && !(imageFile instanceof File)
          ? new File([imageFile], 'photo.jpg', { type: imageFile.type || 'image/jpeg' })
          : imageFile;

        if (!file.type.startsWith('image/')) {
          throw new Error('File must be an image');
        }

        const global = cachedGetGlobal();
        const actions = cachedGetActions();

        const tabState = global.byTabId?.[global.currentTabId] || global;
        const currentChatId = tabState.currentChatId;

        if (!currentChatId) {
          throw new Error('No chat is currently open. Please open a chat first.');
        }

        const chat = global.chats?.byId?.[currentChatId];
        if (!chat) {
          throw new Error('Could not find chat information.');
        }

        // Create blob URL
        const blobUrl = URL.createObjectURL(file);

        // Create attachment with TTL
        const attachment = {
          blob: file,
          blobUrl: blobUrl,
          filename: file.name || 'photo.jpg',
          mimeType: file.type,
          size: file.size,
          quick: {
            width: 0,
            height: 0
          },
          ttlSeconds: ttlSeconds
        };

        // Send message
        actions.sendMessage({
          chat: chat,
          attachment: attachment,
          tabId: global.currentTabId || 0
        });

        console.log('[Telegram] ✓ Disappearing photo sent!');
        console.log('[Telegram] TTL:', ttlSeconds === null ? 'view once' : \`\${ttlSeconds} seconds\`);

        return { success: true, ttl: ttlSeconds };
      } catch (error) {
        console.error('[Telegram] Error:', error);
        throw error;
      }
    };

    printHelp();
  }

  // Fallback API when we can't access internals
  function setupFallbackAPI() {
    console.warn('[Telegram] Could not hook into internal APIs. Using fallback method.');

    window.sendDisappearingPhoto = async function(imageFile, ttlSeconds = null) {
      console.error('[Telegram] Fallback method not fully implemented.');
      console.error('[Telegram] Please ensure Telegram Web A is fully loaded and try again.');
      throw new Error('Could not access Telegram internal APIs');
    };

    console.log('[Telegram] Extension loaded but API access failed.');
    console.log('[Telegram] Try refreshing the page and waiting for Telegram to fully load.');
  }

  // Helper functions
  window.sendDisappearingPhotoFromUrl = async function(imageUrl, ttlSeconds = null) {
    try {
      console.log('[Telegram] Fetching image from:', imageUrl);
      const response = await fetch(imageUrl);

      if (!response.ok) {
        throw new Error(\`Failed to fetch image: \${response.statusText}\`);
      }

      const blob = await response.blob();
      const filename = imageUrl.split('/').pop().split('?')[0] || 'photo.jpg';
      const file = new File([blob], filename, { type: blob.type || 'image/jpeg' });

      return await window.sendDisappearingPhoto(file, ttlSeconds);
    } catch (error) {
      console.error('[Telegram] Error:', error);
      throw error;
    }
  };

  window.sendDisappearingPhotoFromInput = async function(ttlSeconds = null) {
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
          const result = await window.sendDisappearingPhoto(file, ttlSeconds);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      };

      input.click();
    });
  };

  function printHelp() {
    console.log('%c[Telegram Disappearing Photos Extension]', 'color: #0088cc; font-weight: bold; font-size: 14px;');
    console.log('%c✓ Extension loaded successfully!', 'color: #00cc88; font-weight: bold;');
    console.log('');
    console.log('%cAvailable functions:', 'font-weight: bold;');
    console.log('');
    console.log('%c1. sendDisappearingPhoto(file, ttlSeconds)', 'color: #00cc88; font-weight: bold;');
    console.log('   Send a disappearing photo from a File/Blob object');
    console.log('   • file: File or Blob object (required)');
    console.log('   • ttlSeconds: null for view-once, or number for timed (optional)');
    console.log('   Examples:');
    console.log('     sendDisappearingPhoto(myFile, null)  // view once');
    console.log('     sendDisappearingPhoto(myFile, 10)    // 10 seconds');
    console.log('');
    console.log('%c2. sendDisappearingPhotoFromUrl(url, ttlSeconds)', 'color: #00cc88; font-weight: bold;');
    console.log('   Send from an image URL');
    console.log('   Example:');
    console.log('     sendDisappearingPhotoFromUrl("https://example.com/photo.jpg", null)');
    console.log('');
    console.log('%c3. sendDisappearingPhotoFromInput(ttlSeconds)', 'color: #00cc88; font-weight: bold;');
    console.log('   Opens file picker');
    console.log('   Example:');
    console.log('     sendDisappearingPhotoFromInput(null)');
    console.log('');
    console.log('%c⚠️  Make sure a chat is open before sending!', 'color: #ff8800; font-weight: bold;');
  }

  // Start initialization when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // Wait a bit for Telegram to initialize
    setTimeout(init, 2000);
  }
})();
