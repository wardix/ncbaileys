import { Context } from 'hono'
import axios from 'axios'
import { v4 as uuidv4 } from 'uuid'
import path from 'path'
import fs from 'fs/promises'
import {
  LOG_DIR,
  MEDIA_BASE_URL,
  SEND_RESPONSE_TEMPLATE,
  TYPING_MAX_MS,
  TYPING_MIN_MS,
  TYPING_MS_PER_CHAR,
} from './config'
import { sock, sockReady } from './socket.service'
import { uploadMedia } from './utils'
import { loadMessage } from './valkey-mongo-store'

const PRESENCE_TYPES = [
  'available',
  'unavailable',
  'composing',
  'recording',
  'paused',
]

function toJid(to: string) {
  return to.endsWith('@g.us') ? to : `${to}@s.whatsapp.net`
}

// Show "typing..." to the recipient for a duration based on text length.
// Failures are only logged so they never block sending the message.
async function simulateTyping(phoneId: string, to: string, text = '') {
  if (TYPING_MAX_MS <= 0) {
    return
  }
  const duration = Math.min(
    Math.max(text.length * TYPING_MS_PER_CHAR, TYPING_MIN_MS),
    TYPING_MAX_MS,
  )
  try {
    await sock[phoneId].presenceSubscribe(to)
    await sock[phoneId].sendPresenceUpdate('composing', to)
    await new Promise((resolve) => setTimeout(resolve, duration))
    await sock[phoneId].sendPresenceUpdate('paused', to)
  } catch (error) {
    console.log('Error sending typing presence: ', error)
  }
}

export async function postPresence(c: Context) {
  const phoneId = c.req.param('phoneId')
  if (!sockReady[phoneId]) {
    return c.json({ message: 'socket is not ready' }, 500)
  }
  const payload = await c.req.json()
  if (!PRESENCE_TYPES.includes(payload.type)) {
    return c.json(
      { message: `type must be one of: ${PRESENCE_TYPES.join(', ')}` },
      400,
    )
  }
  const isChatPresence = ['composing', 'recording', 'paused'].includes(
    payload.type,
  )
  if (isChatPresence && !payload.to) {
    return c.json({ message: `to is required for type ${payload.type}` }, 400)
  }
  const to = payload.to ? toJid(payload.to) : undefined
  try {
    if (isChatPresence) {
      await sock[phoneId].presenceSubscribe(to!)
    }
    await sock[phoneId].sendPresenceUpdate(payload.type, to)
  } catch (error) {
    console.log('Error sending presence: ', error)
    return c.json({ message: 'Failed to send presence' }, 500)
  }
  return c.json({ success: true })
}

export async function getMediaUrl(c: Context) {
  const mediaId = c.req.param('mediaId')
  try {
    const response = await axios.get(
      `${MEDIA_BASE_URL}/${mediaId}/${mediaId}.json`,
    )
    return c.json(response.data)
  } catch (error) {
    console.log('Error fetching media: ', error)
    return c.json({ message: 'Failed to fetch media' }, 500)
  }
}

export async function postMedia(c: Context) {
  const formData = await c.req.formData()
  const fileData = formData.get('file') as File
  const media = await uploadMedia({
    name: fileData.name,
    mimeType: fileData.type,
    buffer: Buffer.from(await fileData.arrayBuffer()),
  })
  return c.json(media)
}

