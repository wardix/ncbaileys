import { Context } from 'hono'
import axios from 'axios'
import { v4 as uuidv4 } from 'uuid'
import path from 'path'
import fs from 'fs/promises'
import { LOG_DIR, MEDIA_BASE_URL, SEND_RESPONSE_TEMPLATE } from './config'
import { sock, sockReady, store } from './socket.service'
import { uploadMedia } from './utils'

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
  if (payload.type == 'text') {
    if (payload.context?.message_id) {
      const quoted = await store[phoneId].loadMessage(
        `${payload.to}@s.whatsapp.net`,
        payload.context.message_id,
      )
      sent = await sock[phoneId].sendMessage(
        `${payload.to}@s.whatsapp.net`,
        {
          text: payload.text.body,
        },
        { quoted },
      )
    } else {
      sent = await sock[phoneId].sendMessage(`${payload.to}@s.whatsapp.net`, {
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
      sent = await sock[phoneId].sendMessage(`${payload.to}@s.whatsapp.net`, {
        image: Buffer.from(mediaResponse.data),
        caption: payload.image.caption,
      })
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
      sent = await sock[phoneId].sendMessage(`${payload.to}@s.whatsapp.net`, {
        video: Buffer.from(mediaResponse.data),
        caption: payload.video.caption,
        gifPlayback: true,
      })
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
      sent = await sock[phoneId].sendMessage(`${payload.to}@s.whatsapp.net`, {
        document: Buffer.from(mediaResponse.data),
        caption: payload.document.caption,
        fileName: payload.document.filename,
      })
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
