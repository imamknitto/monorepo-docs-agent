import { Hono } from 'hono'
import { DOC_ID_RE } from '../../config.js'
import { deleteArtifact, listArtifacts, readPublicFile } from './artifacts.js'
import { deleteDocCascade } from './store.js'

function bodyBytes(body: Buffer): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(body.byteLength)
  bytes.set(body)
  return bytes
}

const documentsRoutes = new Hono()

/** List converted documents stored on this API. */
documentsRoutes.get('/documents', async (c) => {
  const documents = await listArtifacts()
  return c.json({ documents })
})

/** Download markdown file */
documentsRoutes.get('/download/:docId', async (c) => {
  const docId = c.req.param('docId')
  if (!DOC_ID_RE.test(docId)) return c.json({ detail: 'Invalid doc_id.' }, 400)
  const file = await readPublicFile(`${docId}/doc.md`)
  if (!file) return c.json({ detail: 'Markdown not found / expired.' }, 404)
  return new Response(bodyBytes(file.body), {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'content-disposition': `attachment; filename="${docId}.md"`,
    },
  })
})

/** Delete document artifacts and gateway state. */
documentsRoutes.delete('/documents/:docId', async (c) => {
  const docId = c.req.param('docId')
  if (!DOC_ID_RE.test(docId)) return c.json({ detail: 'Invalid doc_id.' }, 400)
  await deleteArtifact(docId)
  try {
    await deleteDocCascade(docId)
  } catch (err) {
    console.warn('cascade delete failed', err)
  }
  return c.json({ doc_id: docId, deleted: true })
})

/** Serve stored markdown and images at the URLs embedded in the markdown. */
const publicRoutes = new Hono()

publicRoutes.get('/public/*', async (c) => {
  const rest = c.req.path.replace(/^\/public\//, '')
  if (!rest || rest.includes('..')) return c.json({ detail: 'Not found.' }, 404)
  const file = await readPublicFile(rest)
  if (!file) return c.json({ detail: 'Not found.' }, 404)
  return new Response(bodyBytes(file.body), {
    headers: { 'content-type': file.contentType },
  })
})

export { documentsRoutes, publicRoutes }
