import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { requestId } from 'hono/request-id'
import { serve } from '@hono/node-server'
import { CONVERTER_URL, converterHeaders } from './config.js'
import { rateLimit } from './middleware/rateLimit.js'
import { getPrisma } from './utils/prisma.js'
import { deleteDocCascade } from './modules/documents/store.js'
import { converterRoutes } from './modules/converter/routes.js'
import { documentsRoutes, publicRoutes } from './modules/documents/routes.js'
import { healthRoutes } from './modules/health/routes.js'
import { debugRoutes } from './modules/debug/routes.js'
import { chatRoutes } from './modules/chat/routes.js'

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
    // Browser JS can only read safelisted response headers — the Anvia client
    // transport validates this one, so it must be visible to the platform.
    exposeHeaders: ['x-anvia-stream-protocol'],
  }),
)
app.use('*', rateLimit)

// API endpoints (converter proxy, documents, chat, debug) live under /v1.
const v1 = new Hono()
v1.route('/', converterRoutes)
v1.route('/', documentsRoutes)
v1.route('/', chatRoutes)
v1.route('/', debugRoutes)

app.route('/v1', v1)

// Health probes and static artifacts stay unprefixed (infra/monitoring,
// platform status link, and markdown image URLs emitted by the converter).
app.route('/', healthRoutes)
app.route('/', publicRoutes)

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
    const res = await fetch(`${CONVERTER_URL}/v1/documents`, {
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