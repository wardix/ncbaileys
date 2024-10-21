import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { jwt } from 'hono/jwt'
import {
  fetchLatestBaileysVersion,
  makeWASocket,
  downloadMediaMessage,
} from '@whiskeysockets/baileys'
import * as Boom from '@hapi/boom'
import useMySQLAuthState from 'mysql-baileys'
import { v4 as uuidv4 } from 'uuid'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import axios from 'axios'
import FormData from 'form-data'

import {
  PORT,
  MYSQL_HOST,
  MYSQL_USER,
  MYSQL_PORT,
  MYSQL_PASSWORD,
  MYSQL_DATABASE,
  DEFAULT_SESSION,
  LOG_DIR,
  NATS_SERVERS,
  NATS_TOKEN,
  JWT_SECRET,
  SEND_RESPONSE_TEMPLATE,
  META_UPLOAD_MEDIA_URL,
  META_UPLOAD_MEDIA_TOKEN,
} from './config'
import { connect, StringCodec } from 'nats'

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
    const publishedMessage = { ...m }
    if (!m.messages[0].message) {
      return
    }
    if ('imageMessage' in m.messages[0].message) {
      const buffer = await downloadMediaMessage(
        m.messages[0].message,
        'buffer',
        {},
      )
      const formData = new FormData()
      formData.append('file', buffer, {
        contentType: m.messages[0].message.imageMessage.mimetype,
      })
      formData.append('type', m.messages[0].message.imageMessage.mimetype)
      formData.append('messaging_product', 'whatsapp')
      const response = await axios.post(META_UPLOAD_MEDIA_URL, formData, {
        headers: {
          Authorization: `Bearer ${META_UPLOAD_MEDIA_TOKEN}`,
          ...formData.getHeaders(),
        },
      })
      console.log(response.data)
      publishedMessage.messages[0].message.imageMessage.id = response.data.id
    }

    const nc = await connect({
      servers: NATS_SERVERS,
      token: NATS_TOKEN,
    })
    const js = nc.jetstream()
    const sc = StringCodec()
    await js.publish(
      'events.ncbaileys.messages_received',
      sc.encode(JSON.stringify(publishedMessage)),
    )
    await nc.close()
  })
}

const app = new Hono()

app.use(logger())

app.use(
  '/*/messages',
  jwt({
    secret: JWT_SECRET,
  }),
)

app.get('/', (c) => c.json({ message: 'OK' }))

app.post('/:phoneId/messages', async (context) => {
  const uuid = uuidv4()
  const timestamp = new Date().getTime()
  const phoneId = context.req.param('phoneId')

  const headerFilePath = join(
    LOG_DIR,
    `${phoneId}-header-${timestamp}-${uuid}.txt`,
  )
  const bodyFilePath = join(
    LOG_DIR,
    `${phoneId}-request-body-${timestamp}-${uuid}.txt`,
  )

  const headers: any = {}
  for (const [header, value] of context.req.raw.headers) {
    headers[header] = value
  }
  await writeFile(headerFilePath, Buffer.from(JSON.stringify(headers, null, 2)))

  const bodyBuffer = await context.req.arrayBuffer()
  await writeFile(bodyFilePath, Buffer.from(bodyBuffer))

  if (!sockReady[session]) {
    return context.json({ message: 'socket is not ready' }, 500)
  }

  const payload = await context.req.json()
  if (payload.type !== 'text') {
    return context.json({ message: 'unable to proceed' }, 402)
  }
  const sent = await sock[session].sendMessage(`${payload.to}@s.whatsapp.net`, {
    text: payload.text.body,
  })

  const response = JSON.parse(SEND_RESPONSE_TEMPLATE)
  response.contacts[0].input = payload.to
  response.contacts[0].wa_id = payload.to
  response.messages[0].id = sent.key.id

  console.log(sent)
  console.log(response)
  return context.json(response)
})

startSock(session).catch((err) => console.log('Unexpected error:', err))

serve({
  fetch: app.fetch,
  port: Number(PORT),
})
