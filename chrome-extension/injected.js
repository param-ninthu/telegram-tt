// Chrome Extension for sending disappearing photos on Telegram Web A
// Intercepts file attachments to add TTL parameter
(function() {
  console.log('[Telegram Disappearing Photos] Loading...');

  let pendingTTL = null;
  let telegramFileInput = null;

  // Intercept Promise.all to modify attachment objects
  const originalPromiseAll = Promise.all;
  Promise.all = function(promises) {
    const result = originalPromiseAll.call(this, promises);

    // If we have pending TTL, try to modify attachment results
    if (pendingTTL !== null) {
      return result.then(values => {
        // Check if this looks like an array of ApiAttachment objects
        if (Array.isArray(values) && values.length > 0) {
          const first = values[0];
          if (first && typeof first === 'object' &&
              'blob' in first && 'blobUrl' in first && 'filename' in first) {
            console.log('[Telegram] ✓ Intercepted attachments, adding TTL:', pendingTTL);

            // Add ttlSeconds to all attachments
            const modified = values.map(att => ({
              ...att,
              ttlSeconds: pendingTTL
            }));

            // Clear pending TTL after a short delay
            setTimeout(() => { pendingTTL = null; }, 500);

            return modified;
          }
        }
        return values;
      });
    }

    return result;
  };

  // Monitor for Telegram's file input element
  function monitorFileInput() {
    const observer = new MutationObserver(() => {
      // Look for input[type="file"] that Telegram creates
      const inputs = document.querySelectorAll('input[type="file"]');
      inputs.forEach(input => {
        if (!input.__ttl_patched) {
          input.__ttl_patched = true;

          // Store reference
          if (!input.id && input.accept) {
            telegramFileInput = input;
            console.log('[Telegram] Detected Telegram file input');
          }
        }
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // Main API function
  window.sendDisappearingPhoto = async function(imageFile, ttlSeconds = null) {
    try {
      console.log('[Telegram] Preparing to send disappearing photo...');
      console.log('[Telegram] TTL:', ttlSeconds === null ? 'view once' : ttlSeconds + 's');

      if (!imageFile || !(imageFile instanceof File || imageFile instanceof Blob)) {
        throw new Error('Parameter must be a File or Blob');
      }

      const file = imageFile instanceof File ? imageFile :
                   new File([imageFile], 'photo.jpg', { type: imageFile.type || 'image/jpeg' });

      if (!file.type.startsWith('image/')) {
        throw new Error('File must be an image');
      }

      // Set the pending TTL
      pendingTTL = ttlSeconds;
      console.log('[Telegram] Set pending TTL:', pendingTTL);

      // Trigger the attach button to open file dialog
      const attachButton = document.querySelector('#attach-menu-button, [aria-label*="attach" i], button[aria-label*="attach" i]');

      if (attachButton) {
        console.log('[Telegram] Clicking attach button...');
        attachButton.click();

        // Wait for menu to appear
        await new Promise(resolve => setTimeout(resolve, 100));

        // Click photo/video option
        const photoOption = Array.from(document.querySelectorAll('.MenuItem, [role="menuitem"]'))
          .find(el => el.textContent.toLowerCase().includes('photo') ||
                      el.textContent.toLowerCase().includes('video'));

        if (photoOption) {
          console.log('[Telegram] Clicking photo option...');
          photoOption.click();

          // Wait for file input to be ready
          await new Promise(resolve => setTimeout(resolve, 50));

          // Find the file input and set our file
          const fileInput = Array.from(document.querySelectorAll('input[type="file"]'))
            .find(inp => inp.accept && inp.accept.includes('image'));

          if (fileInput) {
            console.log('[Telegram] Found file input, injecting file...');

            // Create DataTransfer with our file
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);

            // Set files and trigger change
            Object.defineProperty(fileInput, 'files', {
              value: dataTransfer.files,
              writable: false
            });

            const changeEvent = new Event('change', { bubbles: true });
            fileInput.dispatchEvent(changeEvent);

            console.log('[Telegram] ✓ File dispatched!');

            // Keep TTL active for a bit longer
            setTimeout(() => {
              if (pendingTTL !== null) {
                console.log('[Telegram] Clearing pending TTL');
                pendingTTL = null;
              }
            }, 2000);

            return { success: true, ttl: ttlSeconds };
          } else {
            throw new Error('Could not find file input');
          }
        } else {
          throw new Error('Could not find photo/video menu option');
        }
      } else {
        throw new Error('Could not find attach button. Make sure a chat is open.');
      }
    } catch (error) {
      pendingTTL = null;
      console.error('[Telegram] Error:', error);
      throw error;
    }
  };

  // Helper: Load from URL
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

  // Helper: Open file picker
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
    console.log('%cUsage:', 'font-weight: bold');
    console.log('');
    console.log('%c1. Open a chat in Telegram Web A', 'color: #888');
    console.log('%c2. Run one of these functions in the console:', 'color: #888');
    console.log('');
    console.log('%csendDisappearingPhoto(file, ttlSeconds)', 'color: #00cc88');
    console.log('   • file: File or Blob object');
    console.log('   • ttlSeconds: null (view once) or number (seconds)');
    console.log('   %cExample: sendDisappearingPhoto(myFile, null)', 'color: #888');
    console.log('');
    console.log('%csendDisappearingPhotoFromUrl(url, ttlSeconds)', 'color: #00cc88');
    console.log('   • Downloads and sends photo from URL');
    console.log('   %cExample: sendDisappearingPhotoFromUrl("https://picsum.photos/200", 5)', 'color: #888');
    console.log('');
    console.log('%csendDisappearingPhotoFromInput(ttlSeconds)', 'color: #00cc88');
    console.log('   • Opens file picker to select photo');
    console.log('   %cExample: sendDisappearingPhotoFromInput(10)', 'color: #888');
    console.log('');
    console.log('%c⚠️  Make sure a chat is open before sending!', 'color: #ff8800; font-weight: bold');
  }

  // Initialize
  monitorFileInput();
  printHelp();
})();
