import {
  fetchLatestBaileysVersion,
  makeWASocket,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys'
import { SESSION_DIR } from './config'

import * as Boom from '@hapi/boom'
import fs from 'fs/promises'
import path from 'path'

async function main() {
  const phone = process.argv[2]

  if (!phone) {
    console.log('node wa-sign.js WAAccount')
    process.exit()
  }
  const { error, version } = await fetchLatestBaileysVersion()
  if (error) {
    console.log(`session: ${phone} | No connection, check your internet`)
    process.exit()
  }

  const sessionPath = path.join(SESSION_DIR, phone)
  await fs.mkdir(sessionPath, { recursive: true })

  const { state, saveCreds } = await useMultiFileAuthState(sessionPath)

  const sock = makeWASocket({
    auth: state,
    version,
    printQRInTerminal: true,
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async (update: any) => {
    const { connection, lastDisconnect } = update
    if (connection === 'close') {
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
        setTimeout(() => main(), shouldReconnect)
      }
    } else if (connection === 'open') {
      console.log('Opened connection')
      process.exit()
    }
  })
}

main()
