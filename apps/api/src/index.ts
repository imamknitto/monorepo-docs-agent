import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { cors } from 'hono/cors'
import { requestId } from 'hono/request-id'
import 'dotenv/config'
import { serve } from '@hono/node-server'
import { askDoc, NotImplementedError } from '@markitdown/agent'
import {
  CONVERTER_URL,
  DOC_ID_RE,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_MB,
  converterHeaders,
} from './config.js'
import { rateLimit } from './middleware/rateLimit.js'

const app = new Hono()

app.use('*', requestId())
app.use(
  '*',
  cors({ origin: (process.env.PLATFORM_URL ?? 'http://127.0.0.1:5173').split(',') }),
)
app.use('*', rateLimit)
app.use('/convert', bodyLimit({ maxSize: MAX_UPLOAD_BYTES + 1024 * 1024 }))

async function converterOk(): Promise<boolean> {
  try {
    const res = await fetch(`${CONVERTER_URL}/health`, { signal: AbortSignal.timeout(5000) })
    return res.ok
  } catch {
    return false
  }
}

app.get('/health', async (c) => {
  const converter = await converterOk()
  return c.json({
    status: converter ? 'ok' : 'degraded',
    service: 'api-gateway',
    converter: converter ? 'ok' : 'unreachable',
  })
})

/** Stream a converter response back, preserving status + content headers. */
function passThrough(res: Response): Response {
  const headers = new Headers()
  for (const key of ['content-type', 'content-length', 'content-disposition']) {
    const v = res.headers.get(key)
    if (v) headers.set(key, v)
  }
  return new Response(res.body, { status: res.status, headers })
}

app.post('/convert', async (c) => {
  const requestIdHeader = c.get('requestId') as string | undefined
  let form: FormData
  try {
    form = await c.req.formData()
  } catch {
    return c.json({ detail: 'Invalid multipart body.' }, 400)
  }
  const file = form.get('file')
  const scanImages = form.get('scan_images')
  if (!(file instanceof File)) return c.json({ detail: 'Field "file" is required.' }, 422)
  if (!file.name.toLowerCase().endsWith('.pdf')) {
    return c.json({ detail: 'v1 only supports PDF files.' }, 400)
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return c.json({ detail: `File exceeds the ${MAX_UPLOAD_MB} MB limit.` }, 413)
  }

  const out = new FormData()
  out.append('file', file, file.name)
  out.append('scan_images', String(scanImages === 'true' || scanImages === 'on'))

  let res: Response
  try {
    res = await fetch(
      `${CONVERTER_URL}/convert`,
      {
        method: 'POST',
        headers: converterHeaders(undefined, requestIdHeader),
        body: out,
      },
    )
  } catch (err) {
    console.error('converter unreachable', err)
    return c.json({ detail: 'Conversion service unavailable.' }, 502)
  }
  if (res.status >= 500) {
    console.error('converter error', res.status)
    return c.json({ detail: 'Conversion failed upstream.' }, 502)
  }
  return passThrough(res)
})

app.get('/download/:docId', async (c) => {
  const docId = c.req.param('docId')
  if (!DOC_ID_RE.test(docId)) return c.json({ detail: 'Invalid doc_id.' }, 404)
  try {
    const res = await fetch(
      `${CONVERTER_URL}/download/${docId}`,
      { headers: converterHeaders() },
    )
    if (res.status === 404) return c.json({ detail: 'Markdown not found / expired.' }, 404)
    return passThrough(res)
  } catch {
    return c.json({ detail: 'Conversion service unavailable.' }, 502)
  }
})

app.get('/public/*', async (c) => {
  const rest = c.req.path.replace(/^\/public\//, '')
  if (!rest || rest.includes('..')) return c.json({ detail: 'Not found.' }, 404)
  try {
    const res = await fetch(`${CONVERTER_URL}/public/${rest}`, {
      headers: converterHeaders(),
    })
    if (res.status === 404) return c.json({ detail: 'Not found.' }, 404)
    return passThrough(res)
  } catch {
    return c.json({ detail: 'Conversion service unavailable.' }, 502)
  }
})

app.post('/v1/ask', async (c) => {
  const body = await c.req.json().catch(() => null)
  const docId = body?.docId
  const question = body?.question
  if (typeof docId !== 'string' || typeof question !== 'string') {
    return c.json({ detail: 'Fields "docId" and "question" are required.' }, 422)
  }
  try {
    const result = await askDoc({ docId, question })
    return c.json(result)
  } catch (err) {
    if (err instanceof NotImplementedError) {
      return c.json({ error: 'not-implemented', hint: 'RAG over doc_id lands here next.' }, 501)
    }
    throw err
  }
})

const port = Number(process.env.PORT ?? 8000)
console.log(`api-gateway listening on :${port} (converter: ${CONVERTER_URL})`)
serve({ fetch: app.fetch, port })
