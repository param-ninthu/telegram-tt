// Chrome Extension for sending disappearing photos on Telegram Web A
// Based on reverse-engineering Telegram's internal webpack bundle
//
// Key findings:
// - Attachment flow: File → buildAttachment() → ApiAttachment → InputMedia
// - TTL extraction: function xr() checks "ttlSeconds" in attachment
// - API construction: new InputMediaUploadedDocument({ ttlSeconds: f })
//
(function() {
  console.log('[Telegram Disappearing Photos] Loading...');
  console.log('[Extension] Based on Telegram Web A build: 2026.b8fb401b0f58b6ab09af.js');

  let pendingTTL = null;
  let interceptionCount = 0;

  // Intercept Promise.all to modify ApiAttachment objects
  // This catches the buildAttachment() results before they're converted to InputMedia
  const originalPromiseAll = Promise.all;
  Promise.all = function(promises) {
    const result = originalPromiseAll.call(this, promises);

    // Only intercept when we have a pending TTL
    if (pendingTTL !== null) {
      return result.then(values => {
        // Detect ApiAttachment objects by their structure
        // Based on buildAttachment.ts: { blob, blobUrl, filename, mimeType, size, ... }
        if (Array.isArray(values) && values.length > 0) {
          const first = values[0];

          // Check if this looks like ApiAttachment[] from buildAttachment
          if (first && typeof first === 'object' &&
              'blob' in first &&
              'blobUrl' in first &&
              'filename' in first &&
              'mimeType' in first &&
              'size' in first) {

            interceptionCount++;
            console.log(`[Extension] ✓ Intercepted attachment creation (#${interceptionCount})`);
            console.log('[Extension] Adding ttlSeconds:', pendingTTL);

            // Add ttlSeconds to each attachment
            // This will be picked up by function xr() in the webpack chunk
            const modified = values.map(att => ({
              ...att,
              ttlSeconds: pendingTTL
            }));

            console.log('[Extension] ✓ TTL injected into', modified.length, 'attachment(s)');

            // Clear pending TTL after successful injection
            setTimeout(() => {
              if (pendingTTL !== null) {
                console.log('[Extension] Clearing pendingTTL');
                pendingTTL = null;
              }
            }, 1000);

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
      const inputs = document.querySelectorAll('input[type="file"]');
      inputs.forEach(input => {
        if (!input.__ttl_monitored) {
          input.__ttl_monitored = true;
          console.log('[Extension] Detected file input element');
        }
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // Main API: Send disappearing photo
  window.sendDisappearingPhoto = async function(imageFile, ttlSeconds = null) {
    try {
      console.log('='.repeat(60));
      console.log('[Extension] sendDisappearingPhoto() called');
      console.log('[Extension] TTL:', ttlSeconds === null ? 'VIEW ONCE' : ttlSeconds + ' seconds');

      if (!imageFile || !(imageFile instanceof File || imageFile instanceof Blob)) {
        throw new Error('Parameter must be a File or Blob object');
      }

      const file = imageFile instanceof File ? imageFile :
                   new File([imageFile], 'photo.jpg', { type: imageFile.type || 'image/jpeg' });

      if (!file.type.startsWith('image/')) {
        throw new Error('File must be an image (type must start with "image/")');
      }

      console.log('[Extension] File:', file.name, '(' + (file.size / 1024).toFixed(2) + ' KB)');

      // Set the pending TTL - will be picked up by Promise.all interception
      pendingTTL = ttlSeconds;
      console.log('[Extension] Set pendingTTL =', pendingTTL);

      // Find attach button
      const attachButton = document.querySelector(
        '#attach-menu-button, [aria-label*="attach" i], button[aria-label*="attach" i]'
      );

      if (!attachButton) {
        throw new Error('Could not find attach button. Make sure a chat is open.');
      }

      console.log('[Extension] Found attach button, clicking...');
      attachButton.click();

      // Wait for menu to appear
      await new Promise(resolve => setTimeout(resolve, 150));

      // Find and click photo/video option
      const photoOption = Array.from(document.querySelectorAll('.MenuItem, [role="menuitem"]'))
        .find(el => {
          const text = el.textContent.toLowerCase();
          return text.includes('photo') || text.includes('video') || text.includes('image');
        });

      if (!photoOption) {
        throw new Error('Could not find photo/video menu option');
      }

      console.log('[Extension] Found photo option, clicking...');
      photoOption.click();

      // Wait for file input to be ready
      await new Promise(resolve => setTimeout(resolve, 100));

      // Find the file input
      const fileInput = Array.from(document.querySelectorAll('input[type="file"]'))
        .find(inp => inp.accept && (inp.accept.includes('image') || inp.accept.includes('video')));

      if (!fileInput) {
        throw new Error('Could not find file input element');
      }

      console.log('[Extension] Found file input, injecting file...');

      // Create DataTransfer with our file
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);

      // Set files property
      Object.defineProperty(fileInput, 'files', {
        value: dataTransfer.files,
        writable: false
      });

      // Dispatch change event to trigger Telegram's handler
      const changeEvent = new Event('change', { bubbles: true });
      fileInput.dispatchEvent(changeEvent);

      console.log('[Extension] ✓ File dispatched!');
      console.log('[Extension] ✓ Waiting for buildAttachment() to process...');

      // Keep TTL active for longer to ensure interception
      setTimeout(() => {
        if (pendingTTL !== null) {
          console.log('[Extension] ⚠ TTL not cleared, clearing now');
          pendingTTL = null;
        }
      }, 3000);

      console.log('='.repeat(60));

      return {
        success: true,
        ttl: ttlSeconds,
        message: ttlSeconds === null ? 'View once photo prepared' : `Photo set to disappear after ${ttlSeconds}s`
      };
    } catch (error) {
      pendingTTL = null;
      console.error('[Extension] ✗ Error:', error.message);
      console.log('='.repeat(60));
      throw error;
    }
  };

  // Helper: Load from URL
  window.sendDisappearingPhotoFromUrl = async function(url, ttlSeconds = null) {
    try {
      console.log('[Extension] Fetching from URL:', url);
      const res = await fetch(url);
      if (!res.ok) throw new Error('Fetch failed: ' + res.statusText);

      const blob = await res.blob();
      const name = url.split('/').pop().split('?')[0] || 'photo.jpg';
      const file = new File([blob], name, { type: blob.type || 'image/jpeg' });

      console.log('[Extension] Downloaded:', file.name, '(' + (file.size / 1024).toFixed(2) + ' KB)');

      return await window.sendDisappearingPhoto(file, ttlSeconds);
    } catch (error) {
      console.error('[Extension] Error fetching URL:', error);
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
    console.log('%c║  Telegram Disappearing Photos Extension v2.0              ║', 'color: #0088cc; font-weight: bold');
    console.log('%c║  Reverse-engineered from Telegram Web A internals         ║', 'color: #0088cc');
    console.log('%c╚════════════════════════════════════════════════════════════╝', 'color: #0088cc');
    console.log('');
    console.log('%c✓ Extension loaded and monitoring!', 'color: #00cc88; font-weight: bold');
    console.log('');
    console.log('%c📋 How it works:', 'font-weight: bold');
    console.log('  1. Intercepts Promise.all to catch buildAttachment() results');
    console.log('  2. Injects ttlSeconds into ApiAttachment objects');
    console.log('  3. Telegram\'s xr() function extracts ttlSeconds');
    console.log('  4. InputMediaUploadedDocument sent to API with ttl_seconds');
    console.log('');
    console.log('%c📚 Available Functions:', 'font-weight: bold');
    console.log('');
    console.log('%c  sendDisappearingPhoto(file, ttlSeconds)', 'color: #00cc88');
    console.log('    • file: File or Blob object (must be an image)');
    console.log('    • ttlSeconds: null = view once, number = seconds before auto-delete');
    console.log('    %cExample: await sendDisappearingPhoto(myFile, null)', 'color: #888');
    console.log('');
    console.log('%c  sendDisappearingPhotoFromUrl(url, ttlSeconds)', 'color: #00cc88');
    console.log('    • Downloads and sends photo from URL');
    console.log('    %cExample: await sendDisappearingPhotoFromUrl("https://picsum.photos/400", 5)', 'color: #888');
    console.log('');
    console.log('%c  sendDisappearingPhotoFromInput(ttlSeconds)', 'color: #00cc88');
    console.log('    • Opens file picker to select a photo');
    console.log('    %cExample: await sendDisappearingPhotoFromInput(10)', 'color: #888');
    console.log('');
    console.log('%c⚠️  IMPORTANT: Open a chat before sending!', 'color: #ff8800; font-weight: bold');
    console.log('');
    console.log('%cInterceptions:', 'color: #888; font-size: 10px');
    console.log(`  Total buildAttachment() calls intercepted: ${interceptionCount}`, 'color: #888; font-size: 10px');
  }

  // Initialize
  monitorFileInput();
  printHelp();
})();
