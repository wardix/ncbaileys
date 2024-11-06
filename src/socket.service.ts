import {
  fetchLatestBaileysVersion,
  makeWASocket,
  downloadMediaMessage,
} from '@whiskeysockets/baileys'
import * as Boom from '@hapi/boom'
import useMySQLAuthState from 'mysql-baileys'
import { v4 as uuidv4 } from 'uuid'
import fs from 'fs/promises'
import path from 'path'
import axios from 'axios'
import FormData from 'form-data'

import {
  MYSQL_HOST,
  MYSQL_USER,
  MYSQL_PORT,
  MYSQL_PASSWORD,
  MYSQL_DATABASE,
  DEFAULT_SESSION,
  LOG_DIR,
  NATS_SERVERS,
  NATS_TOKEN,
  META_UPLOAD_MEDIA_URL,
  META_MEDIA_TOKEN,
} from './config'
import { connect, StringCodec } from 'nats'

export const sock: any = { [DEFAULT_SESSION]: null }
export const sockReady: any = { [DEFAULT_SESSION]: false }

export async function startSock(session: string) {
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
    const messageFilePath = path.join(
      LOG_DIR,
      `messages-${timestamp}-${uuid}.json`,
    )
    await fs.writeFile(messageFilePath, Buffer.from(JSON.stringify(m, null, 2)))
    const publishedMessage = JSON.parse(JSON.stringify(m))
    if (!m.messages[0].message) {
      return
    }
    if (m.messages[0].message.imageMessage) {
      const buffer = await downloadMediaMessage(m.messages[0], 'buffer', {})
      const formData = new FormData()
      formData.append('file', buffer, {
        filename: 'imagefile',
        contentType: m.messages[0].message.imageMessage.mimetype,
      })

      formData.append('type', m.messages[0].message.imageMessage.mimetype)
      formData.append('messaging_product', 'whatsapp')
      const response = await axios.post(META_UPLOAD_MEDIA_URL, formData, {
        headers: {
          Authorization: `Bearer ${META_MEDIA_TOKEN}`,
          ...formData.getHeaders(),
        },
      })
      console.log(response.data)
      publishedMessage.messages[0].message.imageMessage['id'] = response.data.id
    } else if (m.messages[0].message.videoMessage) {
      const buffer = await downloadMediaMessage(m.messages[0], 'buffer', {})
      const formData = new FormData()
      formData.append('file', buffer, {
        filename: 'videofile',
        contentType: m.messages[0].message.videoMessage.mimetype,
      })

      formData.append('type', m.messages[0].message.videoMessage.mimetype)
      formData.append('messaging_product', 'whatsapp')
      const response = await axios.post(META_UPLOAD_MEDIA_URL, formData, {
        headers: {
          Authorization: `Bearer ${META_MEDIA_TOKEN}`,
          ...formData.getHeaders(),
        },
      })
      console.log(response.data)
      publishedMessage.messages[0].message.videoMessage['id'] = response.data.id
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
