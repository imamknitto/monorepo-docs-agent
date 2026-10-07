export interface AskInput {
  /** doc_id returned by POST /convert */
  docId: string
  question: string
}

export interface AskResult {
  answer: string
  citations: Array<{ page: number; excerpt: string }>
}

export class NotImplementedError extends Error {
  readonly code = 'NOT_IMPLEMENTED'
  constructor(feature = 'agent') {
    super(`${feature} is not implemented yet`)
    this.name = 'NotImplementedError'
  }
}
