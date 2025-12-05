# Telegram Disappearing Photos Chrome Extension

A Chrome Extension that enables sending disappearing (self-destructing) photos programmatically in Telegram Web A via the DevTools console.

## Features

- Hooks into Telegram Web A's internal webpack module system
- Extracts and exposes Telegram's private API functions globally
- Provides a helper function `TelegramSendDisappearingPhoto()` for sending disappearing photos
- Works directly from the browser's DevTools console
- No external libraries or backend servers required - 100% self-contained

## Installation

1. Clone or download this extension folder
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top-right corner)
4. Click "Load unpacked"
5. Select the `chrome-extension-disappearing-photos` folder
6. The extension is now installed

## Usage

1. Go to [Telegram Web A](https://web.telegram.org/a/)
2. Log in to your Telegram account
3. Open a chat where you want to send a disappearing photo
4. Open DevTools (F12 or Ctrl+Shift+I / Cmd+Option+I)
5. Go to the Console tab
6. Use the `TelegramSendDisappearingPhoto` function:

```javascript
// First, get an image blob (from fetch, file input, canvas, etc.)
const response = await fetch("https://picsum.photos/400/300");
const imageBlob = await response.blob();

// Send a view-once photo to the current chat
await TelegramSendDisappearingPhoto(imageBlob);

// Send with 5-second TTL
await TelegramSendDisappearingPhoto(imageBlob, 5);

// Send to a specific chat by ID
await TelegramSendDisappearingPhoto(imageBlob, 5, "123456789");

// Using a file input
const file = document.querySelector('input[type="file"]').files[0];
await TelegramSendDisappearingPhoto(file, 10);
```

## API Reference

### TelegramSendDisappearingPhoto(imageBlob, ttlSeconds, chatId)

Sends a disappearing photo to a Telegram chat.

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `imageBlob` | Blob | (required) | Image blob (must be image/jpeg, image/png, image/gif, image/webp, or image/bmp) |
| `ttlSeconds` | number | `2147483647` | Time-to-live in seconds. Use `2147483647` for "view once" |
| `chatId` | string/number | `null` | Chat ID to send to. If not provided, uses the currently open chat |

**Returns:** `Promise<boolean>` - `true` if the message was sent successfully

**Supported Image Types:**
- `image/jpeg`
- `image/png`
- `image/gif`
- `image/webp`
- `image/bmp`

**TTL Values:**
- `2147483647` - View once (recipient can only view once, then it disappears)
- `1-86400` - Number of seconds until the photo self-destructs

### TelegramApi Object

The extension also exposes a `TelegramApi` object with additional utilities:

```javascript
// Get current global state (for debugging)
TelegramApi.debugGlobalState();

// List all available actions
TelegramApi.debugActions();

// Get current chat ID
TelegramApi.getCurrentChatId();

// Get chat info by ID
TelegramApi.getChat("123456789");
```

## Known Limitations

### TTL for Photos

**Important:** Due to a limitation in the current Telegram Web A codebase, the `ttlSeconds` parameter is extracted from attachments but **not passed** to `InputMediaUploadedPhoto` when uploading photos. This means photos sent via this extension may not have TTL applied on the server side.

This is a bug in the Telegram Web A source code, not in this extension. The `uploadMedia` function in `src/api/gramjs/methods/messages.ts` needs to be modified to include `ttlSeconds` in the `InputMediaUploadedPhoto` constructor.

## Debugging

If the extension isn't working:

1. **Check initialization:** Look for `[TelegramDisappearingPhotos]` messages in the console
2. **Verify modules found:** The console should show which Telegram modules were discovered
3. **Refresh and wait:** Sometimes Telegram needs more time to fully initialize. Try refreshing and waiting a few seconds before using the function
4. **Check for errors:** Look for any error messages in the console

### Common Issues

**"getActions not available"**
- Telegram hasn't fully initialized yet
- Try refreshing the page and waiting longer

**"No chat specified and no active chat found"**
- Open a chat in Telegram Web A before running the command
- Or provide the chat ID as the third parameter

**CORS errors when downloading images**
- The image URL must allow cross-origin requests
- Try using a different image source

## Technical Details

### How It Works

1. **Content Script** (`content.js`): Injected at document_start, creates a script element pointing to `injected.js`

2. **Injected Script** (`injected.js`): Runs in the page's main world with access to:
   - Telegram's webpack chunk array
   - All loaded webpack modules
   - The global state and actions

3. **Webpack Hooking**: The script:
   - Finds the `webpackChunk*` array
   - Intercepts the `push` method to capture the webpack require function
   - Searches through all modules to find `getGlobal`, `getActions`, `callApi`, etc.

4. **API Exposure**: Once modules are found, they're exposed under `window.TelegramApi`

5. **Helper Function**: `TelegramSendDisappearingPhoto` uses the exposed APIs to:
   - Download the image from the provided URL
   - Convert it to a Blob
   - Build an attachment object with TTL
   - Call `sendMessage` action to send the photo

## File Structure

```
chrome-extension-disappearing-photos/
  manifest.json    - Extension manifest (Manifest V3)
  content.js       - Content script that injects injected.js
  injected.js      - Main script that hooks into Telegram
  README.md        - This documentation
```

## Compatibility

- **Chrome**: Tested on Chrome 90+
- **Edge**: Should work (Chromium-based)
- **Firefox**: Not tested (may require manifest modifications)
- **Telegram Web**: Only works with Telegram Web A (https://web.telegram.org/a/)

## Security Notes

- This extension only works on `web.telegram.org/a/*`
- No data is sent to external servers
- All operations happen locally in your browser
- The extension requires no special permissions beyond host access

## License

MIT License - Feel free to modify and distribute.

## Contributing

If you want to fix the TTL issue for photos properly, the fix needs to be made in the Telegram Web A source code:

**File:** `src/api/gramjs/methods/messages.ts`

**Change:** In the `uploadMedia` function, add `ttlSeconds` to the `InputMediaUploadedPhoto` constructor:

```typescript
// Current (broken):
return new GramJs.InputMediaUploadedPhoto({
  file: inputFile,
  spoiler: shouldSendAsSpoiler,
});

// Fixed:
return new GramJs.InputMediaUploadedPhoto({
  file: inputFile,
  spoiler: shouldSendAsSpoiler,
  ttlSeconds,  // Add this line
});
```
