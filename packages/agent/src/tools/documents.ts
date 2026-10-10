import { createTool } from '@anvia/core'
import { createVectorSearchTool, vectorFilter } from '@anvia/core/vector-store'
import type { EmbeddingModel } from '@anvia/core/embeddings'
import type { VectorStore } from '@anvia/core/vector-store'
import { z } from 'zod'

type MetaValue = string | number | boolean | null

/**
 * Vector search scoped to one document. v1 equivalent of the reference
 * `documentSearchTool` (which used v0 `index.asTool`).
 */
export function createDocumentSearchTool<
  T,
  M extends Record<string, MetaValue>,
>(opts: {
  store: VectorStore<T, M>
  model: EmbeddingModel
  docId: string
  topK?: number
}) {
  return createVectorSearchTool<T, M>({
    name: 'documentSearch',
    description:
      `Search the current document (docId ${opts.docId}) for passages relevant to the question. ` +
      `Always search before answering. Quote page numbers as p.<pageNumber> when citing.`,
    store: opts.store,
    model: opts.model,
    topK: opts.topK ?? 4,
    filter: vectorFilter.eq('documentId', opts.docId),
  })
}

/**
 * Read the full markdown of a single page. Pair with documentSearch:
 * search first for candidates, then read pages in full for faithful answers.
 */
export function createDocumentReadTool(opts: {
  docId: string
  readPage: (pageNumber: number) => Promise<string | null>
}) {
  const { docId, readPage } = opts
  return createTool({
    name: 'documentReadPage',
    description:
      `Read the complete markdown content of one page of the current document ` +
      `(docId ${docId}). Use after documentSearch when a passage needs full context.`,
    inputSchema: z.object({
      pageNumber: z.number().int().min(1).describe('1-based page number to read'),
    }),
    execute: async ({ pageNumber }) => {
      const content = await readPage(pageNumber)
      return content ?? `Page ${pageNumber} not found in document ${docId}.`
    },
  })
}
