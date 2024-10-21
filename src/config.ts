import { config } from 'dotenv'

config()

export const PORT = process.env.PORT || 3000
export const MYSQL_HOST = process.env.MYSQL_HOST || 'localhost'
export const MYSQL_USER = process.env.MYSQL_USER || 'root'
export const MYSQL_PORT = process.env.MYSQL_PORT || 3306
export const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD || 'supersecret'
export const MYSQL_DATABASE = process.env.MYSQL_DATABASE || 'test'
export const DEFAULT_SESSION = process.env.DEFAULT_SESSION || 'main'
export const LOG_DIR = process.env.LOG_DIR || '/tmp'
export const NATS_SERVERS = process.env.NATS_SERVERS || 'nats://localhost:4222'
export const NATS_TOKEN = process.env.NATS_TOKEN || ''
export const JWT_SECRET = process.env.JWT_SECRET || ''
export const SEND_RESPONSE_TEMPLATE = process.env.SEND_RESPONSE_TEMPLATE || '{}'
export const META_UPLOAD_MEDIA_URL =
  process.env.META_UPLOAD_MEDIA_URL ||
  'https://graph.facebook.com/v21.0/123456789/media'
export const META_UPLOAD_MEDIA_TOKEN =
  process.env.META_UPLOAD_MEDIA_TOKEN || 'abcdefghijklmnopqrstuvwxyz01234568790'
