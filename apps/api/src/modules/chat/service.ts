import type { AnyTool } from '@anvia/core'
import { OpenAIClient } from '@anvia/openai'
import { PrismaMemoryStore } from '@anvia/memory-prisma'
import type { Message } from '@anvia/core'
import {
  CHAT_MODEL,
  CHAT_HISTORY_TURNS,
  OPENAI_API_KEY,
  OPENAI_BASE_URL,
  hasChatModel,
  hasDatabase,
} from '../../config.js'
import { LeanHistoryStore, extractQuestion } from './history-store.js'
import { getPrisma } from '../../utils/prisma.js'
import { getEmbeddingModel, getVectorStore, retrieveForDoc } from '../../rag/vector.js'
import {
  buildAnswerPrompt,
  createDocAgent,
  createDocumentReadTool,
  createDocumentSearchTool,
  retrieveKeyword,
  toCitations,
  NotConfiguredError,
  type Citation,
  type RetrievedPage,
} from '@halodocs/agent'

export type ToolCallInfo = {
  callId: string
  name: string
  state: 'running' | 'done' | 'error'
  input?: string
  output?: string
}

export type ChatStreamEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'citations'; citations: Citation[] }
  | { type: 'tool'; tool: ToolCallInfo }
  | { type: 'done'; text: string }
  | { type: 'error'; message: string }

export type HistoryMessage = { role: 'user' | 'assistant'; text: string }

function messageText(message: Message): string {
  const content = (message as { content?: unknown }).content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (part && typeof part === 'object' && (part as { type?: string }).type === 'text') {
          return String((part as { text?: string }).text ?? '')
        }
        return ''
      })
      .join('')
  }
  return ''
}

let openai: OpenAIClient | null = null
function getClient(): OpenAIClient {
  if (!hasChatModel) throw new NotConfiguredError('chat model (OPENAI_API_KEY)')
  if (!openai) {
    openai = new OpenAIClient({
      apiKey: OPENAI_API_KEY,
      ...(OPENAI_BASE_URL ? { baseUrl: OPENAI_BASE_URL } : {}),
    })
  }
  return openai
}

function getMemoryStore(): PrismaMemoryStore {
  if (!hasDatabase) throw new NotConfiguredError('memory (DATABASE_URL)')
  const prisma = getPrisma()
  if (!prisma) throw new NotConfiguredError('memory (DATABASE_URL)')
  return new PrismaMemoryStore({ client: prisma })
}

export async function loadHistory(
  sessionId: string,
  userId: string,
): Promise<HistoryMessage[]> {
  const memory = getMemoryStore()
  const messages = await memory.load({ scope: { sessionId, userId } })
  return messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role as 'user' | 'assistant', text: displayText(m) }))
    .filter((m) => m.text.length > 0)
}

export type UiToolPart = {
  id: string
  type: 'tool'
  toolName: string
  toolCallId: string
  callId?: string
  state: 'input-available' | 'output-available' | 'error'
  input?: unknown
  output?: unknown
}

export type UiPart =
  | { id: string; type: 'text'; text: string }
  | { id: string; type: 'reasoning'; text: string }
  | UiToolPart

export type UiMessage = {
  id: string
  role: 'user' | 'assistant'
  parts: UiPart[]
}

type CoreContentPart = { type?: unknown; [key: string]: unknown }

function coreContentParts(message: unknown): CoreContentPart[] {
  const content = (message as { content?: unknown }).content
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  return Array.isArray(content) ? (content as CoreContentPart[]) : []
}

/** Unwrap a core ToolResultOutput ({type:'text',value}) to its readable value. */
function toolOutputValue(output: unknown): unknown {
  if (output && typeof output === 'object') {
    const o = output as { type?: unknown; value?: unknown }
    if (o.type === 'text' && typeof o.value === 'string') return o.value
    if ('value' in o) return o.value
  }
  return output
}

function isErrorOutput(output: unknown): boolean {
  if (!output || typeof output !== 'object') return false
  const type = (output as { type?: unknown }).type
  return type === 'error-text' || type === 'error-json'
}

type ToolResultInfo = { toolName: string; output: unknown; isError: boolean }

