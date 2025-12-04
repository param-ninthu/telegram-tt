# Telegram Disappearing Photos Extension

Send disappearing photos on Telegram Web A by adding `ttlSeconds` to regular photo uploads.

## Problem

Telegram Web **does not have a UI** for sending disappearing photos. This extension:
1. Hooks into Telegram's internal `sendMessage` function
2. Adds `ttlSeconds` parameter to photo attachments
3. Sends photos that self-destruct after viewing

## Installation

```bash
1. chrome://extensions/
2. Enable "Developer mode"
3. Load unpacked → select chrome-extension folder
```

## Usage

Open https://web.telegram.org/a, open any chat, then:

### Quick Test
```javascript
// Send a generated test image (10 second TTL)
TelegramDisappearing.sendTest(10);
```

### From File Picker
```javascript
// Opens file dialog
TelegramDisappearing.selectAndSend(10);
```

### From URL
```javascript
// Download and send
await TelegramDisappearing.sendFromUrl('https://picsum.photos/800/600', 10);
```

### From Blob/File
```javascript
// Custom file
const input = document.createElement('input');
input.type = 'file';
input.onchange = async (e) => {
  await TelegramDisappearing.send(e.target.files[0], 10);
};
input.click();
```

## How It Works

```javascript
// Regular photo upload (no TTL)
actions.sendMessage({
  attachments: [{
    blob: imageBlob,
    blobUrl: '...',
    filename: 'photo.jpg',
    // ... other fields
  }],
  messageList: { chatId, threadId, type }
});

// Disappearing photo (with TTL) ← What we do
actions.sendMessage({
  attachments: [{
    blob: imageBlob,
    blobUrl: '...',
    filename: 'photo.jpg',
    ttlSeconds: 10,  // ← Added this!
    // ... other fields
  }],
  messageList: { chatId, threadId, type }
});
```

## API Reference

### `TelegramDisappearing.send(file, ttlSeconds)`
Send a File or Blob with TTL

**Parameters:**
- `file` (File|Blob) - Image to send
- `ttlSeconds` (number) - Seconds until disappear (default: 10)

**Returns:** Promise<boolean>

### `TelegramDisappearing.selectAndSend(ttlSeconds)`
Open file picker and send

### `TelegramDisappearing.sendFromUrl(url, ttlSeconds)`
Download from URL and send

### `TelegramDisappearing.sendTest(ttlSeconds)`
Send a generated test image

### `TelegramDisappearing.getCurrentChat()`
Get current open chat info

## TTL Values

```javascript
TelegramDisappearing.sendTest(10);    // 10 seconds
TelegramDisappearing.sendTest(60);    // 1 minute
TelegramDisappearing.sendTest(3600);  // 1 hour
TelegramDisappearing.sendTest(86400); // 1 day
```

## Examples

### Canvas to Disappearing Photo
```javascript
const canvas = document.createElement('canvas');
canvas.width = 800;
canvas.height = 600;
const ctx = canvas.getContext('2d');

ctx.fillStyle = '#FF6B6B';
ctx.fillRect(0, 0, 800, 600);
ctx.fillStyle = 'white';
ctx.font = '48px Arial';
ctx.fillText('Secret Message', 400, 300);

canvas.toBlob(async (blob) => {
  const file = new File([blob], 'secret.png', { type: 'image/png' });
  await TelegramDisappearing.send(file, 10);
});
```

### Batch Send
```javascript
const urls = [
  'https://picsum.photos/800/600?random=1',
  'https://picsum.photos/800/600?random=2'
];

for (const url of urls) {
  await TelegramDisappearing.sendFromUrl(url, 10);
  await new Promise(r => setTimeout(r, 2000)); // Wait 2s
}
```

## Troubleshooting

### "No active tab found"
- Refresh the page
- Wait for Telegram to fully load

### "No chat is open"
- Open any chat before sending

### "Could not find Telegram API"
- Ensure you're on web.telegram.org/a (not /k)
- Check console for errors
- Reload extension

## Technical Details

The extension:
1. Searches webpack modules for `getGlobal()` and `getActions()`
2. Accesses current chat from `global.byTabId[1].messageLists`
3. Creates attachment object with `ttlSeconds` field
4. Calls `actions.sendMessage()` with modified attachment
5. Telegram's backend sees `ttlSeconds` and creates disappearing message

Key code location in Telegram source:
- `src/api/types/misc.ts:66` - ApiAttachment interface with ttlSeconds
- `src/global/actions/api/messages.ts:341` - sendMessage action
- `src/api/gramjs/methods/messages.ts:921` - Upload with ttlSeconds

## Security

- Uses existing session (no new auth)
- Read-only access to global state
- Only modifies outgoing attachments
- No data exfiltration

## Limitations

- Version A only (not K)
- Requires open chat
- Images only (no video/voice yet)
- Same session only

## Credits

Based on reverse engineering of telegram-tt codebase.
