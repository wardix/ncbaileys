import { serve } from '@hono/node-server'
import { startSock } from './socket.service'
import app from './hono'

import { PORT, DEFAULT_SESSION } from './config'

startSock(DEFAULT_SESSION).catch((err) => console.log('Unexpected error:', err))

serve({
  fetch: app.fetch,
  port: Number(PORT),
})
