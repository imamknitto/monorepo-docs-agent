import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { cors } from 'hono/cors'
import { requestId } from 'hono/request-id'
import { serve } from '@hono/node-server'
import { Agent } from 'undici'
import { IndexingError, NotConfiguredError } from '@halodocs/agent'
import {
  CONVERT_TIMEOUT_MS,
  CONVERTER_URL,
  DOC_ID_RE,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_MB,
  USER_ID_RE,
  converterHeaders,
  parseSessionId,
} from './config.js'
import { rateLimit } from './middleware/rateLimit.js'
import { getDocumentQueue } from './config/queue.js'
import { getPrisma } from './utils/prisma.js'
import { deleteDocCascade, getDocStatus, upsertPendingDoc } from './modules/documents/store.js'
import { clearHistory, loadUiHistory, retrievePages, streamAnswer } from './modules/chat/service.js'
import { toCitations } from '@halodocs/agent'

const app = new Hono()

app.use('*', requestId())
app.use(
  '*',
  cors({
    origin: (
      process.env.PLATFORM_URL ??
      'http://127.0.0.1:8378,http://localhost:8378,http://127.0.0.1:8380,http://localhost:8380'
    ).split(','),
    allowHeaders: ['Content-Type', 'Authorization', 'x-user-id'],
  }),
)
app.use('*', rateLimit)
app.use('/convert', bodyLimit({ maxSize: MAX_UPLOAD_BYTES + 1024 * 1024 }))

/**
 * Dispatcher for converter calls. The converter only sends response headers
 * AFTER the (minutes-long, CPU-bound) conversion finishes, so undici's
 * default headers/body timeouts must be raised to match CONVERT_TIMEOUT_MS.
 * The AbortSignal.timeout on each call is the overall cap.
 */
const converterDispatcher = new Agent({
  connectTimeout: 10_000,
  headersTimeout: CONVERT_TIMEOUT_MS,
  bodyTimeout: CONVERT_TIMEOUT_MS,
})

async function converterHealth(): Promise<{
  reachable: boolean
  version?: string
}> {
  try {
    const res = await fetch(`${CONVERTER_URL}/health`, {
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return { reachable: false }
    const body = (await res.json().catch(() => null)) as {
      version?: string
    } | null
    return { reachable: true, version: body?.version }
  } catch {
    return { reachable: false }
  }
}

const startedAt = Date.now()

app.get('/health/live', (c) => c.json({ status: 'ok', service: 'api-gateway' }))

app.get('/health/ready', async (c) => {
  const converter = await converterHealth()
  const ready = converter.reachable
  return c.json(
    {
      status: ready ? 'ok' : 'not-ready',
      service: 'api-gateway',
      uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
      converter: converter.reachable
        ? { status: 'ok', version: converter.version ?? 'unknown' }
        : { status: 'unreachable' },
    },
    ready ? 200 : 503,
  )
})

app.get('/health', async (c) => {
  const converter = await converterHealth()
  return c.json({
    status: converter.reachable ? 'ok' : 'degraded',
    service: 'api-gateway',
    uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
    converter: converter.reachable
      ? { status: 'ok', version: converter.version ?? 'unknown' }
      : { status: 'unreachable' },
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

function ndjsonResponse(gen: AsyncGenerator<unknown>): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of gen) {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
        }
      } catch (err) {
        controller.enqueue(
          encoder.encode(
            `${JSON.stringify({ type: 'error', message: err instanceof Error ? err.message : 'stream failed' })}\n`,
          ),
        )
      } finally {
        controller.close()
      }
    },
  })
  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-cache',
      'x-accel-buffering': 'no',
    },
  })
}

