Telegram Disappearing Photos Extension
=======================================

A Chrome extension to programmatically send disappearing photos on Telegram Web A.

INSTALLATION
------------

1. Open Chrome and go to: chrome://extensions/
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the 'chrome-extension' folder
5. Navigate to https://web.telegram.org/a
6. Open the browser console (F12 or Ctrl+Shift+J)

USAGE
-----

The extension adds three functions to the window object:

1. sendDisappearingPhoto(file, ttlSeconds)
   Send a File or Blob object as a disappearing photo

   Parameters:
   - file: File or Blob object (must be an image)
   - ttlSeconds: null for "view once", or number of seconds before disappearing

   Example:
   sendDisappearingPhoto(myFile, null)  // View once
   sendDisappearingPhoto(myFile, 5)     // 5 seconds

2. sendDisappearingPhotoFromUrl(url, ttlSeconds)
   Download and send a photo from a URL

   Example:
   sendDisappearingPhotoFromUrl("https://picsum.photos/200", 10)

3. sendDisappearingPhotoFromInput(ttlSeconds)
   Opens a file picker to select a photo

   Example:
   sendDisappearingPhotoFromInput(null)  // View once

IMPORTANT NOTES
---------------

- A chat MUST be open before calling any function
- The extension works by intercepting Telegram's attachment system
- TTL values: null = view once, number = seconds before auto-delete
- Only works on https://web.telegram.org/a (Telegram Web A)

HOW IT WORKS
------------

The extension:
1. Injects into the page context
2. Monkey-patches Promise.all to intercept attachment creation
3. Adds the ttlSeconds parameter to attachments
4. Automates the UI flow (clicking attach button, selecting photo)
5. Injects the file into Telegram's file input

TROUBLESHOOTING
---------------

If the extension doesn't work:
- Refresh Telegram Web A
- Make sure you're on web.telegram.org/a (not web.telegram.org/k)
- Check the console for any error messages
- Ensure a chat is open before sending
