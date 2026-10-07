import { NotImplementedError } from './types.js'
import type { AskInput, AskResult } from './types.js'

export { NotImplementedError }
export type { AskInput, AskResult }

/**
 * RAG over a converted document. Stub until the retrieval
 * pipeline (vector store over doc markdown) lands.
 */
export async function askDoc(_input: AskInput): Promise<AskResult> {
  throw new NotImplementedError('askDoc')
}

/**
 * Generate QA test cases from a converted document. Stub.
 */
export async function generateQa(_docId: string): Promise<never> {
  throw new NotImplementedError('generateQa')
}