/** Index tool results by callId so they can be merged into the calling turn. */
function collectToolResults(messages: readonly unknown[]): Map<string, ToolResultInfo> {
  const results = new Map<string, ToolResultInfo>()
  for (const message of messages) {
    if ((message as { role?: unknown }).role !== 'tool') continue
    for (const part of coreContentParts(message)) {
      if (part.type !== 'tool-result') continue
      const callId = part.callId
      const toolCallId = part.toolCallId
      const key =
        typeof callId === 'string'
          ? callId
          : typeof toolCallId === 'string'
            ? toolCallId
            : undefined
      if (!key) continue
      results.set(key, {
        toolName: typeof part.toolName === 'string' ? part.toolName : 'tool',
        output: toolOutputValue(part.output),
        isError: isErrorOutput(part.output),
      })
    }
  }
  return results
}

/**
 * History shaped for the chat UI: user/assistant messages whose parts carry
 * text, reasoning and tool calls, with tool results merged into the calling
 * turn. This keeps tool activity visible after a page refresh.
 */
export async function loadUiHistory(
  sessionId: string,
  userId: string,
): Promise<UiMessage[]> {
  const memory = getMemoryStore()
  const messages = await memory.load({ scope: { sessionId, userId } })
  const results = collectToolResults(messages)
  const out: UiMessage[] = []

  for (const [mi, message] of messages.entries()) {
    const role = (message as { role?: unknown }).role

    if (role === 'user') {
      const parts: UiPart[] = []
      for (const [pi, part] of coreContentParts(message).entries()) {
        if (part.type !== 'text' || typeof part.text !== 'string') continue
        const text = extractQuestion(part.text).trim()
        if (text) parts.push({ id: `u${mi}_${pi}`, type: 'text', text })
      }
      if (parts.length > 0) out.push({ id: `msg_${mi}`, role: 'user', parts })
      continue
    }

    if (role !== 'assistant') continue

    const parts: UiPart[] = []
    for (const [pi, part] of coreContentParts(message).entries()) {
      if (part.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
        parts.push({ id: `a${mi}_${pi}`, type: 'text', text: part.text })
      } else if (
        part.type === 'reasoning' &&
        typeof part.text === 'string' &&
        part.text.trim()
      ) {
        parts.push({ id: `a${mi}_${pi}`, type: 'reasoning', text: part.text })
      } else if (part.type === 'tool-call') {
        const callId = typeof part.callId === 'string' ? part.callId : undefined
        const toolCallId =
          typeof part.toolCallId === 'string'
            ? part.toolCallId
            : (callId ?? `tool_${mi}_${pi}`)
        const result = results.get(callId ?? toolCallId) ?? results.get(toolCallId)
        parts.push({
          id: `tool_${mi}_${pi}`,
          type: 'tool',
          toolName:
            typeof part.toolName === 'string'
              ? part.toolName
              : (result?.toolName ?? 'tool'),
          toolCallId,
          ...(callId ? { callId } : {}),
          state: result ? (result.isError ? 'error' : 'output-available') : 'input-available',
          input: part.input,
          ...(result ? { output: result.output } : {}),
        })
      }
    }
    if (parts.length > 0) out.push({ id: `msg_${mi}`, role: 'assistant', parts })
  }

  return out
}

/**
 * Display version of a stored message. The agent persists the full prompt
 * (question + retrieved <context> pages) as the user message so next turns
 * keep context — but the chat UI must only show the question itself.
 */
function displayText(message: Message): string {
  const text = messageText(message)
  if ((message as { role?: unknown }).role !== 'user') return text
  return extractQuestion(text)
}

export async function clearHistory(sessionId: string, userId: string): Promise<void> {
  const memory = getMemoryStore()
  await memory.clear({ scope: { sessionId, userId } })
}

export async function retrievePages(
  docId: string,
  question: string,
  topK = 4,
): Promise<RetrievedPage[]> {
  const prisma = getPrisma()
  if (!prisma) return []
  const pages = await prisma.documentPage.findMany({
    where: { documentId: docId },
    orderBy: { pageNumber: 'asc' },
    select: { pageNumber: true, content: true },
  })
  if (pages.length === 0) return []
  try {
    const vector = await retrieveForDoc(docId, question, topK)
    if (vector && vector.length > 0) return vector
  } catch (err) {
    console.warn('[chat] vector retrieval failed, keyword fallback', err)
  }
  return retrieveKeyword(pages, question, topK)
}

async function readPageContent(docId: string, pageNumber: number): Promise<string | null> {
  const prisma = getPrisma()
  if (!prisma) return null
  const row = await prisma.documentPage.findUnique({
    where: { documentId_pageNumber: { documentId: docId, pageNumber } },
    select: { content: true },
  })
  return row?.content ?? null
}

