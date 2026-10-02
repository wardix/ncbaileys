# ncbaileys

Layanan bot WhatsApp multi-akun yang dibangun dengan [Baileys](https://github.com/WhiskeySockets/Baileys), Hono, NATS, MongoDB, dan Valkey.

## Fitur

- ✅ **Multi-akun WhatsApp** — Kelola multiple akun WhatsApp dari satu service
- ✅ **HTTP API** — REST API untuk mengirim pesan dan mengelola media
- ✅ **Real-time Messaging** — Pub/sub via NATS JetStream untuk pesan masuk
- ✅ **Message Persistence** — Simpan history pesan di MongoDB dengan cache Valkey
- ✅ **Media Support** — Gambar, video, dokumen dengan upload/download
- ✅ **Message Quoting** — Reply dan quote pesan dengan konteks
- ✅ **Logging** — Semua pesan dicatat ke disk dengan timestamp dan UUID

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Setup Environment

Salin `.env.dist` ke `.env` dan sesuaikan:

```bash
cp .env.dist .env
```

Edit `.env` dengan konfigurasi Anda:

```env
PORT=3000
WA_ACCOUNTS=["628866442200"]           # Array JSON dengan nomor WA
SESSION_DIR=/tmp/wa-sessions           # Folder untuk simpan kredensial
LOG_DIR=/tmp/wa-logs                   # Folder untuk simpan log pesan
MONGODB_URL=mongodb://127.0.0.1:27017/ # URL MongoDB
MONGODB_DATABASE=baileys               # Nama database
VALKEY_HOST=localhost                  # Host Redis/Valkey
VALKEY_PORT=6379                       # Port Redis/Valkey
NATS_SERVERS=nats://localhost:4222     # NATS server
NATS_TOKEN=                            # Token NATS (opsional)
MEDIA_BASE_URL=http://localhost:3000/media
SEND_RESPONSE_TEMPLATE={}
```

### 3. Persiapan Infrastructure

Pastikan services berikut running:

```bash
# MongoDB
mongod --bind_ip 127.0.0.1

# Valkey/Redis
valkey-server --port 6379

# NATS
nats-server
```

### 4. Build & Run

```bash
# Build TypeScript
npm run build

# Jalankan service
npm start
```

Server akan start di `http://localhost:3000` dan menginisialisasi WhatsApp connections.

## API Endpoints

### Mengirim Pesan

**POST** `/:phoneId/messages`

Mengirim pesan teks, gambar, video, atau dokumen.

**Request Body:**

```json
{
  "to": "628866442200",
  "type": "text",
  "text": {
    "body": "Halo!"
  },
  "context": {
    "message_id": "3EB0612F8A3C84D5"
  }
}
```

**Tipe pesan:**

- **text**
  ```json
  { "type": "text", "text": { "body": "Pesan teks" } }
  ```

- **image**
  ```json
  {
    "type": "image",
    "image": {
      "id": "media-uuid",
      "caption": "Caption opsional"
    }
  }
  ```

- **video**
  ```json
  {
    "type": "video",
    "video": {
      "id": "media-uuid",
      "caption": "Caption opsional"
    }
  }
  ```

- **document**
  ```json
  {
    "type": "document",
    "document": {
      "id": "media-uuid",
      "caption": "Caption opsional",
      "filename": "dokumen.pdf"
    }
  }
  ```

**Response:**

```json
{
  "messaging_product": "whatsapp",
  "contacts": [
    {
      "input": "628866442200",
      "wa_id": "628866442200"
    }
  ],
  "messages": [
    {
      "id": "wamid.xxxxx"
    }
  ]
}
```

### Upload Media

**POST** `/media`

Upload file untuk dikirim via WhatsApp.

**Request:**
- Content-Type: `multipart/form-data`
- Field: `file` (binary)

**Response:**

```json
{
  "id": "uuid-media",
  "url": "http://media-service/path/to/file"
}
```

Gunakan `id` di payload message.

### Get Media Metadata

**GET** `/media/:mediaId`

Fetch metadata media yang sudah diupload.

**Response:**

```json
{
  "id": "uuid-media",
  "url": "http://media-service/path/to/file"
}
```

## Architecture & Integration

ncbaileys adalah bagian dari sistem WhatsApp yang lebih besar:

```
WhatsApp Messages
       ↓
   ncbaileys (service ini)
       ↓
   NATS JetStream
       ↓
   ncbaileyproc (consumer)
       ↓
   Business Logic / Database / External APIs
```

**ncbaileys** bertugas:
- Menghubung ke WhatsApp via Baileys
- Menerima & mengirim pesan
- Publish event ke NATS

**ncbaileyproc** bertugas:
- Subscribe ke event dari NATS
- Process pesan sesuai business logic
- Simpan/sync ke database atau external services

📚 **Dokumentasi ncbaileyproc:** https://github.com/wardix/ncbaileys-processor

Lihat repository tersebut untuk detail tentang message processing logic dan business logic implementation.

## Event Stream (NATS)

Setiap pesan masuk dipublikasikan ke NATS JetStream:

**Topic:** `events.ncbaileys.{session}.messages_received`

**Payload:**

```json
{
  "messages": [
    {
      "key": {
        "remoteJid": "628866442200@s.whatsapp.net",
        "fromMe": false,
        "id": "3EB0612F8A3C84D5",
        "subject": "Group Name"
      },
      "message": {
        "conversation": "Konten pesan",
        "imageMessage": {
          "url": "...",
          "id": "uuid-media"
        }
      },
      "messageTimestamp": 1234567890
    }
  ],
  "type": "notify"
}
```

Subscribe ke topic ini untuk memproses pesan masuk:

```bash
nats sub "events.ncbaileys.*.messages_received" --raw
```

## Integrasi dengan WhatsApp

### Login (First Time Setup)

1. Service start → generate QR code di console
2. Scan dengan WhatsApp app pada device Anda
3. Kredensial otomatis tersimpan di `SESSION_DIR`
4. Service siap mengirim/menerima pesan

### Session State

Kredensial dan auth state tersimpan di folder session per akun:

```
SESSION_DIR/
├── 628866442200/
│   ├── creds.json
│   ├── auth-tokens.json
│   └── pre-keys/
```

Jangan hapus folder ini kecuali ingin re-login.

## Arsitektur & Alur Pesan

Lihat [CLAUDE.md](./CLAUDE.md) untuk detail teknis architecture.

### Incoming Message Flow

```
WhatsApp → Baileys WebSocket
         → Log ke disk
         → Save ke MongoDB
         → Publish ke NATS
```

### Outgoing Message Flow

```
HTTP POST /:phoneId/messages
         → Validasi socket ready
         → Load quoted message (jika ada)
         → Fetch media (jika ada)
         → Send via Baileys
         → Return message ID
```

## Troubleshooting

### Socket tidak ready

**Error:** `socket is not ready` saat mengirim pesan

**Solusi:**
- Pastikan akun sudah login (scan QR code)
- Cek koneksi internet
- Lihat logs untuk error message detail

### Koneksi terputus

Service otomatis reconnect setelah disconnect (kecuali logout).

Monitor di console untuk melihat status koneksi:

```bash
npm start  # Lihat log connection updates
```

### Media tidak terupload

Pastikan `MEDIA_BASE_URL` accessible dan media service running.

Cek response dari endpoint `POST /media`.

### MongoDB/Valkey offline

Service akan error saat save message. Pastikan:

```bash
# Test MongoDB
mongosh "mongodb://127.0.0.1:27017/"

# Test Valkey
valkey-cli ping
```

## Environment Variables

| Variable | Default | Deskripsi |
|----------|---------|-----------|
| `PORT` | 3000 | Port HTTP server |
| `WA_ACCOUNTS` | `["628866442200"]` | JSON array nomor WA |
| `SESSION_DIR` | `/tmp` | Folder session Baileys |
| `LOG_DIR` | `/tmp` | Folder log pesan |
| `MONGODB_URL` | `mongodb://127.0.0.1:27017/?directConnection=true` | MongoDB connection |
| `MONGODB_DATABASE` | `baileys` | Nama database MongoDB |
| `VALKEY_HOST` | `localhost` | Host Valkey/Redis |
| `VALKEY_PORT` | `6379` | Port Valkey/Redis |
| `NATS_SERVERS` | `nats://localhost:4222` | NATS server URL |
| `NATS_TOKEN` | `` | Token auth NATS |
| `MEDIA_BASE_URL` | `http://localhost:3000/media` | Base URL media service |
| `SEND_RESPONSE_TEMPLATE` | `{}` | Response template |

## Scripts

```bash
npm run build    # Compile TypeScript ke dist/
npm start        # Run service
npm test         # Run tests (belum tersedia)
```

## Struktur Project

```
.
├── src/
│   ├── main.ts                 # Entry point
│   ├── socket.service.ts       # Baileys connection & event handling
│   ├── route-handler.ts        # HTTP endpoint handlers
│   ├── hono.ts                 # HTTP routing setup
│   ├── config.ts               # Env config
│   ├── wa-signin.ts            # WhatsApp auth
│   ├── utils.ts                # Utility functions
│   └── valkey-mongo-store.ts   # Message persistence
├── dist/                       # Compiled output
├── package.json
├── tsconfig.json
├── .env.dist                   # Environment template
└── CLAUDE.md                   # Dev guide
```

## Dependencies

| Package | Versi | Guna |
|---------|-------|------|
| baileys | ^7.0.0-rc.9 | WhatsApp client |
| @hono/node-server | ^1.19.7 | HTTP server |
| mongodb | ^7.0.0 | Database |
| @valkey/valkey-glide | ^2.2.1 | Redis cache |
| nats | ^2.29.3 | Pub/sub messaging |
| pino | ^10.1.0 | Logging |
| axios | ^1.13.2 | HTTP client |
| uuid | ^10.0.0 | ID generation |
| qrcode | ^1.5.4 | QR code generation |

## License

ISC
