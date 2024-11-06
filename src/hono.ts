import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { jwt } from 'hono/jwt'
import { JWT_SECRET } from './config'
import {
  getMediaUrl,
  getProxyUrl,
  postMedia,
  postMessage,
} from './context.handler'

const app = new Hono()

app.use(logger())

app.get('/', (c) => c.json({ message: 'OK' }))

app.get('/:mediaId', jwt({ secret: JWT_SECRET }), getMediaUrl)
app.get('/proxy/:url', jwt({ secret: JWT_SECRET }), getProxyUrl)
app.post('/:phoneId/media', jwt({ secret: JWT_SECRET }), postMedia)
app.post('/:phoneId/messages', jwt({ secret: JWT_SECRET }), postMessage)

export default app