async function buildAgent(docId: string, summary: string | null) {
  const model = getClient().completionModel({ modelId: CHAT_MODEL, api: 'chat' })
  const tools: AnyTool[] = [createDocumentReadTool({ docId, readPage: (n) => readPageContent(docId, n) })]
  try {
    const embeddingModel = await getEmbeddingModel()
    if (embeddingModel) {
      tools.unshift(
        createDocumentSearchTool({ store: getVectorStore(), model: embeddingModel, docId }),
      )
    }
  } catch (err) {
    console.warn('[chat] search tool unavailable, using manual retrieval', err)
  }
  return createDocAgent({
    docId,
    model,
    summary,
    tools,
    memory: new LeanHistoryStore(getMemoryStore(), CHAT_HISTORY_TURNS),
  })
}

/** Append an actionable hint when the chat model rejects the request (bad key / model id). */
function withUpstreamHint(message: string): string {
  if (/\b401\b/.test(message)) {
    return `${message} (API key ditolak upstream — cek OPENAI_API_KEY di .env, lalu restart dev:api. Untuk OpenRouter, CHAT_MODEL harus berbentuk 'openai/gpt-4o-mini'.)`
  }
  return message
}

/** One-line JSON/text summary for tool payloads shown in the chat UI. */
function shortJson(value: unknown, maxLen = 500): string {
  let s: string
  try {
    s = typeof value === 'string' ? value : JSON.stringify(value)
  } catch {
    s = String(value)
  }
  s = (s ?? '').replace(/\s+/g, ' ').trim()
  return s.length > maxLen ? `${s.slice(0, maxLen - 1)}…` : s
}

/** Extract readable output + error flag from a core ToolResultOutput payload. */
function toolOutputText(output: unknown): { text: string; isError: boolean } {
  if (output && typeof output === 'object') {
    const o = output as { type?: unknown; value?: unknown }
    if (o.type === 'error-text' || o.type === 'error-json') {
      return { text: shortJson(o.value), isError: true }
    }
    if ('value' in o) return { text: shortJson(o.value), isError: false }
  }
  return { text: shortJson(output), isError: false }
}
/** Stream one answer over the doc's retrieved pages, persisting via memory. */
export async function* streamAnswer(
  docId: string,
  sessionId: string,
  userId: string,
  question: string,
  summary: string | null,
): AsyncGenerator<ChatStreamEvent> {
  const pages = await retrievePages(docId, question)
  yield { type: 'citations', citations: toCitations(pages) }

  const agent = await buildAgent(docId, summary)
  const prompt = buildAnswerPrompt(question, pages)
  const stream = agent.stream({
    prompt,
    session: { sessionId, userId, metadata: { docId } },
  })

  let text = ''
  try {
    for await (const event of stream) {
      if (event.type === 'text_delta') {
        text += event.delta
        yield { type: 'text_delta', delta: event.delta }
      } else if (event.type === 'response') {
        text = event.text || text
      } else if (event.type === 'tool_call') {
        const tc = (event as { toolCall?: Record<string, unknown> }).toolCall ?? {}
        const rawId = tc.toolCallId ?? tc.callId
        yield {
          type: 'tool',
          tool: {
            callId: typeof rawId === 'string' && rawId ? rawId : `tool-${Date.now()}`,
            name: typeof tc.toolName === 'string' && tc.toolName ? tc.toolName : 'tool',
            state: 'running',
            input: shortJson(tc.input),
          },
        }
      } else if (event.type === 'tool_result') {
        const r = event as unknown as Record<string, unknown>
        const rawId = r.toolCallId ?? r.callId
        const { text: output, isError } = toolOutputText(r.output)
        yield {
          type: 'tool',
          tool: {
            callId: typeof rawId === 'string' && rawId ? rawId : 'tool',
            name: typeof r.toolName === 'string' && r.toolName ? r.toolName : 'tool',
            state: isError ? 'error' : 'done',
            output,
          },
        }
      } else if (event.type === 'error') {
        const err = (event as { error?: unknown }).error
        const message = withUpstreamHint(err instanceof Error ? err.message : 'run failed')
        console.error(
          `[chat:answer] doc=${docId} session=${sessionId} UPSTREAM ERROR message=${message}`,
          err instanceof Error ? err.stack : '',
        )
        yield { type: 'error', message }
        return
      }
    }
  } catch (err) {
    const message = withUpstreamHint(err instanceof Error ? err.message : 'run failed')
    console.error(
      `[chat:answer] doc=${docId} session=${sessionId} STREAM FAILED message=${message}`,
      err instanceof Error ? err.stack : '',
    )
    yield { type: 'error', message }
    return
  }
  yield { type: 'done', text }
}
