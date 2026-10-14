import path from 'node:path'
import { fileURLToPath } from 'node:url'

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function env(name: string, fallback: string): string {
  const v = process.env[name]
  return v === undefined || v === '' ? fallback : v
}

export const CONVERTER_URL = env(
  'CONVERTER_URL',
  'http://127.0.0.1:8379',
).replace(/\/$/, '')

export const CONVERTER_API_KEY = process.env.CONVERTER_API_KEY ?? ''

export const MAX_UPLOAD_MB = Number(env('MAX_UPLOAD_MB', '30'))
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024

/** Runtime conversion output. Served at /public; later swappable for object storage. */
export const ARTIFACT_DIR = path.resolve(
  env('ARTIFACT_DIR', path.join(apiRoot, 'data', 'public')),
)
export const ARTIFACT_MAX_MB = Number(env('ARTIFACT_MAX_MB', '1024'))
export const ARTIFACT_MAX_BYTES = ARTIFACT_MAX_MB * 1024 * 1024

/**
 * Upper bound for a proxied conversion request (gateway → converter).
 * Large PDFs take minutes on the single-worker converter, far beyond
 * undici's default headers timeout — without this the request dies with
 * `HeadersTimeoutError` and the client only sees a bare 502.
 */
export const CONVERT_TIMEOUT_MS = Number(env('CONVERT_TIMEOUT_MS', '600000'))

export const DOC_ID_RE = /^[0-9a-f]{32}$/

/** Browser fingerprint identity: fp:<stable id> (see platform lib/identity.ts). */
export const USER_ID_RE = /^fp:[A-Za-z0-9_-]{8,64}$/

export function parseSessionId(
  docId: string,
  sessionId: string,
): { ok: true } | { ok: false; detail: string } {
  const m = /^doc:([0-9a-f]{32}):s:([A-Za-z0-9_-]{8,64})$/.exec(sessionId)
  if (!m) return { ok: false, detail: 'Invalid session id.' }
  if (m[1] !== docId) return { ok: false, detail: 'Session does not belong to this document.' }
  return { ok: true }
}

export function newSessionId(docId: string, rand: string): string {
  return `doc:${docId}:s:${rand}`
}

// ---- RAG / agent env (all optional at runtime; endpoints 503 when unset) ----

export const PUBLIC_BASE_URL = env('PUBLIC_BASE_URL', 'http://127.0.0.1:8377').replace(/\/$/, '')

export const DATABASE_URL = process.env.DATABASE_URL ?? ''
export const REDIS_URL = env('REDIS_URL', 'redis://127.0.0.1:16379')
export const QDRANT_URL = env('QDRANT_URL', 'http://127.0.0.1:6333')
export const QDRANT_API_KEY = process.env.QDRANT_API_KEY ?? ''
export const QDRANT_COLLECTION = env('QDRANT_COLLECTION', 'document')

export const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? ''
export const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL ?? ''
export const CHAT_MODEL = env('CHAT_MODEL', 'gpt-4o-mini')
/** User-led turns replayed to the model per request (summary anchors older context). */
export const CHAT_HISTORY_TURNS = Number(env('CHAT_HISTORY_TURNS', '6'))
/** Max agent turns (model/tool loop) per chat request before MaxTurnsError. */
export const CHAT_MAX_TURNS = Number(env('CHAT_MAX_TURNS', '5'))
export const SUMMARY_MODEL = env('SUMMARY_MODEL', process.env.CHAT_MODEL ?? 'gpt-4o-mini')
export const EMBEDDING_MODEL = env('EMBEDDING_MODEL', 'Xenova/all-MiniLM-L6-v2')
export const EMBEDDING_DIMS = Number(env('EMBEDDING_DIMS', '384'))

export const hasDatabase = DATABASE_URL.length > 0
export const hasChatModel = OPENAI_API_KEY.length > 0

export function converterHeaders(
  init?: HeadersInit,
  requestId?: string,
): Headers {
  const h = new Headers(init)
  if (CONVERTER_API_KEY) h.set('Authorization', `Bearer ${CONVERTER_API_KEY}`)
  if (requestId) h.set('x-request-id', requestId)
  return h
}
