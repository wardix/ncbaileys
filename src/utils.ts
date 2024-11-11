import path from 'path'
import fs from 'fs/promises'
import { extension } from 'mime-types'
import crypto from 'crypto'
import { MEDIA_BASE_URL, MEDIA_DIR } from './config'

export async function uploadMedia({ name, mimeType, buffer }: any) {
  let mediaId = Date.now()
  const mediaFileName =
    path.extname(name) === '' ? `${name}.${extension(mimeType)}` : name
  let storeDir = ''
  while (true) {
    if (`${mediaId}.json` === mediaFileName) {
      mediaId++
      continue
    }
    storeDir = path.join(MEDIA_DIR, `${mediaId}`)
    try {
      await fs.access(storeDir)
    } catch (err) {
      await fs.mkdir(storeDir, { recursive: true })
      break
    }
    mediaId++
  }
  const mediaFilePath = path.join(storeDir, mediaFileName)
  const metaFilePath = path.join(storeDir, `${mediaId}.json`)
  await fs.writeFile(mediaFilePath, buffer)
  await fs.writeFile(
    metaFilePath,
    Buffer.from(
      JSON.stringify(
        {
          messaging_product: 'whatsapp',
          url: `${MEDIA_BASE_URL}/${mediaId}/${encodeURIComponent(mediaFileName)}`,
          mime_type: mimeType,
          sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
          file_size: buffer.length,
        },
        null,
        2,
      ),
    ),
  )
  return { id: `${mediaId}` }
}
