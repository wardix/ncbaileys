import {
  fetchLatestBaileysVersion,
  makeWASocket,
  downloadMediaMessage,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys'
import * as Boom from '@hapi/boom'
import { v4 as uuidv4 } from 'uuid'
import fs from 'fs/promises'
import path from 'path'

import { LOG_DIR, NATS_SERVERS, NATS_TOKEN, SESSION_DIR } from './config'
import { connect, StringCodec } from 'nats'
import { uploadMedia } from './utils'

export const sock: any = {}
export const store: any = {}
export const sockReady: any = {}

export async function startSock(session: string) {
  const { error, version } = await fetchLatestBaileysVersion()
  if (error) {
    console.log(`session: ${session} | No connection, check your internet`)
    return startSock(session)
  }

  const sessionPath = path.join(SESSION_DIR, session)
  const storeFilePath = path.join(sessionPath, 'baileys_store.json')
  await fs.mkdir(sessionPath, { recursive: true })
  try {
    const uuid = uuidv4()
    const timestamp = new Date().getTime()
    const archiveStoreFilePath = path.join(
      SESSION_DIR,
      `baileys_store-${timestamp}-${uuid}.json`,
    )
    await fs.rename(storeFilePath, archiveStoreFilePath)
  } catch (error) {
    console.log(`Error renaming store file: ${error}`)
  }
  setInterval(() => {
    store[session].writeToFile(storeFilePath)
  }, 10000)

  const { state, saveCreds } = await useMultiFileAuthState(sessionPath)

  sock[session] = makeWASocket({
    auth: state,
    version,
    printQRInTerminal: true,
  })
  store[session].bind(sock[session].ev)

  sock[session].ev.on('creds.update', saveCreds)

  sock[session].ev.on('connection.update', async (update: any) => {
    const { connection, lastDisconnect } = update
    if (connection === 'close') {
      sockReady[session] = false
      if (Boom.boomify(lastDisconnect.error).output.statusCode == 401) {
        await fs.rmdir(sessionPath, { recursive: true })
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
      const media = await uploadMedia({
        name: 'image',
        mimeType: m.messages[0].message.imageMessage.mimetype,
        buffer,
      })
      publishedMessage.messages[0].message.imageMessage['id'] = media.id
    } else if (m.messages[0].message.videoMessage) {
      const buffer = await downloadMediaMessage(m.messages[0], 'buffer', {})
      const media = await uploadMedia({
        name: 'video',
        mimeType: m.messages[0].message.videoMessage.mimetype,
        buffer,
      })
      publishedMessage.messages[0].message.videoMessage['id'] = media.id
    } else if (m.messages[0].message.documentWithCaptionMessage) {
      const buffer = await downloadMediaMessage(m.messages[0], 'buffer', {})
      const media = await uploadMedia({
        name: m.messages[0].message.documentWithCaptionMessage.message
          .documentMessage.fileName,
        mimeType:
          m.messages[0].message.documentWithCaptionMessage.message
            .documentMessage.mimetype,
        buffer,
      })
      publishedMessage.messages[0].message.documentWithCaptionMessage.message.documentMessage[
        'id'
      ] = media.id
    }
    const nc = await connect({
      servers: NATS_SERVERS,
      token: NATS_TOKEN,
    })
    const js = nc.jetstream()
    const sc = StringCodec()
    await js.publish(
      `events.ncbaileys.${session}.messages_received`,
      sc.encode(JSON.stringify(publishedMessage)),
    )
    await nc.close()
  })
}
