// Chrome Extension for sending disappearing photos on Telegram Web A
// Hooks into Telegram's internal action system
(function() {
  console.log('[Telegram Disappearing Photos] Loading...');

  let foundActions = null;
  let foundGetGlobal = null;

  // Comprehensive search for getActions and getGlobal
  function deepSearch() {
    console.log('[Telegram] Starting comprehensive search...');

    // Method 1: Search all functions in window for getActions/getGlobal
    function searchObject(obj, path = 'window', visited = new WeakSet(), depth = 0) {
      if (depth > 5 || !obj || visited.has(obj)) return;
      if (typeof obj !== 'object' && typeof obj !== 'function') return;

      visited.add(obj);

      try {
        // Check if this object has the methods
        if (typeof obj.sendMessage === 'function' && !foundActions) {
          const str = obj.sendMessage.toString();
          if (str.includes('attachment') || str.includes('chat')) {
            console.log('[Telegram] Found actions object at:', path);
            foundActions = obj;
            return;
          }
        }

        // Check for getGlobal
        if (typeof obj === 'function') {
          const str = obj.toString();
          if (!foundGetGlobal &&
              str.length < 200 &&
              str.includes('return') &&
              (str.includes('global') || str.includes('state')) &&
              !str.includes('console')) {
            try {
              const result = obj();
              if (result && typeof result === 'object' && result.chats) {
                console.log('[Telegram] Found getGlobal at:', path);
                foundGetGlobal = obj;
              }
            } catch (e) {}
          }
        }

        // Recursively search properties
        const props = Object.getOwnPropertyNames(obj);
        for (const prop of props) {
          if (prop === 'caller' || prop === 'callee' || prop === 'arguments') continue;

          try {
            const value = obj[prop];

            if (prop === 'getActions' && typeof value === 'function') {
              try {
                const actions = value();
                if (actions && typeof actions.sendMessage === 'function') {
                  console.log('[Telegram] Found getActions at:', path + '.' + prop);
                  foundActions = actions;
                  return;
                }
              } catch (e) {}
            }

            if (prop === 'getGlobal' && typeof value === 'function' && !foundGetGlobal) {
              try {
                const global = value();
                if (global && typeof global === 'object' && global.chats) {
                  console.log('[Telegram] Found getGlobal at:', path + '.' + prop);
                  foundGetGlobal = value;
                }
              } catch (e) {}
            }

            if ((typeof value === 'object' || typeof value === 'function') && depth < 5) {
              searchObject(value, path + '.' + prop, visited, depth + 1);
            }
          } catch (e) {}
        }
      } catch (e) {}
    }

    // Search window
    searchObject(window);

    // Method 2: Search React fiber
    const root = document.getElementById('root');
    if (root && !foundActions) {
      const reactKeys = Object.keys(root).filter(k => k.startsWith('__react'));
      for (const key of reactKeys) {
        try {
          let node = root[key];
          let depth = 0;
          while (node && depth < 100 && !foundActions) {
            if (node.memoizedProps) {
              searchObject(node.memoizedProps, 'react.fiber.memoizedProps');
            }
            if (node.stateNode && node.stateNode.props) {
              searchObject(node.stateNode.props, 'react.fiber.stateNode.props');
            }
            node = node.child || node.sibling || node.return;
            depth++;
          }
        } catch (e) {}
      }
    }

    return foundActions && foundGetGlobal;
  }

  // Initialize
  let attempts = 0;
  const maxAttempts = 20;

  const searchInterval = setInterval(() => {
    attempts++;

    if (!foundActions || !foundGetGlobal) {
      deepSearch();
    }

    if ((foundActions && foundGetGlobal) || attempts >= maxAttempts) {
      clearInterval(searchInterval);

      if (foundActions && foundGetGlobal) {
        console.log('[Telegram] ✓ Successfully hooked into Telegram APIs!');
        setupAPI();
      } else {
        console.warn('[Telegram] Could not find APIs after', attempts, 'attempts');
        console.warn('[Telegram] Actions found:', !!foundActions);
        console.warn('[Telegram] GetGlobal found:', !!foundGetGlobal);
        setupFallbackAPI();
      }
    }
  }, 500);

  // Setup main API
  function setupAPI() {
    window.sendDisappearingPhoto = async function(imageFile, ttlSeconds = null) {
      try {
        console.log('[Telegram] Sending disappearing photo...');
        console.log('[Telegram] TTL:', ttlSeconds === null ? 'view once' : ttlSeconds + 's');

        if (!imageFile || !(imageFile instanceof File || imageFile instanceof Blob)) {
          throw new Error('Parameter must be a File or Blob');
        }

        const file = imageFile instanceof File ? imageFile :
                     new File([imageFile], 'photo.jpg', { type: imageFile.type || 'image/jpeg' });

        if (!file.type.startsWith('image/')) {
          throw new Error('File must be an image');
        }

        const global = foundGetGlobal();
        if (!global || !global.chats) {
          throw new Error('Could not get global state');
        }

        // Find current chat
        const tabState = global.byTabId?.[global.currentTabId] || global;
        const currentChatId = tabState.currentChatId;

        if (!currentChatId) {
          throw new Error('No chat is open. Please open a chat first.');
        }

        const chat = global.chats.byId[currentChatId];
        if (!chat) {
          throw new Error('Could not find chat.');
        }

        // Create attachment with TTL
        const blobUrl = URL.createObjectURL(file);
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

        // Call sendMessage action
        foundActions.sendMessage({
          chat: chat,
          attachment: attachment,
          tabId: global.currentTabId || 0
        });

        console.log('[Telegram] ✓ Disappearing photo sent!');
        console.log('[Telegram] TTL:', ttlSeconds === null ? 'view once' : ttlSeconds + ' seconds');

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
      throw new Error('Extension could not hook into Telegram APIs. Try refreshing the page.');
    };

    window.sendDisappearingPhotoFromUrl = async function() {
      throw new Error('Extension could not hook into Telegram APIs. Try refreshing the page.');
    };

    window.sendDisappearingPhotoFromInput = async function() {
      throw new Error('Extension could not hook into Telegram APIs. Try refreshing the page.');
    };

    console.log('[Telegram] Extension loaded but API access failed.');
    console.log('[Telegram] Try refreshing Telegram Web A and waiting a bit longer.');
  }

  // Helper functions
  window.sendDisappearingPhotoFromUrl = async function(url, ttlSeconds = null) {
    try {
      console.log('[Telegram] Fetching:', url);
      const res = await fetch(url);
      if (!res.ok) throw new Error('Fetch failed: ' + res.statusText);

      const blob = await res.blob();
      const name = url.split('/').pop().split('?')[0] || 'photo.jpg';
      const file = new File([blob], name, { type: blob.type || 'image/jpeg' });

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
          if (!file) return reject(new Error('No file selected'));
          resolve(await window.sendDisappearingPhoto(file, ttlSeconds));
        } catch (error) {
          reject(error);
        }
      };

      input.click();
    });
  };

  function printHelp() {
    console.log('%c╔════════════════════════════════════════════════════════════╗', 'color: #0088cc');
    console.log('%c║  Telegram Disappearing Photos Extension                   ║', 'color: #0088cc; font-weight: bold');
    console.log('%c╚════════════════════════════════════════════════════════════╝', 'color: #0088cc');
    console.log('');
    console.log('%c✓ Extension ready!', 'color: #00cc88; font-weight: bold');
    console.log('');
    console.log('%cFunctions:', 'font-weight: bold');
    console.log('');
    console.log('%c1. sendDisappearingPhoto(file, ttlSeconds)', 'color: #00cc88');
    console.log('   ttlSeconds: null (view once) or number (seconds)');
    console.log('   %cExample: sendDisappearingPhoto(myFile, null)', 'color: #888');
    console.log('');
    console.log('%c2. sendDisappearingPhotoFromUrl(url, ttlSeconds)', 'color: #00cc88');
    console.log('   %cExample: sendDisappearingPhotoFromUrl("https://picsum.photos/200", 5)', 'color: #888');
    console.log('');
    console.log('%c3. sendDisappearingPhotoFromInput(ttlSeconds)', 'color: #00cc88');
    console.log('   %cExample: sendDisappearingPhotoFromInput(10)', 'color: #888');
    console.log('');
    console.log('%c⚠️  Open a chat before sending!', 'color: #ff8800; font-weight: bold');
  }
})();
