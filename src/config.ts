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
