import {
  Agent,
  type AnyTool,
  type CompletionModel,
  type MemoryStore,
} from '@anvia/core'
import { defaultModel } from './providers/openai.js'
import { QA_INSTRUCTIONS } from './prompts/qa-instructions.js'
import { SAFETY_INSTRUCTIONS } from './prompts/safety-instructions.js'
import { docGuardrails } from './prompts/guardrails.js'

export interface CreateDocAgentOptions {
  docId: string
  model?: CompletionModel
  summary?: string | null
  tools?: AnyTool[]
  additionalInstructions?: string[]
  memory?: MemoryStore
  maxTurns?: number
}

const DEFAULT_MAX_TURNS = 5

/**
 * Doc-QA agent factory (cermin createAgent referensi, API v1):
 * instructions QA + safety, tools dokumen per-request, guardrails enforce,
 * memory per session. Model default dari providers/openai.
 */
export function createDocAgent(opts: CreateDocAgentOptions) {
  const instructions = [
    QA_INSTRUCTIONS,
    SAFETY_INSTRUCTIONS,
    ...(opts.summary ? [`Document summary:\n${opts.summary}`] : []),
    ...(opts.additionalInstructions ?? []),
  ].join('\n')

  return new Agent({
    id: `doc-${opts.docId}`,
    model: opts.model ?? defaultModel(),
    instructions,
    maxTurns: opts.maxTurns ?? DEFAULT_MAX_TURNS,
    tools: opts.tools ?? [],
    guardrails: docGuardrails,
    ...(opts.memory ? { memory: { store: opts.memory } } : {}),
  })
}
