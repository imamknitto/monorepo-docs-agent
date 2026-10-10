import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client.js'
import { DATABASE_URL } from '../config.js'

/**
 * Lazy Prisma client. Null when DATABASE_URL is unset so the gateway
 * still serves /convert + /public without RAG infra. Endpoints that
 * need persistence return 503 instead of crashing.
 */
let cached: PrismaClient | null | undefined

export function getPrisma(): PrismaClient | null {
  if (cached !== undefined) return cached
  if (!DATABASE_URL) {
    cached = null
    return cached
  }
  const adapter = new PrismaPg(DATABASE_URL)
  cached = new PrismaClient({ adapter })
  return cached
}
