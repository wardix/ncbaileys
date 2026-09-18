# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Building & Running

```bash
npm run build          # Compile TypeScript to dist/
npm start              # Run compiled service (node dist/main.js)
```

The service starts an HTTP server on `PORT` (default 3000) and initializes WebSocket connections for each account in `WA_ACCOUNTS`.

## Architecture Overview

**ncbaileys** is a multi-account WhatsApp bot service. The core architecture has three layers:

### 1. WhatsApp Connection Layer (Baileys)
- **File:** `socket.service.ts`
- One Baileys WebSocket per account; each account has independent session state stored in `SESSION_DIR`
- Key events:
  - `messages.upsert`: Incoming message → log to disk + MongoDB + publish to NATS
  - `connection.update`: Handle reconnection/logout
  - `creds.update`: Auto-save credentials

### 2. HTTP API Layer (Hono)
- **File:** `route-handler.ts` + `hono.ts`
- Handles message sending and media management
- Routes:
  - `POST /:phoneId/messages` — Send message (text/image/video/document)
  - `POST /media` — Upload media file
  - `GET /media/:mediaId` — Fetch media metadata
- Validates socket readiness before sending

### 3. Storage & Messaging Layer
- **MongoDB** (`valkey-mongo-store.ts`): Persists message history
- **Valkey/Redis**: Message cache for fast lookups (used by `getMessage` callback in Baileys)
- **NATS JetStream**: Publishes received messages to `events.ncbaileys.{session}.messages_received`
- **File System** (`LOG_DIR`): Logs all incoming/outgoing messages with UUID timestamps

## Configuration

All settings via environment variables in `.env` (see `.env.dist` for template):

```
PORT=3000                                    # HTTP server port
WA_ACCOUNTS=["628866442200"]                 # JSON array of account numbers
SESSION_DIR=/path/to/sessions                # Baileys credential storage
LOG_DIR=/path/to/logs                        # Message log directory
MONGODB_URL=mongodb://127.0.0.1:27017/...    # MongoDB connection
VALKEY_HOST=localhost VALKEY_PORT=6379       # Redis cache
NATS_SERVERS=nats://localhost:4222           # NATS server
NATS_TOKEN=token                             # NATS auth
MEDIA_BASE_URL=http://localhost:3000/media   # Media service URL
SEND_RESPONSE_TEMPLATE={}                    # Response shape for sent messages
```

## Key Implementation Details

### Message Flow - Incoming
1. Baileys receives WhatsApp message → `messages.upsert` event fires
2. Message logged to disk with UUID timestamp
3. Media (image/video/doc) downloaded, uploaded to media service, ID stored
4. Message saved to MongoDB via `saveMessage()`
5. Published to NATS with enriched metadata (group subject if group message)

### Message Flow - Outgoing
1. HTTP POST to `/:phoneId/messages` with message payload
2. Check `sockReady[phoneId]` — returns 500 if not ready
3. Load quoted message from MongoDB if `context.message_id` provided
4. Fetch media from media service if needed, convert to buffer
5. Call `sock[phoneId].sendMessage(to, messageBody, { quoted })`
6. Return formatted response with message ID

### Session Management
- Each account is initialized independently in `main.ts`
- Sessions use file-based auth state (Baileys `useMultiFileAuthState`)
- On logout: session files deleted automatically
- On disconnect (non-logout): auto-reconnect via `startSock()`

### Media Handling
Messages with media go through:
1. Download from WhatsApp via Baileys `downloadMediaMessage()`
2. Upload to external media service (via `uploadMedia()` in `utils.ts`)
3. Store media ID in message before publishing/saving

## Common Tasks

**Inspect incoming messages:**
Check `LOG_DIR` for `messages-{timestamp}-{uuid}.json` files

**Check message persistence:**
Query MongoDB database `baileys` collection (configurable via env)

**Monitor events:**
Subscribe to NATS topic: `events.ncbaileys.{session}.messages_received`

**Debug connection issues:**
Check Baileys logs (uses Pino logger) and `connection.update` events in console

## Development Notes

- **Baileys version:** ^7.0.0-rc.9 (release candidate; stable API but watch for breaking changes)
- **Browser identity:** Currently set to `Browsers.ubuntu('Firefox')` — affects QR code generation
- **Message quotes:** Requires loading original message via `getMessage` callback (implemented via Valkey-MongoDB)
- **Media uploads:** Assumes external media service handles storage; this service only tracks IDs
- **NATS dependency:** Service will fail if NATS unavailable when publishing (consider adding retry logic)

## Testing

Currently no test framework configured. To add tests, set up Jest or similar and update `package.json` scripts.
