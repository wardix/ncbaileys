import { config } from 'dotenv'

config()

export const PORT = process.env.PORT || 3000
export const WA_ACCOUNTS = process.env.WA_ACCOUNTS || ['628866442200']
export const LOG_DIR = process.env.LOG_DIR || '/tmp'
export const MEDIA_DIR = process.env.MEDIA_DIR || '/tmp'
export const SESSION_DIR = process.env.SESSION_DIR || '/tmp'
export const NATS_SERVERS = process.env.NATS_SERVERS || 'nats://localhost:4222'
export const NATS_TOKEN = process.env.NATS_TOKEN || ''
export const JWT_SECRET = process.env.JWT_SECRET || ''
export const SEND_RESPONSE_TEMPLATE = process.env.SEND_RESPONSE_TEMPLATE || '{}'
export const MEDIA_BASE_URL =
  process.env.MEDIA_BASE_URL || 'http://localhost:3000/media'

export const MONGODB_URL =
  process.env.MONGODB_URL || 'mongodb://127.0.0.1:27017/?directConnection=true'

export const MONGODB_DATABASE = process.env.MONGODB_DATABASE || 'baileys'

export const VALKEY_HOST = process.env.VALKEY_HOST || 'localhost'
export const VALKEY_PORT = Number(process.env.VALKEY_PORT || 6379)

// Typing indicator shown before sending a message; set TYPING_MAX_MS=0 to disable
export const TYPING_MS_PER_CHAR = Number(process.env.TYPING_MS_PER_CHAR || 50)
export const TYPING_MIN_MS = Number(process.env.TYPING_MIN_MS || 1000)
export const TYPING_MAX_MS = Number(process.env.TYPING_MAX_MS || 5000)
