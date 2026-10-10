import { getPrisma } from '../../utils/prisma.js'
import { deleteDocVectors } from '../../rag/vector.js'

export interface PendingDoc {
  docId: string
  name: string
  markdownUrl: string | null
  stats: unknown
}

/** Record converter result so the async worker can index it. Null when no DB. */
export async function upsertPendingDoc(doc: PendingDoc): Promise<boolean> {
  const prisma = getPrisma()
  if (!prisma) return false
  await prisma.document.upsert({
    where: { id: doc.docId },
    update: {
      name: doc.name,
      markdownUrl: doc.markdownUrl,
      stats: (doc.stats ?? {}) as object,
    },
    create: {
      id: doc.docId,
      name: doc.name,
      markdownUrl: doc.markdownUrl,
      stats: (doc.stats ?? {}) as object,
      isProcessed: false,
    },
  })
  return true
}

export async function getDocStatus(docId: string): Promise<
  | { found: false }
  | { found: true; isProcessed: boolean; pages: number; summary: string | null }
> {
  const prisma = getPrisma()
  if (!prisma) return { found: false }
  const doc = await prisma.document.findUnique({
    where: { id: docId },
    select: {
      isProcessed: true,
      summary: true,
      _count: { select: { pages: true } },
    },
  })
  if (!doc) return { found: false }
  return { found: true, isProcessed: doc.isProcessed, pages: doc._count.pages, summary: doc.summary }
}

/** Cascade delete document + pages + vectors + memory sessions. Returns false when no DB. */
export async function deleteDocCascade(docId: string): Promise<boolean> {
  const prisma = getPrisma()
  if (!prisma) return false
  const pages = await prisma.documentPage.findMany({
    where: { documentId: docId },
    select: { pageNumber: true },
  })
  // Best-effort: vector store has no FK cascade, remove points explicitly.
  await deleteDocVectors(
    docId,
    pages.map((p) => p.pageNumber),
  )
  await prisma.document.deleteMany({ where: { id: docId } })
  await prisma.agentMemorySession.deleteMany({
    where: { sessionId: { startsWith: `doc:${docId}:` } },
  })
  return true
}
