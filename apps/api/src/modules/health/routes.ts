import { Hono } from 'hono'
import { converterClient } from '../converter/client.js'

const healthRoutes = new Hono()

const startedAt = Date.now()

/** Liveness probe - always returns ok if gateway is running */
healthRoutes.get('/health/live', (c) => c.json({ status: 'ok', service: 'api-gateway' }))

/** Readiness probe - checks converter reachability */
healthRoutes.get('/health/ready', async (c) => {
  const converter = await converterClient.health()
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

/** Combined health - for general monitoring */
healthRoutes.get('/health', async (c) => {
  const converter = await converterClient.health()
  return c.json({
    status: converter.reachable ? 'ok' : 'degraded',
    service: 'api-gateway',
    uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
    converter: converter.reachable
      ? { status: 'ok', version: converter.version ?? 'unknown' }
      : { status: 'unreachable' },
  })
})

export { healthRoutes }