# Telegram Web A - Reverse Engineering Analysis

## Overview
This document describes the findings from reverse-engineering Telegram Web A's message sending flow, specifically how disappearing photos (TTL messages) work internally.

## Source Files Analyzed
- `2026.b8fb401b0f58b6ab09af.js` - Webpack chunk containing Telegram's API layer
- `web.telegram.org.late.har` - Network traffic capture showing WebSocket API calls

## Key Findings

### 1. Message Sending Flow

```
User Action → sendMessage (Sf) → createLocalMessage (If) → sendApiMessage (wf)
                                                                    ↓
                                                    buildInputMedia → Telegram API
```

### 2. TTL Parameter Handling

#### Function `xr` - Extracts TTL from Attachment
```javascript
function xr(e,t) {
  const s = "ttlSeconds" in e ? e.ttlSeconds : void 0
  // ... processes attachment and returns media object with ttlSeconds
}
```

**Key Insight:** This function checks if `ttlSeconds` property exists in the attachment object.

#### InputMedia Construction
```javascript
return new Ke.InputMediaUploadedDocument({
  file: _,
  mimeType: i,
  attributes: b,
  thumb: y,
  forceFile: u,
  spoiler: l,
  ttlSeconds: f  // ← Extracted from attachment and passed to API
})
```

### 3. Attachment Processing Flow

```
File Object
    ↓
buildAttachment(file.name, file, options)  // src/components/middle/composer/helpers/buildAttachment.ts
    ↓
ApiAttachment {
  blob: Blob,
  blobUrl: string,
  filename: string,
  mimeType: string,
  size: number,
  ...options  // ← ttlSeconds spreads here if provided in options
}
    ↓
Promise.all([...attachments])  // ← INTERCEPTION POINT
    ↓
Function xr(attachment)  // Extracts ttlSeconds
    ↓
new InputMediaUploadedDocument({ ttlSeconds })
    ↓
Telegram API via WebSocket
```

### 4. TL Schema Definition

From the Type Language schema in the webpack chunk:

```tl
inputMediaUploadedPhoto#1e287d04 flags:#
  spoiler:flags.2?true
  file:InputFile
  stickers:flags.0?Vector<InputDocument>
  ttl_seconds:flags.1?int = InputMedia;

inputMediaPhoto#b3ba0635 flags:#
  spoiler:flags.1?true
  id:InputPhoto
  ttl_seconds:flags.0?int = InputMedia;

inputMediaUploadedDocument#37c9330 flags:#
  nosound_video:flags.3?true
  force_file:flags.4?true
  spoiler:flags.5?true
  file:InputFile
  thumb:flags.2?InputFile
  mime_type:string
  attributes:Vector<DocumentAttribute>
  stickers:flags.0?Vector<InputDocument>
  video_cover:flags.6?InputPhoto
  video_timestamp:flags.7?int
  ttl_seconds:flags.1?int = InputMedia;
```

**Note:** The API parameter is `ttl_seconds` (snake_case), but internally Telegram uses `ttlSeconds` (camelCase) in JavaScript.

### 5. Network Communication

- **Protocol:** WebSocket (wss://zws5.web.telegram.org/apiws)
- **Format:** Binary protocol (not REST API)
- **Method:** All API calls go through persistent WebSocket connection

## Extension Implementation

### Interception Strategy

The extension uses **Promise.all monkey-patching** to intercept attachment creation:

1. **Why Promise.all?**
   - `buildAttachment()` returns a Promise
   - Multiple attachments are processed with `Promise.all(attachments.map(buildAttachment))`
   - This is the perfect interception point

2. **Detection Logic:**
   ```javascript
   if (first && typeof first === 'object' &&
       'blob' in first &&
       'blobUrl' in first &&
       'filename' in first &&
       'mimeType' in first &&
       'size' in first) {
     // This is an ApiAttachment object!
   }
   ```

3. **Injection:**
   ```javascript
   const modified = values.map(att => ({
     ...att,
     ttlSeconds: pendingTTL
   }));
   ```

### Why This Works

1. We add `ttlSeconds` to the `ApiAttachment` object
2. Function `xr()` checks `"ttlSeconds" in attachment`
3. If present, it's extracted and passed to `InputMediaUploadedDocument`
4. The Telegram API receives the `ttl_seconds` parameter
5. Message is sent as a disappearing photo

## Validation

The approach has been validated by:
- ✅ Tracing the exact code flow in the webpack bundle
- ✅ Finding where `ttlSeconds` is extracted (function `xr`)
- ✅ Confirming it's passed to API constructors
- ✅ Matching TL schema definitions
- ✅ No source code modifications required
- ✅ Works with production webpack bundles

## Alternative Approaches Considered

### 1. Direct API Access (Rejected)
**Reason:** Production webpack bundles don't expose `getGlobal()` or `getActions()` to window scope.

### 2. Webpack Module Cache Search (Rejected)
**Reason:** Module IDs are randomized and internal functions are in closures.

### 3. React Fiber Tree Traversal (Rejected)
**Reason:** Too fragile and dependent on React internals.

### 4. Promise.all Interception (Chosen ✓)
**Reason:** Clean, reliable, and hooks into the exact point where attachments are created.

## Future Improvements

1. **Video Support:** Extend to support disappearing videos
2. **Direct File Input:** Hook into file input directly without UI automation
3. **Batch Operations:** Support sending multiple disappearing photos at once
4. **TTL Presets:** Add quick shortcuts for common TTL values

## Security Considerations

- Extension runs in page context (necessary for Promise.all patching)
- No external servers or network calls
- No user data collection
- Only intercepts photo attachments when explicitly called

---

**Build Version:** 2026.b8fb401b0f58b6ab09af.js
**Analysis Date:** December 2024
**Telegram Web A URL:** https://web.telegram.org/a
