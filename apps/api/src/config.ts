export function env(name: string, fallback: string): string {
  const v = process.env[name]
  return v === undefined || v === '' ? fallback : v
}

export const CONVERTER_URL = env(
  'CONVERTER_URL',
  'http://127.0.0.1:8100',
).replace(/\/$/, '')

export const CONVERTER_API_KEY = process.env.CONVERTER_API_KEY ?? ''

export const MAX_UPLOAD_MB = Number(env('MAX_UPLOAD_MB', '30'))
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024

export const DOC_ID_RE = /^[0-9a-f]{32}$/

export function converterHeaders(
  init?: HeadersInit,
  requestId?: string,
): Headers {
  const h = new Headers(init)
  if (CONVERTER_API_KEY) h.set('Authorization', `Bearer ${CONVERTER_API_KEY}`)
  if (requestId) h.set('x-request-id', requestId)
  return h
}
