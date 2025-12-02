// Chrome Extension for sending disappearing photos on Telegram Web A
(function() {
  console.log('[Telegram Disappearing Photos] Loading...');

  let pendingTtl = null;

  // Hook into File constructor to track files we create
  const fileToTtlMap = new WeakMap();

  // Proxy approach: Intercept all object creations to find attachment objects
  const originalDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, '__defineGetter__');

  // Hook into property assignments
  const attachmentProxyHandler = {
    set(target, prop, value) {
      // If someone is setting a blob property, check if we have TTL for it
      if (prop === 'blob' && value instanceof Blob) {
        const ttl = fileToTtlMap.get(value);
        if (ttl !== undefined) {
          console.log('[Telegram] Found blob with TTL, will inject');
          // Set TTL on the target object
          target.ttlSeconds = ttl;
        }
      }

      target[prop] = value;
      return true;
    }
  };

  // Override Object creation to wrap potential attachment objects
  const originalCreate = Object.create;
  Object.create = function(proto, props) {
    const obj = originalCreate.call(this, proto, props);

    // If this looks like it might be an attachment object
    if (props && ('blob' in props || 'blobUrl' in props)) {
      console.log('[Telegram] Detected potential attachment object creation');
      return new Proxy(obj, attachmentProxyHandler);
    }

    return obj;
  };

  // Main sending function
  window.sendDisappearingPhoto = async function(imageFile, ttlSeconds = null) {
    try {
      console.log('[Telegram] Preparing disappearing photo...');
      console.log('[Telegram] TTL:', ttlSeconds === null ? 'view once' : ttlSeconds + 's');

      if (!imageFile || !(imageFile instanceof File || imageFile instanceof Blob)) {
        throw new Error('Parameter must be a File or Blob');
      }

      const file = imageFile instanceof File ? imageFile :
                   new File([imageFile], 'photo.jpg', { type: imageFile.type || 'image/jpeg' });

      if (!file.type.startsWith('image/')) {
        throw new Error('File must be an image');
      }

      // Store TTL association
      fileToTtlMap.set(file, ttlSeconds);
      pendingTtl = ttlSeconds;

      // Find Telegram's file input
      let input = null;

      // First try to find existing input
      let inputs = document.querySelectorAll('input[type="file"]');
      console.log('[Telegram] Found', inputs.length, 'file inputs');

      for (const inp of inputs) {
        const accept = inp.accept || '';
        if (!accept || accept.includes('image') || accept.includes('*') || accept.includes('/')) {
          input = inp;
          console.log('[Telegram] Using existing file input');
          break;
        }
      }

      // If no input found, try to trigger attach menu
      if (!input) {
        console.log('[Telegram] No file input found, looking for attach button...');

        // Look for attach button - try multiple selectors
        const selectors = [
          '[class*="Attach"]',
          '[class*="attach"]',
          'button[aria-label*="ttach"]',
          'button[title*="ttach"]',
          '[class*="AttachMenu"]',
          'button[class*="symbol-attach"]'
        ];

        let foundButton = false;
        for (const selector of selectors) {
          const buttons = document.querySelectorAll(selector);
          if (buttons.length > 0) {
            console.log('[Telegram] Found', buttons.length, 'buttons with selector:', selector);
            buttons[0].click();
            foundButton = true;
            await new Promise(r => setTimeout(r, 300));
            break;
          }
        }

        if (!foundButton) {
          // Try finding any button in the composer area
          const composer = document.querySelector('[class*="Composer"]') ||
                          document.querySelector('[class*="composer"]') ||
                          document.querySelector('[class*="MessageInput"]');

          if (composer) {
            const buttons = composer.querySelectorAll('button');
            console.log('[Telegram] Found', buttons.length, 'buttons in composer');
            // Look for attach-like button (usually has a paperclip icon or similar)
            for (const btn of buttons) {
              const classes = btn.className.toLowerCase();
              if (classes.includes('attach') || classes.includes('symbol')) {
                console.log('[Telegram] Clicking composer button');
                btn.click();
                await new Promise(r => setTimeout(r, 300));
                break;
              }
            }
          }
        }

        // Try finding input again
        inputs = document.querySelectorAll('input[type="file"]');
        console.log('[Telegram] After clicking, found', inputs.length, 'file inputs');

        for (const inp of inputs) {
          const accept = inp.accept || '';
          if (!accept || accept.includes('image') || accept.includes('*') || accept.includes('/')) {
            input = inp;
            console.log('[Telegram] Using newly created file input');
            break;
          }
        }
      }

      if (!input) {
        console.error('[Telegram] Could not find file input');
        console.error('[Telegram] Available inputs:', document.querySelectorAll('input[type="file"]'));
        throw new Error('Could not find file input. Try clicking the attach button manually first.');
      }

      // Set file on input
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;

      // Trigger change
      const event = new Event('change', { bubbles: true });
      input.dispatchEvent(event);

      console.log('[Telegram] ✓ Photo loaded! Attachment modal should open.');
      console.log('[Telegram] TTL has been set:', ttlSeconds === null ? 'view once' : ttlSeconds + ' seconds');

      // Clean up after delay
      setTimeout(() => {
        fileToTtlMap.delete(file);
        pendingTtl = null;
      }, 10000);

      return { success: true, ttl: ttlSeconds };
    } catch (error) {
      pendingTtl = null;
      console.error('[Telegram] Error:', error);
      throw error;
    }
  };

  // URL helper
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

  // File picker helper
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

  // Print instructions
  setTimeout(() => {
    console.log('%c╔════════════════════════════════════════════════════════════╗', 'color: #0088cc');
    console.log('%c║  Telegram Disappearing Photos Extension                   ║', 'color: #0088cc; font-weight: bold');
    console.log('%c╚════════════════════════════════════════════════════════════╝', 'color: #0088cc');
    console.log('');
    console.log('%c✓ Extension ready!', 'color: #00cc88; font-weight: bold');
    console.log('');
    console.log('%cFunctions:', 'font-weight: bold');
    console.log('');
    console.log('%c1. sendDisappearingPhoto(file, ttlSeconds)', 'color: #00cc88');
    console.log('   Send file/blob as disappearing photo');
    console.log('   ttlSeconds: null (view once) or number (seconds)');
    console.log('   Example: %csendDisappearingPhoto(myFile, null)', 'color: #888');
    console.log('');
    console.log('%c2. sendDisappearingPhotoFromUrl(url, ttlSeconds)', 'color: #00cc88');
    console.log('   Download and send image from URL');
    console.log('   Example: %csendDisappearingPhotoFromUrl("https://picsum.photos/200", null)', 'color: #888');
    console.log('');
    console.log('%c3. sendDisappearingPhotoFromInput(ttlSeconds)', 'color: #00cc88');
    console.log('   Open file picker');
    console.log('   Example: %csendDisappearingPhotoFromInput(10)', 'color: #888');
    console.log('');
    console.log('%c⚠️  Open a chat before sending!', 'color: #ff8800; font-weight: bold');
  }, 1000);
})();