/** Record a converted doc + enqueue indexing. Idempotent: skips queueing twice. */
async function enqueueIndexing(
  docId: string,
  name: string,
  markdownUrl: string | null,
  stats: unknown,
  reqId?: string,
): Promise<void> {
  if (!DOC_ID_RE.test(docId)) {
    console.warn(`[index:enqueue] skipped: invalid doc_id=${docId} req=${reqId ?? '-'}`)
    return
  }
  // Async jobs are polled repeatedly — don't enqueue twice.
  try {
    const existing = await getDocStatus(docId)
    if (existing.found) return
  } catch {
    /* status check best-effort; fall through to upsert */
  }
  try {
    const ok = await upsertPendingDoc({
      docId,
      name,
      markdownUrl,
      stats: stats ?? {},
    })
    console.log(
      `[index:enqueue] doc=${docId} upsert=${ok ? 'ok' : 'SKIPPED(no DATABASE_URL)'} markdownUrl=${markdownUrl ?? '(null)'}`,
    )
    const queue = getDocumentQueue()
    if (!queue) {
      console.error(
        `[index:enqueue] doc=${docId} FAILED queue unavailable (REDIS_URL invalid/unreachable) — worker will never pick this up`,
      )
    } else {
      try {
        const job = await queue.add('index', { docId, name, markdownUrl })
        console.log(`[index:enqueue] doc=${docId} queued job=${job.id}`)
      } catch (err) {
        console.error(
          `[index:enqueue] doc=${docId} FAILED queue.add err=${err instanceof Error ? err.message : String(err)}`,
          err instanceof Error ? err.stack : '',
        )
      }
    }
  } catch (err) {
    console.warn(
      `[index:enqueue] skipped req=${reqId ?? '-'} err=${err instanceof Error ? err.message : String(err)}`,
      err instanceof Error ? err.stack : '',
    )
  }
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
  const extractImages = form.get('extract_images')
  const ocrImages = form.get('ocr_images')
  const ocrScopeRaw = form.get('ocr_scope')
  const ocrScope = ocrScopeRaw === 'flowchart' ? 'flowchart' : 'all'
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
  out.append(
    'extract_images',
    extractImages === null
      ? 'true'
      : String(extractImages === 'true' || extractImages === 'on'),
  )
  out.append('ocr_images', String(ocrImages === 'true' || ocrImages === 'on'))
  out.append('ocr_scope', ocrScope)

  let res: Response
  const convertStarted = Date.now()
  console.log(
    `[convert] start req=${requestIdHeader ?? '-'} file=${file.name} bytes=${file.size}`,
  )
  try {
    res = await fetch(`${CONVERTER_URL}/convert`, {
      method: 'POST',
      headers: converterHeaders(undefined, requestIdHeader),
      body: out,
      // @ts-expect-error undici dispatcher is supported by node's fetch at runtime
      dispatcher: converterDispatcher,
      signal: AbortSignal.timeout(CONVERT_TIMEOUT_MS),
    })
  } catch (err) {
    const elapsed = Date.now() - convertStarted
    const code =
      (err as { cause?: { code?: string } })?.cause?.code ??
      (err as { code?: string })?.code
    const name = err instanceof Error ? err.name : ''
    const timedOut =
      name === 'TimeoutError' ||
      code === 'UND_ERR_HEADERS_TIMEOUT' ||
      code === 'UND_ERR_BODY_TIMEOUT'
    console.error(
      `converter ${timedOut ? 'timeout' : 'unreachable'} ` +
        `req=${requestIdHeader ?? '-'} file=${file.name} bytes=${file.size} ` +
        `elapsed=${elapsed}ms err=${err instanceof Error ? err.message : String(err)}`,
      err,
    )
    if (timedOut) {
      return c.json(
        {
          detail:
            'Conversion timed out. The file is likely large — retry with async mode or turn off image OCR.',
          code: 'convert_timeout',
        },
        504,
      )
    }
    console.error('converter unreachable', err)
    return c.json({ detail: 'Conversion service unavailable.' }, 502)
  }
  console.log(
    `[convert] upstream req=${requestIdHeader ?? '-'} status=${res.status} elapsed=${Date.now() - convertStarted}ms`,
  )
  if (res.status >= 500) {
    console.error('converter error', res.status)
    return c.json({ detail: 'Conversion failed upstream.' }, 502)
  }

  // Best-effort: record + enqueue indexing without blocking the response.
  if (res.ok) {
    const cloned = res.clone()
    try {
      const meta = (await cloned.json()) as {
        doc_id?: string
        markdown_url?: string | null
        stats?: unknown
      }
      if (meta.doc_id) {
        await enqueueIndexing(
          meta.doc_id,
          file.name,
          meta.markdown_url ?? null,
          meta.stats,
          requestIdHeader,
        )
      }
    } catch (err) {
      console.warn(
        `[index:enqueue] skipped req=${requestIdHeader ?? '-'} err=${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : '',
      )
    }
  }

  return passThrough(res)
})

/**
 * Async conversion: returns 202 immediately, client polls
 * GET /v1/convert/jobs/:jobId. For large PDFs that exceed the sync window.
 */
app.post('/convert/jobs', async (c) => {
  const requestIdHeader = c.get('requestId') as string | undefined
  let form: FormData
  try {
    form = await c.req.formData()
  } catch {
    return c.json({ detail: 'Invalid multipart body.' }, 400)
  }
  const file = form.get('file')
  const scanImages = form.get('scan_images')
  const extractImages = form.get('extract_images')
  const ocrImages = form.get('ocr_images')
  const ocrScopeRaw = form.get('ocr_scope')
  const ocrScope = ocrScopeRaw === 'flowchart' ? 'flowchart' : 'all'
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
  out.append(
    'extract_images',
    extractImages === null
      ? 'true'
      : String(extractImages === 'true' || extractImages === 'on'),
  )
  out.append('ocr_images', String(ocrImages === 'true' || ocrImages === 'on'))
  out.append('ocr_scope', ocrScope)

  console.log(
    `[convert:async] start req=${requestIdHeader ?? '-'} file=${file.name} bytes=${file.size}`,
  )
  let res: Response
  try {
    res = await fetch(`${CONVERTER_URL}/convert/jobs`, {
      method: 'POST',
      headers: converterHeaders(undefined, requestIdHeader),
      body: out,
      // @ts-expect-error undici dispatcher is supported by node's fetch at runtime
      dispatcher: converterDispatcher,
      signal: AbortSignal.timeout(CONVERT_TIMEOUT_MS),
    })
  } catch (err) {
    console.error(
      `[convert:async] converter unreachable req=${requestIdHeader ?? '-'} err=${err instanceof Error ? err.message : String(err)}`,
      err,
    )
    return c.json({ detail: 'Conversion service unavailable.' }, 502)
  }
  if (res.status === 429) {
    return c.json(
      { detail: 'Conversion queue is full, try again shortly.', code: 'convert_queue_full' },
      429,
    )
  }
  if (res.status >= 500) {
    console.error('[convert:async] converter error', res.status)
    return c.json({ detail: 'Conversion failed upstream.' }, 502)
  }
  return new Response(res.body, {
    status: res.status,
    headers: { 'content-type': 'application/json' },
  })
})

app.get('/v1/convert/jobs/:jobId', async (c) => {
  const jobId = c.req.param('jobId')
  if (!DOC_ID_RE.test(jobId)) return c.json({ detail: 'Invalid job id.' }, 404)
  let res: Response
  try {
    res = await fetch(`${CONVERTER_URL}/convert/jobs/${jobId}`, {
      headers: converterHeaders(),
      signal: AbortSignal.timeout(15000),
    })
  } catch {
    return c.json({ detail: 'Conversion service unavailable.' }, 502)
  }
  if (res.status === 404) return c.json({ detail: 'Job not found or expired.' }, 404)
  if (!res.ok) return c.json({ detail: 'Conversion service unavailable.' }, 502)
  const body = (await res.json().catch(() => null)) as {
    job_id?: string
    doc_id?: string
    filename?: string | null
    status?: string
    progress?: { pages_done?: number; pages_total?: number | null } | null
    result?: {
      doc_id?: string
      markdown_url?: string | null
      stats?: unknown
    } | null
    error?: string | null
  } | null
  if (!body) return c.json({ detail: 'Conversion service unavailable.' }, 502)

  // When the job just finished, kick off indexing (idempotent).
  if (body.status === 'done' && body.result?.doc_id) {
    await enqueueIndexing(
      body.result.doc_id,
      typeof body.filename === 'string' && body.filename ? body.filename : 'document',
      body.result.markdown_url ?? null,
      body.result.stats,
    )
  }
  return c.json(body)
})

app.get('/documents', async (c) => {
  try {
    const res = await fetch(`${CONVERTER_URL}/documents`, {
      headers: converterHeaders(),
    })
    return passThrough(res)
  } catch {
    return c.json({ detail: 'Conversion service unavailable.' }, 502)
  }
})

app.delete('/documents/:docId', async (c) => {
  const docId = c.req.param('docId')
  if (!DOC_ID_RE.test(docId)) return c.json({ detail: 'Invalid doc_id.' }, 404)
  let upstreamStatus = 200
  try {
    const res = await fetch(`${CONVERTER_URL}/documents/${docId}`, {
      method: 'DELETE',
      headers: converterHeaders(),
    })
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

app.get('/download/:docId', async (c) => {
  const docId = c.req.param('docId')
  if (!DOC_ID_RE.test(docId)) return c.json({ detail: 'Invalid doc_id.' }, 404)
  try {
    const res = await fetch(`${CONVERTER_URL}/download/${docId}`, {
      headers: converterHeaders(),
    })
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

// ---- RAG: per-document, per-session, per-user (fingerprint) ----

function readUserId(c: { req: { header: (k: string) => string | undefined } }): string | null {
  const raw = c.req.header('x-user-id')?.trim()
  if (!raw || !USER_ID_RE.test(raw)) return null
  return raw
}

app.get('/v1/status/:docId', async (c) => {
  const docId = c.req.param('docId')
  if (!DOC_ID_RE.test(docId)) return c.json({ detail: 'Invalid doc_id.' }, 404)
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
app.get('/v1/debug/:docId', async (c) => {
  const docId = c.req.param('docId')
  if (!DOC_ID_RE.test(docId)) return c.json({ detail: 'Invalid doc_id.' }, 404)
  const { getPrisma } = await import('./utils/prisma.js')
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

app.get('/v1/chat/:docId/:sessionId', async (c) => {
  const docId = c.req.param('docId')
  const sessionId = c.req.param('sessionId')
  const userId = readUserId(c)
  if (!DOC_ID_RE.test(docId)) return c.json({ detail: 'Invalid doc_id.' }, 404)
  const sess = parseSessionId(docId, sessionId)
  if (!sess.ok) return c.json({ detail: sess.detail }, 400)
  if (!userId) return c.json({ detail: 'Missing or invalid x-user-id header.' }, 400)
  try {
    const messages = await loadUiHistory(sessionId, userId)
    return c.json({ sessionId, messages })
  } catch (err) {
    if (err instanceof NotConfiguredError) {
      return c.json({ detail: err.message }, 503)
    }
    throw err
  }
})

app.delete('/v1/chat/:docId/:sessionId', async (c) => {
  const docId = c.req.param('docId')
  const sessionId = c.req.param('sessionId')
  const userId = readUserId(c)
  if (!DOC_ID_RE.test(docId)) return c.json({ detail: 'Invalid doc_id.' }, 404)
  const sess = parseSessionId(docId, sessionId)
  if (!sess.ok) return c.json({ detail: sess.detail }, 400)
  if (!userId) return c.json({ detail: 'Missing or invalid x-user-id header.' }, 400)
  try {
    await clearHistory(sessionId, userId)
    return c.json({ sessionId, cleared: true })
  } catch (err) {
    if (err instanceof NotConfiguredError) {
      return c.json({ detail: err.message }, 503)
    }
    throw err
  }
})

app.post('/v1/chat/:docId/:sessionId', async (c) => {
  const docId = c.req.param('docId')
  const sessionId = c.req.param('sessionId')
  const userId = readUserId(c)
  if (!DOC_ID_RE.test(docId)) return c.json({ detail: 'Invalid doc_id.' }, 404)
  const sess = parseSessionId(docId, sessionId)
  if (!sess.ok) return c.json({ detail: sess.detail }, 400)
  if (!userId) return c.json({ detail: 'Missing or invalid x-user-id header.' }, 400)

  const body = (await c.req.json().catch(() => null)) as { question?: unknown } | null
  const question = typeof body?.question === 'string' ? body.question.trim() : ''
  if (!question) return c.json({ detail: 'Field "question" is required.' }, 422)
  if (question.length > 2000) {
    return c.json({ detail: 'Field "question" exceeds 2000 characters.' }, 422)
  }

  const status = await getDocStatus(docId)
  if (!status.found || !status.isProcessed) {
    return c.json({ detail: 'Document is still indexing, try again shortly.' }, 503)
  }

  try {
    return ndjsonResponse(streamAnswer(docId, sessionId, userId, question, status.summary))
  } catch (err) {
    if (err instanceof NotConfiguredError) return c.json({ detail: err.message }, 503)
    if (err instanceof IndexingError) return c.json({ detail: err.message }, 503)
    throw err
  }
})

app.post('/v1/ask', async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    docId?: unknown
    question?: unknown
    sessionId?: unknown
  } | null
  const docId = typeof body?.docId === 'string' ? body.docId : ''
  const question = typeof body?.question === 'string' ? body.question.trim() : ''
  const sessionId =
    typeof body?.sessionId === 'string' && body.sessionId
      ? body.sessionId
      : `doc:${docId}:s:${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`
  const userId = readUserId(c)
  if (!DOC_ID_RE.test(docId) || !question) {
    return c.json({ detail: 'Fields "docId" and "question" are required.' }, 422)
  }
  if (question.length > 2000) {
    return c.json({ detail: 'Field "question" exceeds 2000 characters.' }, 422)
  }
  if (!userId) return c.json({ detail: 'Missing or invalid x-user-id header.' }, 400)

  const status = await getDocStatus(docId)
  if (!status.found || !status.isProcessed) {
    return c.json({ detail: 'Document is still indexing, try again shortly.' }, 503)
  }

  try {
    const gen = streamAnswer(docId, sessionId, userId, question, status.summary)
    let answer = ''
    let citations = toCitations(await retrievePages(docId, question))
    for await (const event of gen) {
      if (event.type === 'text_delta') answer += event.delta
      else if (event.type === 'citations') citations = event.citations
      else if (event.type === 'error') return c.json({ detail: event.message }, 502)
    }
    return c.json({ answer, citations, sessionId })
  } catch (err) {
    if (err instanceof NotConfiguredError) return c.json({ detail: err.message }, 503)
    if (err instanceof IndexingError) return c.json({ detail: err.message }, 503)
    return c.json({ detail: err instanceof Error ? err.message : 'ask failed' }, 502)
  }
})

const port = Number(process.env.PORT ?? 8377)
console.log(`api-gateway listening on :${port} (converter: ${CONVERTER_URL})`)
serve({ fetch: app.fetch, port })

// ---- Expiry sweep: purge gateway state for docs the converter already dropped ----
// The converter evicts files on its own (PUBLIC_TTL_MINUTES / oversize). Without
// this, Postgres rows + chat sessions + Qdrant points would outlive the files.
// Skips silently when the converter is unreachable (never purge blind) or no DB.
const SWEEP_INTERVAL_MS = Number(process.env.INDEX_SWEEP_MINUTES ?? 5) * 60 * 1000

async function sweepExpiredDocs(): Promise<void> {
  const prisma = getPrisma()
  if (!prisma) return
  let live: Set<string>
  try {
    const res = await fetch(`${CONVERTER_URL}/documents`, {
      headers: converterHeaders(),
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) {
      console.warn(`[index:sweep] skipped: converter status=${res.status}`)
      return
    }
    const body = (await res.json()) as { documents?: { doc_id?: string }[] }
    live = new Set(
      (body.documents ?? []).map((d) => d.doc_id).filter((id): id is string => Boolean(id)),
    )
  } catch (err) {
    console.warn(
      `[index:sweep] skipped: converter unreachable err=${err instanceof Error ? err.message : String(err)}`,
    )
    return
  }
  let rows: { id: string }[]
  try {
    rows = await prisma.document.findMany({ select: { id: true } })
  } catch (err) {
    console.warn(
      `[index:sweep] skipped: db read failed err=${err instanceof Error ? err.message : String(err)}`,
    )
    return
  }
  const gone = rows.filter((r) => !live.has(r.id))
  if (gone.length === 0) {
    console.log('[index:sweep] ok, nothing expired')
    return
  }
  for (const g of gone) {
    try {
      await deleteDocCascade(g.id)
      console.log(`[index:sweep] purged expired doc=${g.id} (pages + sessions + vectors)`)
    } catch (err) {
      console.error(
        `[index:sweep] purge FAILED doc=${g.id} err=${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
}

setTimeout(() => void sweepExpiredDocs(), 30_000)
setInterval(() => void sweepExpiredDocs(), SWEEP_INTERVAL_MS)
console.log(`[index:sweep] every ${Math.round(SWEEP_INTERVAL_MS / 60000)} min (INDEX_SWEEP_MINUTES)`)