export async function postMessage(c: Context) {
  const uuid = uuidv4()
  const timestamp = new Date().getTime()
  const phoneId = c.req.param('phoneId')

  const headerFilePath = path.join(
    LOG_DIR,
    `${phoneId}-header-${timestamp}-${uuid}.txt`,
  )
  const bodyFilePath = path.join(
    LOG_DIR,
    `${phoneId}-request-body-${timestamp}-${uuid}.txt`,
  )

  const headers: any = {}
  for (const [header, value] of c.req.raw.headers) {
    headers[header] = value
  }
  await fs.writeFile(
    headerFilePath,
    Buffer.from(JSON.stringify(headers, null, 2)),
  )

  const bodyBuffer = await c.req.arrayBuffer()
  await fs.writeFile(bodyFilePath, Buffer.from(bodyBuffer))

  if (!sockReady[phoneId]) {
    return c.json({ message: 'socket is not ready' }, 500)
  }

  const payload = await c.req.json()
  let sent = null
  let quoted = null
  const to = toJid(payload.to)
  if (payload.context?.message_id) {
    quoted = await loadMessage(to, payload.context.message_id)
  }
  if (payload.typing !== false) {
    const typingText =
      payload.text?.body ??
      payload.image?.caption ??
      payload.video?.caption ??
      payload.document?.caption
    await simulateTyping(phoneId, to, typingText)
  }
  if (payload.type == 'text') {
    if (quoted) {
      console.log('quoted message:')
      console.log(JSON.stringify(quoted, null, 2))
      console.log('-- eof quoted message --')
      sent = await sock[phoneId].sendMessage(
        to,
        {
          text: payload.text.body,
        },
        { quoted },
      )
    } else {
      sent = await sock[phoneId].sendMessage(to, {
        text: payload.text.body,
      })
    }
  } else if (payload.type == 'image') {
    const mediaId = payload.image.id
    try {
      const mediaUrlResponse = await axios.get(
        `${MEDIA_BASE_URL}/${mediaId}/${mediaId}.json`,
      )
      const mediaResponse = await axios.get(mediaUrlResponse.data.url, {
        responseType: 'arraybuffer',
      })
      if (quoted) {
        sent = await sock[phoneId].sendMessage(
          `${payload.to}@s.whatsapp.net`,
          {
            image: Buffer.from(mediaResponse.data),
            caption: payload.image.caption,
          },
          { quoted },
        )
      } else {
        sent = await sock[phoneId].sendMessage(to, {
          image: Buffer.from(mediaResponse.data),
          caption: payload.image.caption,
        })
      }
    } catch (error) {
      console.log('Error fetching media: ', error)
      return c.json({ message: 'Failed to fetch media' }, 500)
    }
  } else if (payload.type == 'video') {
    const mediaId = payload.video.id
    try {
      const mediaUrlResponse = await axios.get(
        `${MEDIA_BASE_URL}/${mediaId}/${mediaId}.json`,
      )
      const mediaResponse = await axios.get(mediaUrlResponse.data.url, {
        responseType: 'arraybuffer',
      })
      if (quoted) {
        sent = await sock[phoneId].sendMessage(
          `${payload.to}@s.whatsapp.net`,
          {
            video: Buffer.from(mediaResponse.data),
            caption: payload.video.caption,
            gifPlayback: true,
          },
          { quoted },
        )
      } else {
        sent = await sock[phoneId].sendMessage(to, {
          video: Buffer.from(mediaResponse.data),
          caption: payload.video.caption,
          gifPlayback: true,
        })
      }
    } catch (error) {
      console.log('Error fetching media: ', error)
      return c.json({ message: 'Failed to fetch media' }, 500)
    }
  } else if (payload.type == 'document') {
    const mediaId = payload.document.id
    try {
      const mediaUrlResponse = await axios.get(
        `${MEDIA_BASE_URL}/${mediaId}/${mediaId}.json`,
      )
      const mediaResponse = await axios.get(mediaUrlResponse.data.url, {
        responseType: 'arraybuffer',
      })
      if (quoted) {
        sent = await sock[phoneId].sendMessage(
          to,
          {
            document: Buffer.from(mediaResponse.data),
            caption: payload.document.caption,
            fileName: payload.document.filename,
          },
          { quoted },
        )
      } else {
        sent = await sock[phoneId].sendMessage(to, {
          document: Buffer.from(mediaResponse.data),
          caption: payload.document.caption,
          fileName: payload.document.filename,
        })
      }
    } catch (error) {
      console.log('Error fetching media: ', error)
      return c.json({ message: 'Failed to fetch media' }, 500)
    }
  } else {
    return c.json({ message: 'unable to proceed' }, 402)
  }

  const response = JSON.parse(SEND_RESPONSE_TEMPLATE)
  response.contacts[0].input = payload.to
  response.contacts[0].wa_id = payload.to
  response.messages[0].id = sent.key.id

  console.log(sent)
  console.log(response)
  return c.json(response)
}
