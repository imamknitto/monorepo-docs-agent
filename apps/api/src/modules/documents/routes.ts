import { Hono } from 'hono'
import { DOC_ID_RE, CONVERTER_URL, CONVERTER_API_KEY } from '../../config.js'
import { converterClient } from '../converter/client.js'
import { deleteDocCascade } from './store.js'

const documentsRoutes = new Hono()

function passThrough(res: Response): Response {
  const headers = new Headers()
  for (const key of ['content-type', 'content-length', 'content-disposition']) {
    const v = res.headers.get(key)
    if (v) headers.set(key, v)
  }
  return new Response(res.body, { status: res.status, headers })
}

/** List all converted documents */
documentsRoutes.get('/documents', async (c) => {
  let res: Response
  try {
    res = await converterClient.listDocuments()
  } catch {
    return c.json({ detail: 'Conversion service unavailable.' }, 502)
  }
  return passThrough(res)
})

/** Download markdown file */
documentsRoutes.get('/download/:docId', async (c) => {
  const docId = c.req.param('docId')
  if (!DOC_ID_RE.test(docId)) return c.json({ detail: 'Invalid doc_id.' }, 400)
  let res: Response
  try {
    res = await converterClient.download(docId)
  } catch {
    return c.json({ detail: 'Conversion service unavailable.' }, 502)
  }
  if (res.status === 404) return c.json({ detail: 'Markdown not found / expired.' }, 404)
  return passThrough(res)
})

/** Delete document (converter artifacts + gateway state) */
documentsRoutes.delete('/documents/:docId', async (c) => {
  const docId = c.req.param('docId')
  if (!DOC_ID_RE.test(docId)) return c.json({ detail: 'Invalid doc_id.' }, 400)
  let upstreamStatus = 200
  try {
    const res = await converterClient.deleteDoc(docId)
    upstreamStatus = res.status
  } catch {
    // converter may be down; still clean local state
  }
  try {
    await deleteDocCascade(docId)
  } catch (err) {
    console.warn('cascade delete failed', err)
  }
  if (upstreamStatus === 404) {
    return c.json({ doc_id: docId, deleted: true, converter: 'not-found' })
  }
  return c.json({ doc_id: docId, deleted: true })
})

/** Proxy static artifacts (images/doc.md) from the converter.
 *  The converter mounts these at `/public/*` (outside /v1), so the gateway
 *  exposes the same path so markdown image URLs keep working.
 */
const publicRoutes = new Hono()

publicRoutes.get('/public/*', async (c) => {
  const rest = c.req.path.replace(/^\/public\//, '')
  if (!rest || rest.includes('..')) return c.json({ detail: 'Not found.' }, 404)
  try {
    const res = await fetch(`${CONVERTER_URL}/public/${rest}`, {
      headers: { Authorization: `Bearer ${CONVERTER_API_KEY ?? ''}` },
    })
    if (res.status === 404) return c.json({ detail: 'Not found.' }, 404)
    return passThrough(res)
  } catch {
    return c.json({ detail: 'Conversion service unavailable.' }, 502)
  }
})

export { documentsRoutes, publicRoutes }