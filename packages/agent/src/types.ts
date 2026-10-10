export interface AskInput {
  /** doc_id returned by POST /convert */
  docId: string
  question: string
  /** fp:<browser fingerprint>, see platform lib/identity.ts */
  userId: string
  /** doc:<docId>:s:<uuid> */
  sessionId: string
}

export interface Citation {
  page: number
  excerpt: string
}

export interface AskResult {
  answer: string
  citations: Citation[]
  sessionId: string
}

export interface RetrievedPage {
  pageNumber: number
  content: string
}

export class NotImplementedError extends Error {
  readonly code = 'NOT_IMPLEMENTED'
  constructor(feature = 'agent') {
    super(`${feature} is not implemented yet`)
    this.name = 'NotImplementedError'
  }
}

export class NotConfiguredError extends Error {
  readonly code = 'NOT_CONFIGURED'
  readonly status = 503
  constructor(feature = 'rag') {
    super(`${feature} is not configured yet (missing env/infra)`)
    this.name = 'NotConfiguredError'
  }
}

export class IndexingError extends Error {
  readonly code = 'INDEXING'
  readonly status = 503
  constructor() {
    super('Document is still indexing, try again shortly')
    this.name = 'IndexingError'
  }
}
