import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import {
  fetchLatestBaileysVersion,
  makeWASocket,
} from '@whiskeysockets/baileys'
import * as Boom from '@hapi/boom'
import useMySQLAuthState from 'mysql-baileys'
import { v4 as uuidv4 } from 'uuid'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import {
  PORT,
  MYSQL_HOST,
  MYSQL_USER,
  MYSQL_PORT,
  MYSQL_PASSWORD,
  MYSQL_DATABASE,
  DEFAULT_SESSION,
  LOG_DIR,
} from './config'

const session = DEFAULT_SESSION
const sock: any = {
  [session]: null,
}
const sockReady: any = {
  [session]: false,
}

async function startSock(session: string) {
  const { error, version } = await fetchLatestBaileysVersion()
  if (error) {
    console.log(`session: ${session} | No connection, check your internet`)
    return startSock(session)
  }

  const { state, saveCreds, removeCreds } = await useMySQLAuthState({
    session,
    host: MYSQL_HOST,
    port: Number(MYSQL_PORT),
    user: MYSQL_USER,
    password: MYSQL_PASSWORD,
    database: MYSQL_DATABASE,
    tableName: 'auth',
  })

  sock[session] = makeWASocket({
    auth: state,
    version,
    printQRInTerminal: true,
  })

  sock[session].ev.on('creds.update', saveCreds)

  sock[session].ev.on('connection.update', (update: any) => {
    const { connection, lastDisconnect } = update
    if (connection === 'close') {
      sockReady[session] = false
      if (Boom.boomify(lastDisconnect.error).output.statusCode == 401) {
        removeCreds()
      }
      const shouldReconnect =
        lastDisconnect && lastDisconnect.error
          ? Boom.boomify(lastDisconnect.error).output.statusCode
          : 500
      console.log(
        'Connection closed due to',
        lastDisconnect?.error,
        ', reconnecting in',
        shouldReconnect,
        'ms',
      )
      if (shouldReconnect) {
        setTimeout(() => startSock(session), shouldReconnect)
      }
    } else if (connection === 'open') {
      sockReady[session] = true
      console.log('Opened connection')
    }
  })

  sock[session].ev.on('messages.upsert', async (m: any) => {
    const uuid = uuidv4()
    const timestamp = new Date().getTime()
    const messageFilePath = join(LOG_DIR, `messages-${timestamp}-${uuid}.json`)
    await writeFile(messageFilePath, Buffer.from(JSON.stringify(m, null, 2)))
  })
}

const app = new Hono()
app.use(logger())
app.get('/', (c) => c.json({ message: 'OK' }))
app.post('/delivery', async (context) => {
  const uuid = uuidv4()
  const timestamp = new Date().getTime()
  const deliveryFilePath = join(LOG_DIR, `delivery-${timestamp}-${uuid}.json`)
  const { to, data, options } = await context.req.json()
  if (!options) {
    const sent = await sock[session].sendMessage(to, data)
    await writeFile(
      deliveryFilePath,
      Buffer.from(JSON.stringify(sent, null, 2)),
    )
    return context.json(sent)
  }
  const sent = await sock[session].sendMessage(to, data, options)
  await writeFile(deliveryFilePath, Buffer.from(JSON.stringify(sent, null, 2)))
  return context.json(sent)
})

startSock(session).catch((err) => console.log('Unexpected error:', err))

serve({
  fetch: app.fetch,
  port: Number(PORT),
})
