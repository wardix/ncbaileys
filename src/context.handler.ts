import { Context } from 'hono'
import axios from 'axios'
import { v4 as uuidv4 } from 'uuid'
import FormData from 'form-data'
import path from 'path'
import fs from 'fs/promises'
import { base64urlDecode, base64urlEncode } from './utils'
import {
  DEFAULT_SESSION,
  LOG_DIR,
  META_MEDIA_BASE_URL,
  META_MEDIA_TOKEN,
  META_UPLOAD_MEDIA_URL,
  PROXY_MEDIA_BASE_URL,
  SEND_RESPONSE_TEMPLATE,
} from './config'
import { sock, sockReady } from './socket.service'

export async function getMediaUrl(c: Context) {
  const mediaId = c.req.param('mediaId')
  try {
    const response = await axios.get(`${META_MEDIA_BASE_URL}/${mediaId}`, {
      headers: {
        Authorization: `Bearer ${META_MEDIA_TOKEN}`,
      },
    })
    const data = response.data
    data.url = `${PROXY_MEDIA_BASE_URL}/${base64urlEncode(response.data.url)}`
    return c.json(data)
  } catch (error) {
    console.log('Error fetching media: ', error)
    return c.json({ message: 'Failed to fetch media' }, 500)
  }
}

export async function getProxyUrl(c: Context) {
  const url = base64urlDecode(c.req.param('url'))

  try {
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${META_MEDIA_TOKEN}`,
      },
      responseType: 'arraybuffer',
    })

    const arrayBuffer = response.data
    return c.body(arrayBuffer, 200)
  } catch (error) {
    return c.text('Failed to proxy request', 502)
  }
}

export async function postMedia(c: Context) {
  const formData = await c.req.formData()
  const fileData = formData.get('file') as File
  const messagingProduct = formData.get('messaging_product')
  const fileBuffer = Buffer.from(await fileData.arrayBuffer())

  const upstreamFormData = new FormData()
  upstreamFormData.append('type', fileData.type)
  upstreamFormData.append('messaging_product', messagingProduct)
  upstreamFormData.append('file', fileBuffer, {
    filename: fileData.name,
    contentType: fileData.type,
  })

  try {
    const response = await axios.post(`${META_UPLOAD_MEDIA_URL}`, formData, {
      headers: {
        Authorization: `Bearer ${META_MEDIA_TOKEN}`,
        ...upstreamFormData.getHeaders(),
      },
    })
    return c.json(response.data)
  } catch (error) {
    console.log('Error uploading media: ', error)
    return c.json({ message: 'Failed to upload media' }, 500)
  }
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

  if (!sockReady[DEFAULT_SESSION]) {
    return c.json({ message: 'socket is not ready' }, 500)
  }

  const payload = await c.req.json()
  let sent = null
  if (payload.type == 'text') {
    sent = await sock[DEFAULT_SESSION].sendMessage(
      `${payload.to}@s.whatsapp.net`,
      {
        text: payload.text.body,
      },
    )
  } else if (payload.type == 'image') {
    const mediaId = payload.image.id
    try {
      const mediaUrlResponse = await axios.get(
        `${META_MEDIA_BASE_URL}/${mediaId}`,
        {
          headers: {
            Authorization: `Bearer ${META_MEDIA_TOKEN}`,
          },
        },
      )
      const mediaResponse = await axios.get(mediaUrlResponse.data.url, {
        headers: {
          Authorization: `Bearer ${META_MEDIA_TOKEN}`,
        },
        responseType: 'arraybuffer',
      })
      sent = await sock[DEFAULT_SESSION].sendMessage(
        `${payload.to}@s.whatsapp.net`,
        {
          image: Buffer.from(mediaResponse.data),
          caption: payload.image.caption,
        },
      )
    } catch (error) {
      console.log('Error fetching media: ', error)
      return c.json({ message: 'Failed to fetch media' }, 500)
    }
  } else if (payload.type == 'video') {
    const mediaId = payload.video.id
    try {
      const mediaUrlResponse = await axios.get(
        `${META_MEDIA_BASE_URL}/${mediaId}`,
        {
          headers: {
            Authorization: `Bearer ${META_MEDIA_TOKEN}`,
          },
        },
      )
      const mediaResponse = await axios.get(mediaUrlResponse.data.url, {
        headers: {
          Authorization: `Bearer ${META_MEDIA_TOKEN}`,
        },
        responseType: 'arraybuffer',
      })
      sent = await sock[DEFAULT_SESSION].sendMessage(
        `${payload.to}@s.whatsapp.net`,
        {
          video: Buffer.from(mediaResponse.data),
          caption: payload.video.caption,
          gifPlayback: true,
        },
      )
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
