// This script runs in the page context and has access to Telegram's internal APIs
(function() {
  console.log('[Telegram Disappearing Photos] Initializing...');

  let cachedGetGlobal = null;
  let cachedGetActions = null;

  // Find webpack require function
  function findWebpackRequire() {
    // Check common webpack global names
    if (window.webpackChunkTelegram) {
      return window.webpackChunkTelegram.push([[], {}, (r) => r]);
    }

    // Try to find in global scope
    for (const key in window) {
      if (key.startsWith('webpackChunk')) {
        const chunk = window[key];
        if (Array.isArray(chunk) && chunk.push) {
          try {
            const require = chunk.push([[], {}, (r) => r]);
            if (require && typeof require === 'function') {
              return require;
            }
          } catch (e) {}
        }
      }
    }

    // Alternative: Hook into chunk loading
    Object.keys(window).forEach(key => {
      if (Array.isArray(window[key])) {
        const arr = window[key];
        const originalPush = arr.push;
        arr.push = function(...args) {
          if (args[0] && args[0][1] && typeof args[0][1] === 'object') {
            // This might be a webpack chunk
            const testModule = Object.values(args[0][1])[0];
            if (typeof testModule === 'function') {
              // Try to get require function
              try {
                const moduleExports = {};
                const moduleObj = { exports: moduleExports };
                const fakeRequire = (id) => ({ exports: {} });
                fakeRequire.d = () => {};
                fakeRequire.r = () => {};
                fakeRequire.n = (e) => e;

                testModule(moduleObj, moduleExports, fakeRequire);
              } catch (e) {}
            }
          }
          return originalPush.apply(this, args);
        };
      }
    });

    return null;
  }

  // Search all modules
  function searchAllModules() {
    console.log('[Telegram] Searching for modules...');

    // Try to find the main module cache
    const possibleCaches = [
      window.webpackChunkTelegram,
      ...Object.keys(window)
        .filter(k => k.includes('webpack'))
        .map(k => window[k])
    ];

    for (const cache of possibleCaches) {
      if (!cache) continue;

      // If it's an array with modules
      if (Array.isArray(cache)) {
        for (const chunk of cache) {
          if (chunk && chunk[1]) {
            const modules = chunk[1];
            searchModulesObject(modules);
            if (cachedGetGlobal && cachedGetActions) return true;
          }
        }

        // Hook into future pushes
        const originalPush = cache.push;
        if (originalPush) {
          cache.push = function(...args) {
            if (args[0] && args[0][1]) {
              searchModulesObject(args[0][1]);
            }
            return originalPush.apply(this, args);
          };
        }
      }

      // If it has a modules cache
      if (cache && cache.c) {
        searchModulesObject(cache.c);
        if (cachedGetGlobal && cachedGetActions) return true;
      }
    }

    return false;
  }

  // Search through a modules object
  function searchModulesObject(modules) {
    if (!modules || typeof modules !== 'object') return;

    for (const [id, module] of Object.entries(modules)) {
      try {
        // Check if module has exports
        let exports = null;

        if (typeof module === 'function') {
          // Try to execute module
          const moduleExports = {};
          const moduleObj = { exports: moduleExports };
          const fakeRequire = (id) => ({ exports: {} });
          fakeRequire.d = (exports, name, getter) => {
            Object.defineProperty(exports, name, { get: getter, enumerable: true });
          };
          fakeRequire.r = (exports) => {
            Object.defineProperty(exports, '__esModule', { value: true });
          };
          fakeRequire.n = (module) => {
            const getter = module && module.__esModule ? () => module.default : () => module;
            fakeRequire.d(getter, 'a', getter);
            return getter;
          };

          try {
            module(moduleObj, moduleExports, fakeRequire);
            exports = moduleObj.exports;
          } catch (e) {
            // Module might have dependencies, skip
            continue;
          }
        } else if (module && module.exports) {
          exports = module.exports;
        } else if (module && typeof module === 'object') {
          exports = module;
        }

        if (!exports) continue;

        // Check if this module has what we need
        if (typeof exports.getGlobal === 'function' && !cachedGetGlobal) {
          console.log('[Telegram] Found getGlobal in module', id);
          cachedGetGlobal = exports.getGlobal;
        }

        if (typeof exports.getActions === 'function' && !cachedGetActions) {
          console.log('[Telegram] Found getActions in module', id);
          cachedGetActions = exports.getActions;
        }

        // Also check nested properties
        for (const key in exports) {
          const value = exports[key];
          if (typeof value === 'function') {
            const funcStr = value.toString();

            // Look for getGlobal-like function
            if (!cachedGetGlobal && funcStr.includes('currentTabId') && funcStr.includes('byTabId') && funcStr.length < 200) {
              console.log('[Telegram] Found getGlobal-like function in', id, key);
              cachedGetGlobal = value;
            }
          }
        }

        if (cachedGetGlobal && cachedGetActions) break;
      } catch (e) {
        // Skip problematic modules
      }
    }
  }

  // Alternative: Search DOM for React internal state
  function searchReactInternals() {
    console.log('[Telegram] Searching React internals...');

    const root = document.getElementById('root');
    if (!root) return false;

    // Try to find React internals
    const reactKeys = Object.keys(root).filter(k => k.startsWith('__react'));

    for (const key of reactKeys) {
      try {
        let node = root[key];
        let depth = 0;
        const maxDepth = 20;

        while (node && depth < maxDepth) {
          // Check stateNode
          if (node.stateNode) {
            const props = node.stateNode.props;
            if (props) {
              if (typeof props.getGlobal === 'function') cachedGetGlobal = props.getGlobal;
              if (typeof props.getActions === 'function') cachedGetActions = props.getActions;
            }
          }

          // Check memoizedProps
          if (node.memoizedProps) {
            if (typeof node.memoizedProps.getGlobal === 'function') cachedGetGlobal = node.memoizedProps.getGlobal;
            if (typeof node.memoizedProps.getActions === 'function') cachedGetActions = node.memoizedProps.getActions;
          }

          if (cachedGetGlobal && cachedGetActions) return true;

          // Traverse fiber tree
          node = node.child || node.sibling || node.return;
          depth++;
        }
      } catch (e) {}
    }

    return false;
  }

  // Direct memory scan approach
  function directMemoryScan() {
    console.log('[Telegram] Attempting direct memory scan...');

    // Look through all global functions and objects
    const scanned = new Set();
    const toScan = [window];

    while (toScan.length > 0) {
      const obj = toScan.shift();
      if (!obj || scanned.has(obj) || scanned.size > 1000) continue;
      scanned.add(obj);

      try {
        if (typeof obj === 'function') {
          const str = obj.toString();

          // Check if it's getGlobal
          if (!cachedGetGlobal &&
              str.includes('return') &&
              str.includes('global') &&
              str.length < 100 &&
              !str.includes('console')) {
            try {
              const result = obj();
              if (result && typeof result === 'object' && result.byTabId) {
                console.log('[Telegram] Found getGlobal via memory scan');
                cachedGetGlobal = obj;
              }
            } catch (e) {}
          }
        } else if (obj && typeof obj === 'object') {
          for (const key in obj) {
            try {
              const value = obj[key];

              if (key === 'getGlobal' && typeof value === 'function' && !cachedGetGlobal) {
                cachedGetGlobal = value;
                console.log('[Telegram] Found getGlobal in object property');
              }

              if (key === 'getActions' && typeof value === 'function' && !cachedGetActions) {
                cachedGetActions = value;
                console.log('[Telegram] Found getActions in object property');
              }

              if (typeof value === 'object' || typeof value === 'function') {
                toScan.push(value);
              }
            } catch (e) {}
          }
        }
      } catch (e) {}

      if (cachedGetGlobal && cachedGetActions) break;
    }

    return cachedGetGlobal && cachedGetActions;
  }

  // Initialize and try all methods
  function init() {
    let attempts = 0;
    const maxAttempts = 30;

    const tryFind = setInterval(() => {
      attempts++;

      if (!cachedGetGlobal || !cachedGetActions) {
        // First, check if functions are exposed on window (most reliable)
        if (typeof window.telegramGetGlobal === 'function') {
          console.log('[Telegram] Found telegramGetGlobal on window');
          cachedGetGlobal = window.telegramGetGlobal;
        }

        if (typeof window.telegramGetActions === 'function') {
          console.log('[Telegram] Found telegramGetActions on window');
          cachedGetActions = window.telegramGetActions;
        }

        // Try other methods as fallback
        if (!cachedGetGlobal || !cachedGetActions) {
          searchAllModules();
        }

        if (!cachedGetGlobal || !cachedGetActions) {
          searchReactInternals();
        }

        if (!cachedGetGlobal || !cachedGetActions) {
          directMemoryScan();
        }
      }

      if ((cachedGetGlobal && cachedGetActions) || attempts >= maxAttempts) {
        clearInterval(tryFind);

        if (cachedGetGlobal && cachedGetActions) {
          console.log('[Telegram] ✓ Successfully found internal APIs!');
          setupAPI();
        } else {
          console.warn('[Telegram] Could not find internal APIs after', attempts, 'attempts');
          console.warn('[Telegram] Please try refreshing the page and make sure you built Telegram with the exposed APIs');
          setupFallbackAPI();
        }
      }
    }, 500);
  }

  // Setup main API when we have access to internals
  function setupAPI() {
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
        if (!global) {
          throw new Error('Could not get global state');
        }

        const actions = cachedGetActions();
        if (!actions) {
          throw new Error('Could not get actions');
        }

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
        console.log('[Telegram] TTL:', ttlSeconds === null ? 'view once' : `${ttlSeconds} seconds`);

        return { success: true, ttl: ttlSeconds };
      } catch (error) {
        console.error('[Telegram] Error:', error);
        throw error;
      }
    };

    printHelp();
  }

  // Fallback API
  function setupFallbackAPI() {
    window.sendDisappearingPhoto = async function() {
      throw new Error('Could not access Telegram internal APIs. Try refreshing the page.');
    };

    console.log('[Telegram] Extension loaded but API access failed.');
  }

  // Helper functions
  window.sendDisappearingPhotoFromUrl = async function(imageUrl, ttlSeconds = null) {
    try {
      console.log('[Telegram] Fetching image from:', imageUrl);
      const response = await fetch(imageUrl);

      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.statusText}`);
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
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 2000));
  } else {
    setTimeout(init, 2000);
  }
})();
