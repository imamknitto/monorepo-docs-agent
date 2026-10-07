import type { Context, Next } from 'hono'

const WINDOW_MS = 60_000
const MAX_REQUESTS = 120
const hits = new Map<string, number[]>()

/** Minimal fixed-window rate limiter (per IP). Move to Redis when multi-instance. */
export async function rateLimit(c: Context, next: Next) {
  const ip =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  const now = Date.now()
  const window = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS)
  if (window.length >= MAX_REQUESTS) {
    return c.json({ detail: 'Rate limit exceeded.' }, 429)
  }
  window.push(now)
  hits.set(ip, window)
  await next()
}
