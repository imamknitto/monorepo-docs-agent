import { Hono } from 'hono'
import { DOC_ID_RE } from '../../config.js'
import { getDocStatus } from '../documents/store.js'
import { getDocumentQueue } from '../../config/queue.js'
import { getPrisma } from '../../utils/prisma.js'

const debugRoutes = new Hono()

/** Document indexing status */
debugRoutes.get('/status/:docId', async (c) => {
  const docId = c.req.param('docId')
  if (!DOC_ID_RE.test(docId)) return c.json({ detail: 'Invalid doc_id.' }, 400)
  const status = await getDocStatus(docId)
  if (!status.found) return c.json({ docId, found: false, indexed: false, pages: 0, summary: null })
  return c.json({
    docId,
    found: true,
    indexed: status.isProcessed,
    pages: status.pages,
    summary: status.summary,
  })
})

/**
 * Debug endpoint: tells you WHICH indexing stage is stuck.
 * GET /v1/debug/:docId → { doc, queue, env }
 * - doc: row in Postgres (missing = upsertPendingDoc never ran / DATABASE_URL unset)
 * - queue: BullMQ job state (null when Redis unavailable; failedReason = worker error)
 * - env: which infra is configured
 */
debugRoutes.get('/debug/:docId', async (c) => {
  const docId = c.req.param('docId')
  if (!DOC_ID_RE.test(docId)) return c.json({ detail: 'Invalid doc_id.' }, 400)
  const prisma = getPrisma()
  let doc: unknown = null
  if (prisma) {
    try {
      doc = await prisma.document.findUnique({
        where: { id: docId },
        select: {
          id: true,
          name: true,
          markdownUrl: true,
          isProcessed: true,
          createdAt: true,
          _count: { select: { pages: true } },
        },
      })
    } catch (err) {
      doc = { error: err instanceof Error ? err.message : String(err) }
    }
  }
  let queue: unknown = null
  try {
    const q = getDocumentQueue()
    if (!q) {
      queue = { available: false, hint: 'Redis queue unavailable — check REDIS_URL and that Redis is running' }
    } else {
      const jobs = await q.getJobs(['waiting', 'active', 'delayed', 'failed', 'completed'], 0, 20)
      const mine = jobs.filter((j) => (j.data.docId ?? j.data.id) === docId)
      queue = {
        available: true,
        jobs: await Promise.all(
          mine.map(async (j) => ({
            id: j.id,
            name: j.name,
            state: await j.getState().catch(() => 'unknown'),
            attemptsMade: j.attemptsMade,
            failedReason: j.failedReason ?? null,
            timestamp: j.timestamp,
            processedOn: j.processedOn ?? null,
            finishedOn: j.finishedOn ?? null,
          })),
        ),
      }
    }
  } catch (err) {
    queue = { available: false, error: err instanceof Error ? err.message : String(err) }
  }
  return c.json({
    docId,
    doc,
    queue,
    env: {
      hasDatabase: Boolean(process.env.DATABASE_URL),
      redisUrl: (process.env.REDIS_URL ?? '').replace(/:[^:@/]+@/, ':***@'),
      qdrantUrl: process.env.QDRANT_URL ?? '',
      hasOpenAI: Boolean(process.env.OPENAI_API_KEY),
      embeddingModel: process.env.EMBEDDING_MODEL ?? 'Xenova/all-MiniLM-L6-v2',
    },
    hint: 'doc=null → POST /convert never recorded (check api logs [index:enqueue]). queue.jobs empty → job lost before Redis. failedReason set → worker error at that stage. doc.isProcessed=false + job completed → db-write failed.',
  })
})

export { debugRoutes }